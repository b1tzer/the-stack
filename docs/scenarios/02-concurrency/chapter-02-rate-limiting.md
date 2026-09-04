# 限流器

> 限流器位于请求入口，只放行后端能承受的请求量，超出部分直接拒绝或排队。本章从最简单的固定窗口计数器讲起，先暴露它的两个缺陷，再演进到滑动窗口、令牌桶、漏桶，最后给出 Redis 分布式实现与选型判断。

## 1. 为什么需要限流器

限流器解决三类问题：

| 问题 | 说明 |
| :-- | :-- |
| 保护后端 | 秒杀、热点事件带来的突发流量打垮数据库或下游服务 |
| 公平性 | 单个客户端占用全部资源，饿死其他客户端 |
| 成本控制 | 第三方 API 按调用量计费，超量产生额外费用 |

限流可以在网关层、应用层、本地内存实现。本地内存限流（如 Guava `RateLimiter`）只对单机有效：单机各限 100 QPS，N 台实例实际放行 N×100。要全局限流，需要所有实例共享同一个计数器，Redis 是自然选择。本章聚焦「基于 Redis 的分布式限流」。

## 2. 固定窗口计数器

固定窗口把时间切成等长的段（如 1 秒），统计每段内的请求数，超过阈值就拒绝。窗口的 key 通常带上时间戳标识，例如 `rate:user:1001:20260901120000`。

### 2.1 Lua 实现

```lua
-- KEYS[1] = 窗口 key
-- ARGV[1] = 窗口长度（秒）
-- ARGV[2] = 窗口内允许的最大请求数
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])  -- 第一个请求时设置过期
end
return current <= tonumber(ARGV[2]) and 1 or 0
```

```java
private static final String FIXED_WINDOW_SCRIPT = """
    local current = redis.call('INCR', KEYS[1])
    if current == 1 then
        redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    return current <= tonumber(ARGV[2]) and 1 or 0
    """;

public boolean tryAcquire(String key, int windowSeconds, int limit) {
    DefaultRedisScript<Long> script = new DefaultRedisScript<>(FIXED_WINDOW_SCRIPT, Long.class);
    Long result = stringRedisTemplate.execute(script,
        List.of(key), String.valueOf(windowSeconds), String.valueOf(limit));
    return Long.valueOf(1).equals(result);
}
```

> 📌 `INCR` 与 `EXPIRE` 必须放进同一条 Lua 脚本。若分开执行，`INCR` 成功后进程崩溃、`EXPIRE` 没执行，key 永不过期，后续所有请求都会被拒绝。原子脚本保证「计数 + 设过期」要么都发生，要么都不发生。

### 2.2 边界突刺

固定窗口的缺陷在窗口交界处：第 1 秒最后 100ms 与第 2 秒最初 100ms 分属两个窗口，各自放行 `limit` 个请求，实际 200ms 内放行了 `2 × limit`。

![固定窗口与滑动窗口的边界突刺对比](/redis/06-patterns-chapter-02-rate-limiter-1.svg)

固定窗口只能保证「每个窗口内不超过阈值」，无法保证「任意时间段流量均匀」。对「每分钟最多 100 次」这类粗粒度限制够用，对精确限流不够。

## 3. 滑动窗口

滑动窗口不切固定段，而是看「过去一段时间内的请求数」。它用 ZSet 记录每个请求的时间戳，统计时只数「当前时间 - 窗口长度」之后的请求。

### 3.1 原理

```txt
              now - window              now
时间轴:  --------|---------…------------|----
                  丢弃                 保留（参与计数）
```

每个请求以「当前时间戳」为 score、以唯一标识为 member 写入 ZSet；统计前先删除窗口外的旧记录，再 `ZCARD` 计数。ZSet 按 score 有序，`ZREMRANGEBYSCORE` 一条命令即可删掉所有过期记录。

### 3.2 Lua 实现

```lua
-- KEYS[1] = 窗口 key（ZSet）
-- ARGV[1] = 窗口长度（毫秒）
-- ARGV[2] = 窗口内允许的最大请求数
-- ARGV[3] = 当前时间戳（毫秒）
-- ARGV[4] = 请求唯一标识（UUID，防止同一请求被重复计数）
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)  -- 删过期记录
local count = redis.call('ZCARD', KEYS[1])                -- 当前窗口内请求数
if count >= limit then
    return 0
end
redis.call('ZADD', KEYS[1], now, ARGV[4])                 -- 记录本次请求
redis.call('PEXPIRE', KEYS[1], window)                    -- 整体过期，防僵尸 key
return 1
```

