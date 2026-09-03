# 事务与 Lua

> Redis 的事务与 Lua 脚本都能把多条命令组合起来执行，但机制不同：事务强调「入队后一起执行」，Lua 强调「服务端原子脚本」。本章对比两者，讲清各自适用场景和生产中的正确用法。

## 1. MULTI / EXEC

Redis 事务通过 `MULTI`、`EXEC`、`DISCARD` 实现：

```bash
MULTI              # 开启事务
SET a 1            # 入队
INCR a             # 入队
GET a              # 入队
EXEC               # 一次性执行所有命令
```

### 1.1 执行流程

![事务 MULTI/EXEC 执行流程](/redis/02-standalone-core-chapter-03-transaction-lua-1.svg)

```txt
客户端 MULTI → 服务端标记事务开始
客户端发送命令 → 服务端入队（不执行），返回 QUEUED
客户端 EXEC → 服务端按顺序执行所有入队命令，一次性返回结果
```

### 1.2 错误处理

Redis 事务的错误分为两类：

| 错误类型 | 触发时机 | 事务行为 |
| :-- | :-- | :-- |
| 语法错误 | 入队时（命令不存在、参数错误） | 整个事务不执行 |
| 运行时错误 | 执行时（类型不匹配、key 不存在等） | 出错命令报错，其他命令继续执行 |

```bash
MULTI
SET a 1
INCR a            # OK，入队
INCR b            # OK，入队（b 不存在，执行时会自动初始化为 0 再 incr）
EXEC
# 返回：OK, 1, 1（全部成功）

MULTI
SET a 1
LPUSH a x         # OK，入队（a 是 string，LPUSH 执行时类型报错）
EXEC
# 返回：OK, ERR（LPUSH 报错，但 SET a 1 已执行，不会回滚）
```

### 1.3 不回滚

Redis 事务**不支持回滚**：执行到一半出错，前面已执行的命令不会撤销。这是 Redis 与关系型数据库事务的本质区别。

为什么不支持回滚？

| 原因 | 说明 |
| :-- | :-- |
| 性能 | 回滚需要记录操作前的状态，增加内存和 CPU 开销 |
| 简单 | Redis 追求简单，回滚逻辑复杂且容易出 bug |
| 实际需要少 | 大部分 Redis 操作是幂等的，出错重试即可 |

## 2. WATCH 乐观锁

`WATCH` 实现乐观锁：监视一个或多个 key，如果这些 key 在 `EXEC` 前被其他客户端修改，则事务放弃执行。

```bash
WATCH balance          # 监视余额
val = GET balance      # 读取余额
MULTI
SET balance (val-100)  # 扣款
EXEC                   # 若 balance 在 WATCH 后被改过，返回 nil（放弃）
```

![WATCH 乐观锁流程](/redis/02-standalone-core-chapter-03-transaction-lua-2.svg)

### 2.1 CAS 模式

WATCH 实现的是 CAS（Compare-And-Swap）：

```txt
WATCH key → 读取值 → 修改 → EXEC
  → key 没被改过：执行成功
  → key 被改过：返回 nil，重试
```

### 2.2 局限

| 局限 | 说明 |
| :-- | :-- |
| 高冲突下性能差 | 频繁重试浪费 CPU |
| 只能监视同一连接 | 不能跨连接 WATCH |
| 不适合热点 key | 热点 key 频繁被改，事务几乎永远失败 |

> WATCH 适合低冲突场景（余额扣减、库存扣减）。高冲突场景用 Lua 脚本更合适——Lua 在服务端原子执行，不需要重试。

## 3. Lua 脚本

Lua 脚本在 Redis 服务端执行，整个过程原子，中间不会被其他命令打断。

### 3.1 基本用法

```bash
# EVAL "脚本" numkeys key [key ...] arg [arg ...]
EVAL "return redis.call('get', KEYS[1])" 1 mykey

# 缓存脚本，返回 SHA1
SCRIPT LOAD "return redis.call('get', KEYS[1])"

# 用 SHA1 执行（节省带宽）
EVALSHA "a42059b356c875f0717db19a51f6aaca9ae659ea" 1 mykey
```