```java
private static final String SLIDING_WINDOW_SCRIPT = """
    local window = tonumber(ARGV[1])
    local limit = tonumber(ARGV[2])
    local now = tonumber(ARGV[3])
    redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
    local count = redis.call('ZCARD', KEYS[1])
    if count >= limit then
        return 0
    end
    redis.call('ZADD', KEYS[1], now, ARGV[4])
    redis.call('PEXPIRE', KEYS[1], window)
    return 1
    """;

public boolean tryAcquire(String key, long windowMillis, int limit) {
    DefaultRedisScript<Long> script = new DefaultRedisScript<>(SLIDING_WINDOW_SCRIPT, Long.class);
    String member = UUID.randomUUID().toString();
    Long result = stringRedisTemplate.execute(script, List.of(key),
        String.valueOf(windowMillis), String.valueOf(limit),
        String.valueOf(System.currentTimeMillis()), member);
    return Long.valueOf(1).equals(result);
}
```

### 3.3 内存权衡

滑动窗口为每个请求存一条 ZSet 记录，存储开销远高于固定窗口的单个计数器。

| 实现 | 单请求内存 | 精确度 | 适用场景 |
| :-- | :-- | :-- | :-- |
| 固定窗口 | 无（仅一个计数器） | 低（有边界突刺） | 粗粒度限流 |
| 滑动窗口 | 一个 ZSet 成员 | 高 | 精确限流 |

> 📌 高 QPS 下，滑动窗口的 ZSet 会快速膨胀。限流本质是「宁可错杀、不可放过」，多数场景用固定窗口 + 略低的阈值即可，不必追求绝对精确；只有明确需要平滑边界时才用滑动窗口。

## 4. 令牌桶

令牌桶允许短时突发：桶里以固定速率补充令牌，请求取到令牌才放行，桶满后新令牌被丢弃。只要桶里攒了令牌，突发流量可以一次取走多个令牌快速通过。

### 4.1 原理

```txt
         固定速率补充令牌
              ↓ ↓ ↓
        ┌─────────────┐
        │   令牌桶     │ ← 容量 capacity，满了丢弃新令牌
        └─────────────┘
              ↓ 每个请求取 1 个令牌，取到才放行
```

令牌桶与滑动窗口的本质区别：滑动窗口严格限制「过去 N 秒最多 M 个」，令牌桶只限制「长期平均速率」，允许瞬间冲到 `capacity`。

### 4.2 Lua 实现

```lua
-- KEYS[1] = 桶 key
-- ARGV[1] = 桶容量
-- ARGV[2] = 令牌补充速率（个/秒）
-- ARGV[3] = 本次请求需要的令牌数
-- ARGV[4] = 当前时间戳（秒）
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local requested = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

local tokens = tonumber(redis.call('GET', KEYS[1]))
if tokens == nil then tokens = capacity end

local lastRefill = tonumber(redis.call('GET', KEYS[1] .. ':ts'))
if lastRefill == nil then lastRefill = now end

-- 距上次补充过了多久，按速率补令牌，最多补到 capacity
local refill = (now - lastRefill) * rate
tokens = math.min(capacity, tokens + refill)

local allowed = 0
if tokens >= requested then
    tokens = tokens - requested
    allowed = 1
end

redis.call('SET', KEYS[1], tokens)
redis.call('SET', KEYS[1] .. ':ts', now)
redis.call('EXPIRE', KEYS[1], 60)
redis.call('EXPIRE', KEYS[1] .. ':ts', 60)
return allowed
```

```java
private static final String TOKEN_BUCKET_SCRIPT = """
    local capacity = tonumber(ARGV[1])
    local rate = tonumber(ARGV[2])
    local requested = tonumber(ARGV[3])
    local now = tonumber(ARGV[4])
    local tokens = tonumber(redis.call('GET', KEYS[1]))
    if tokens == nil then tokens = capacity end
    local lastRefill = tonumber(redis.call('GET', KEYS[1] .. ':ts'))
    if lastRefill == nil then lastRefill = now end
    local refill = (now - lastRefill) * rate
    tokens = math.min(capacity, tokens + refill)
    local allowed = 0
    if tokens >= requested then
        tokens = tokens - requested
        allowed = 1
    end
    redis.call('SET', KEYS[1], tokens)
    redis.call('SET', KEYS[1] .. ':ts', now)
    redis.call('EXPIRE', KEYS[1], 60)
    redis.call('EXPIRE', KEYS[1] .. ':ts', 60)
    return allowed
    """;

public boolean tryAcquire(String key, int capacity, int rate, int requested) {
    DefaultRedisScript<Long> script = new DefaultRedisScript<>(TOKEN_BUCKET_SCRIPT, Long.class);
    Long result = stringRedisTemplate.execute(script, List.of(key),
        String.valueOf(capacity), String.valueOf(rate),
        String.valueOf(requested), String.valueOf(System.currentTimeMillis() / 1000));
    return Long.valueOf(1).equals(result);
}
```