### 3.2 redis.call 与 redis.pcall

| 方法 | 区别 |
| :-- | :-- |
| `redis.call()` | 命令出错时，脚本终止并返回错误 |
| `redis.pcall()` | 命令出错时，捕获错误继续执行 |

```lua
-- 原子扣减库存
local stock = tonumber(redis.call('get', KEYS[1]))
if stock == nil then
    return -1  -- key 不存在
end
if stock > 0 then
    redis.call('decr', KEYS[1])
    return 1   -- 扣减成功
else
    return 0   -- 库存不足
end
```

### 3.3 典型场景

**分布式锁释放**（校验 + 删除原子化）：

```lua
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
else
    return 0
end
```

**限流器**（滑动窗口原子化）：

```lua
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count < limit then
    redis.call('ZADD', key, now, now)
    redis.call('EXPIRE', key, window)
    return 1
else
    return 0
end
```

**分布式 ID 生成**（INCR 原子递增）：

```lua
local id = redis.call('incr', KEYS[1])
if id == 1 then
    redis.call('expire', KEYS[1], 86400)  -- 首次设置过期时间
end
return id
```

### 3.4 Lua 脚本的注意事项

| 要点 | 说明 |
| :-- | :-- |
| 原子执行 | 脚本执行期间不被打断，阻塞其他命令 |
| 不要写长时间脚本 | 阻塞主线程，导致所有客户端超时 |
| 集群限制 | 脚本内所有 key 必须在同一个槽（用哈希标签） |
| 随机命令限制 | 集群下脚本内不能访问其他槽的 key |
| 脚本复用 | 用 `SCRIPT LOAD` + `EVALSHA` 避免重复传输脚本内容 |

### 3.5 脚本调试

```bash
# Redis 3.2+ 支持 Lua 脚本调试
redis-cli --ldb --eval script.lua key1 key2 , arg1 arg2

# 调试命令
# s (step) - 单步执行
# n (next) - 执行到下一行
# c (continue) - 继续执行到结束
# p var - 打印变量
# b N - 在第 N 行设置断点
```

## 4. 事务与 Lua 对比

| 维度 | 事务（MULTI/EXEC） | Lua 脚本 |
| :-- | :-- | :-- |
| 原子性 | 命令序列原子执行 | 脚本整体原子执行 |
| 逻辑判断 | 不支持 | 支持（if/else/循环） |
| 回滚 | 不支持 | 不支持 |
| 条件执行 | 用 WATCH 乐观锁 | 脚本内直接判断 |
| 性能 | 中（多次网络往返入队） | 高（脚本一次发送） |
| 调试 | 不支持 | 支持（ldb） |
| 适用场景 | 简单批量命令 | 复杂读-判断-写逻辑 |

选型建议：

| 场景 | 推荐 |
| :-- | :-- |
| 把多条无关命令打包执行 | Pipeline（不要用事务） |
| 需要原子性 + 简单序列 | 事务（MULTI/EXEC） |
| 需要原子性 + 条件判断 | Lua 脚本 |
| 需要乐观锁（低冲突） | WATCH + 事务 |
| 需要乐观锁（高冲突） | Lua 脚本 |

## 5. Pipeline、事务、Lua 三者对比

| 维度 | Pipeline | 事务 | Lua |
| :-- | :-- | :-- | :-- |
| 核心目的 | 减少网络往返 | 命令原子执行 | 服务端原子脚本 |
| 原子性 | 否 | 是 | 是 |
| 逻辑判断 | 否 | 否 | 是 |
| 网络开销 | 低（批量） | 中（入队+执行） | 低（一次发送） |
| 阻塞其他客户端 | 否 | 否（执行期间短暂阻塞） | 是（脚本执行期间阻塞） |

> 三者经常被混淆。记住：Pipeline 是网络优化，事务是命令打包，Lua 是服务端编程。Pipeline 不保证原子性，事务不做条件判断，Lua 两者都能做但会阻塞主线程。