### 4.3 允许突发的代价

令牌桶允许突发，代价是「短时超速」。`capacity=100`、`rate=10` 的桶，长时间空闲后一次可放行 100 个请求，等于把 10 秒的配额瞬间压给下游。下游扛不住突发时，调小 `capacity` 或改用漏桶。

## 5. 漏桶

漏桶与令牌桶方向相反：请求先进入桶，桶以固定速率「漏水」（放行），水满则溢出（拒绝）。它强制匀速，不允许多突发，用于流量整形、保护下游。

### 5.1 原理

```txt
请求进来（进水）
        ↓
   ┌─────────┐
   │   漏桶   │ ← 容量 capacity
   └─────────┘
        ↓ 以固定速率 rate 漏水（放行），满则溢出（拒绝）
```

漏桶放行速率恒定，与突发无关；令牌桶允许桶内令牌被一次取空。这是两者最核心的区别。

### 5.2 Lua 实现

```lua
-- KEYS[1] = 桶 key
-- ARGV[1] = 桶容量
-- ARGV[2] = 漏水速率（个/秒）
-- ARGV[3] = 当前时间戳（秒）
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local water = tonumber(redis.call('GET', KEYS[1]))
if water == nil then water = 0 end

local lastLeak = tonumber(redis.call('GET', KEYS[1] .. ':ts'))
if lastLeak == nil then lastLeak = now end

-- 距上次漏水过了多久，按速率放掉一部分水
local leaked = (now - lastLeak) * rate
water = math.max(0, water - leaked)

if water + 1 > capacity then
    redis.call('SET', KEYS[1], water)
    redis.call('SET', KEYS[1] .. ':ts', now)
    return 0  -- 溢出，拒绝
end

water = water + 1
redis.call('SET', KEYS[1], water)
redis.call('SET', KEYS[1] .. ':ts', now)
redis.call('EXPIRE', KEYS[1], 60)
redis.call('EXPIRE', KEYS[1] .. ':ts', 60)
return 1
```

## 6. 四种算法对比

| 维度 | 固定窗口 | 滑动窗口 | 令牌桶 | 漏桶 |
| :-- | :-- | :-- | :-- | :-- |
| 数据结构 | String 计数器 | ZSet | String + 时间戳 | String + 时间戳 |
| 内存开销 | 最低 | 高（每请求一条） | 低 | 低 |
| 精确度 | 低（边界突刺） | 高 | 中 | 中 |
| 允许突发 | 否 | 否 | ✅ 允许 | ❌ 强制匀速 |
| 典型用途 | 粗粒度限流 | API 精确限流 | 通用限流、允许突发 | 流量整形、保护下游 |
| 代表实现 | 手写 `INCR` | 手写 ZSet | Guava `RateLimiter` | — |

## 7. 选型与最佳实践

```txt
你的限流目标是什么？
  ├─ 只防刷、允许粗粒度 → 固定窗口（最简单，配合略低阈值）
  ├─ 需要精确到任意时间段 → 滑动窗口（内存开销换精度）
  ├─ 允许短时突发、平滑长期速率 → 令牌桶
  └─ 必须匀速放行、保护下游 → 漏桶
```

| 实践 | 说明 |
| :-- | :-- |
| 优先用成熟组件 | 生产上优先用 Sentinel / Resilience4j 的限流，别手写 |
| 单机与全局分层 | 单机限流兜底 + Redis 全局限流，两层叠加 |
| 阈值留余量 | 限流阈值设在后端实测容量的 80% 左右，留缓冲 |
| 拒绝要明确 | 返回明确的状态码（如 HTTP 429），让客户端知道被限流 |
| 原子性 | 所有「读-判断-写」逻辑都放进 Lua，避免竞态 |
| 时钟一致 | 令牌桶/漏桶依赖时间戳，多实例间时钟要同步（NTP） |
