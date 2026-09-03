# 过期与淘汰

> 内存是有限的，键该删的要删、超限的也要删。Redis 用「惰性删除 + 定期删除」清理过期键，用 `maxmemory` 与淘汰策略处理内存超限。本章把这两条内存回收链路合在一起讲解：先讲过期的删除，再讲超限的淘汰。

## 1. 过期删除

### 1.1 过期键存储

Redis 为设置了 TTL 的键维护一个独立的过期字典（`expires`），专门记录键的过期时间。

```txt
主数据库字典（dict）：key → redisObject
过期字典（expires）：key → 过期时间戳（毫秒）
```

两个字典的关系：

```txt
dict:     "session:abc" → redisObject{...}
expires:  "session:abc" → 1712500000000（毫秒时间戳）
```

设置过期时间的命令：

```bash
EXPIRE key 300          # 300 秒后过期
PEXPIRE key 300000      # 300000 毫秒后过期
EXPIREAT key 1712500000 # Unix 时间戳过期
SET key value EX 300    # 设置时直接指定过期时间
TTL key                 # 查看剩余时间（秒）
PTTL key                # 查看剩余时间（毫秒）
PERSIST key             # 移除过期时间，永久保留
```

关键设计：过期时间单独存放在 `expires` 字典里，与主数据字典分离。查找某个键是否过期只需查 `expires` 字典，O(1)。

### 1.2 惰性删除

惰性删除指「访问时才发现过期、才删除」——键过期后不主动清理，等客户端访问这个键时检查并删除。

![惰性删除流程](/redis/02-standalone-core-chapter-06-expiration-eviction-1.svg)

```txt
GET key
  → 查 expires 字典，检查是否过期
    → 已过期：删除 key，返回 nil
    → 未过期：返回值
```

实现代码（伪代码）：

```c
robj *lookupKeyRead(redisDb *db, robj *key) {
    expireIfNeeded(db, key);  // 惰性删除检查
    return lookupKey(db, key);
}

int expireIfNeeded(redisDb *db, robj *key) {
    if (!keyIsExpired(db, key)) return 0;
    // 删除过期键
    dbDelete(db, key);
    // 传播 DEL 命令（AOF + 从库）
    propagateExpire(db, key);
    return 1;
}
```

特点：

| 维度 | 说明 |
| :-- | :-- |
| 优点 | 只在访问时检查，不额外消耗 CPU |
| 缺点 | 过期键长期不被访问就一直占内存 |
| 适用 | 作为补充策略，处理「访问到的过期键」 |

### 1.3 定期删除 {#active-expire}

定期删除指「定时主动扫描并删除一批过期键」——每隔一段时间随机抽取一些键，删除其中已过期的。

#### 1.3.1 执行机制

定期删除为什么不遍历整个 `expires` 字典、而是随机抽样？`expires` 可能包含海量键，全量扫描会长时间阻塞主线程，让所有命令排队等待。随机抽样把每次删除的耗时限制在一个固定量级内，CPU 开销可控；代价是可能漏掉部分过期键，这些漏网的键交给惰性删除兜底。

Redis 的定期删除分 fast 与 slow 两种模式，各自独立运行（常量定义见 Redis 源码 `expire.c`）：

| 模式 | 触发位置 | 单次时间片 | 作用 |
| :-- | :-- | :-- | :-- |
| slow | `serverCron`（周期约 100ms） | 约占周期的 25% | 常规清理 |
| fast | `beforeSleep`（每次事件循环前） | 约 1ms | 快速清理刚过期的键 |

slow 模式每次执行：

```txt
每次执行：
1. 从 expires 字典随机抽取 20 个键
2. 删除其中已过期的键
3. 若已过期键占比 > 25%，重复步骤 1~2（继续这一轮）
4. 否则本轮结束，等待下一次（约 100ms 后）
```

抽样参数：

| 参数 | 含义 |
| :-- | :-- |
| 20 个 | 每次随机抽取的键数量 |
| 25% | 过期占比阈值，超过则继续扫描 |

时间片不是固定值，而是在执行过程中动态结算：每删一批键就累加耗时，接近时间片上限即停止本轮，把剩余工作留给下一轮。这样即使过期键堆积，也不会单次阻塞主线程超过时间片。

两个可调参数：`active-expire-effort`（Redis 6.2+，默认 1，范围 1–10）是 Redis 定期删除的“力度系数”。它按比例放大抽样数量、CPU 时间片和连续扫描概率，使过期键清理更积极，但也增加 CPU 开销；`hz`（默认 10）控制 `serverCron` 每秒执行次数，间接决定 slow 模式的执行频率——上表「约 100ms」即由 `hz=10` 得出（1000ms ÷ 10）。

#### 1.3.2 为什么是 25%

如果过期键占比很高（> 25%），说明大量键已经过期但还没清理，需要继续扫描以释放内存。如果占比低（≤ 25%），说明过期键不多，扫描一轮就够了，避免浪费 CPU。

#### 1.3.3 特点

| 维度 | 说明 |
| :-- | :-- |
| 优点 | 主动清理，避免过期键长期堆积 |
| 缺点 | 随机抽取，可能漏掉部分过期键 |
| 时间上限 | 单次执行有 CPU 时间上限（25ms），防止阻塞主线程 |

### 1.4 两种策略的配合

惰性删除与定期删除是互补的：

![惰性删除与定期删除配合](/redis/02-standalone-core-chapter-06-expiration-eviction-2.svg)

| 策略 | 触发方式 | 优点 | 缺点 |
| :-- | :-- | :-- | :-- |
| 惰性删除 | 访问时触发 | 不消耗额外 CPU | 不访问就永远不删 |
| 定期删除 | 周期性主动触发（fast + slow） | 主动清理 | 随机抽样可能漏掉 |

两者结合，既避免「过期键长期占内存」（纯惰性的缺点），又避免「扫描开销过大阻塞服务」（纯定期的缺点）。

> 即使有这两种策略，仍可能有少量过期键暂时留在内存里。当内存紧张时，就会触发内存淘汰策略（见 §2.2）来兜底。

### 1.5 过期键与持久化

| 持久化方式 | 过期键处理 |
| :-- | :-- |
| RDB | 写入 RDB 时跳过已过期的键；加载 RDB 时，主节点跳过过期键，从节点保留（保证与主节点一致） |
| AOF | 过期键被删除时追加 DEL 命令；AOF 重写时跳过已过期的键 |
| 从库 | 从库不主动删除过期键，等主节点发来 DEL 命令后才删除 |

> 从库的过期键处理依赖主节点的 DEL 传播。如果主从之间网络延迟大，从库可能短暂返回已过期的数据。

### 1.6 过期删除的坑 {#production-notes}

| 问题 | 说明 |
| :-- | :-- |
| 大量键同时过期 | 触发定期删除风暴，CPU 飙升。解决方案：TTL 加随机偏移（见 [缓存失效：穿透·击穿·雪崩](../../scenarios/01-cache/chapter-01-cache-invalidation.md)） |
| 过期键不被访问 | 只靠定期删除清理，可能清理不及时。设置合理的 maxmemory 兜底 |
| EXPIRE 精度 | EXPIRE 精度为毫秒，但实际删除可能有延迟（取决于定期删除的扫描频率） |

## 2. 内存淘汰

### 2.1 maxmemory 配置

`maxmemory` 是 Redis 允许使用的最大内存，达到上限后触发淘汰。

```bash
maxmemory 4gb
maxmemory-policy allkeys-lru
```

设置建议：

| 建议 | 说明 |
| :-- | :-- |
| 留出余量 | 设为物理内存的 60%~80%，预留 fork COW 和系统开销 |
| 必须设上限 | 不设上限时内存会持续增长直到被 OOM Killer 杀死 |
| 配合策略 | 上限 + 淘汰策略配套使用 |

当内存达到 `maxmemory` 时，Redis 根据 `maxmemory-policy` 指定的策略淘汰键。若策略是 `noeviction`（不淘汰），则写命令直接报错。

### 2.2 八种淘汰策略 {#eviction-policies}

淘汰策略 = 「淘汰范围」×「淘汰算法」的组合。

```txt
范围：allkeys（所有键） / volatile（只淘汰设置了 TTL 的键）
算法：lru / lfu / random / ttl
```

| 策略 | 范围 | 算法 | 说明 |
| :-- | :-- | :-- | :-- |
| `noeviction` | — | — | 不淘汰，写命令报 OOM 错误 |
| `allkeys-lru` | 所有键 | LRU | 淘汰最近最少使用的键 |
| `allkeys-lfu` | 所有键 | LFU | 淘汰使用频率最低的键 |
| `allkeys-random` | 所有键 | 随机 | 随机淘汰 |
| `volatile-lru` | 有 TTL 的键 | LRU | 淘汰最近最少使用的、有过期时间的键 |
| `volatile-lfu` | 有 TTL 的键 | LFU | 淘汰使用频率最低的、有过期时间的键 |
| `volatile-random` | 有 TTL 的键 | 随机 | 随机淘汰有过期时间的键 |
| `volatile-ttl` | 有 TTL 的键 | TTL | 淘汰剩余 TTL 最短的键 |

选型建议：

| 场景 | 推荐策略 |
| :-- | :-- |
| 纯缓存（键都有 TTL） | `allkeys-lru` 或 `allkeys-lfu` |
| 部分键不能丢（永久数据） | `volatile-lru`（只淘汰有 TTL 的） |
| 访问模式无明显热点 | `allkeys-random` |
| 热点数据需要保留 | `allkeys-lfu`（频率比时间更重要） |

### 2.3 LRU：近似实现

LRU（Least Recently Used）淘汰「最近一次访问时间最早」的键。

#### 2.3.1 为什么不用精确 LRU

精确 LRU 需要维护一个全局有序链表，每次访问都要把键移到链表头部。这对单线程的 Redis 来说开销太大——每次读写都要操作链表，O(1) 的 GET 变成 O(1)+链表操作。

#### 2.3.2 近似 LRU 算法

Redis 的近似 LRU：

```txt
1. 随机抽样 N 个键（N = maxmemory-samples，默认 5）
2. 比较这 N 个键的「最后一次访问时间」（lru 字段）
3. 淘汰其中最久未访问的那个
```

```bash
maxmemory-samples 10   # 采样数越大越接近精确 LRU，但 CPU 开销也越大
```

采样数是精度与 CPU 开销的权衡：抽样越多，越可能命中真正的最久未访问键，但每次淘汰要遍历更多键。Redis 作者 antirez 在《Random notes on improving the Redis LRU algorithm》中的结论是：增大采样数能显著逼近精确 LRU，但收益随采样数递增而递减，因此默认值取 5 作为起点。

#### 2.3.3 LRU 时钟

Redis 用一个 24 位的时钟（`lruclock`）记录访问时间，精度为秒，约 194 天溢出一次：

```c
// redisObject 中的 lru 字段（24 位）
typedef struct redisObject {
    unsigned type:4;
    unsigned encoding:4;
    unsigned lru:LRU_BITS;  // 24 位，记录最后一次访问时间
    int refcount;
    void *ptr;
} robj;
```

每次访问键时更新 `lru` 为当前时钟值。淘汰时比较 `lru` 值，最小的（最久未访问）被淘汰。

### 2.4 LFU：近似实现

LFU（Least Frequently Used）淘汰「访问次数最少」的键，解决了 LRU 的问题。

#### 2.4.1 LFU 数据结构

Redis 用 `redisObject` 的 `lru` 字段（24 位）同时存储两个信息：

```txt
高 16 位：ldt（last decrement time）— 上次衰减时间
低 8 位：logc（logistic counter）— 访问频率（对数计数器）
```

#### 2.4.2 对数计数器

访问频率不是简单的计数器，而是对数增长的：

```txt
概率 = 1 / (counter * lfu_log_factor + 1)

counter 越大，增长越慢
lfu_log_factor 默认 10，counter=100 时增长概率约为 1/1001
```

为什么用对数？避免热点键的计数器无限增长，让冷热数据之间有区分度的同时不会溢出。

#### 2.4.3 衰减机制

LFU 的计数器随时间衰减，避免历史热点永远霸占内存：

```txt
上次衰减时间（ldt）与当前时间的差值 → 按 lfu-decay-time 计算衰减量
counter = counter - 衰减量
```

```bash
lfu-decay-time 1       # 每分钟衰减一次（默认 1）
lfu-log-factor 10      # 对数增长因子（默认 10）
```

衰减机制的价值：一个曾经的热点数据如果长时间不被访问，计数器会逐渐降到 0，最终被淘汰。新数据有机会进入缓存。

### 2.5 LRU vs LFU {#lru-vs-lfu}

LRU 只看「最近访问时间」，不看「访问频率」。一个键被偶然访问一次，LRU 就认为它是「新」的，不会被淘汰——即使它之后再也不会被访问。

| 维度 | LRU | LFU |
| :-- | :-- | :-- |
| 衡量标准 | 最近访问时间 | 访问频率 |
| 适合场景 | 时间局部性强 | 冷热分明 |
| 缺点 | 偶发访问被误判为热点 | 需要调参衰减因子 |
| 默认策略 | Redis 3.0 前唯一选择 | Redis 4.0+ 推荐 |

> 如果不确定用哪个，`allkeys-lfu` 是更通用的选择。LFU 的频率统计比 LRU 的时间统计更能反映真实的访问模式。

### 2.6 内存碎片

内存碎片指「Redis 实际分配的内存」与「实际使用的内存」之间的差值。

#### 2.6.1 查看碎片率

```bash
INFO memory
# used_memory:1073741824       # Redis 分配的内存（字节）
# used_memory_rss:1610612736   # 操作系统分配给 Redis 的物理内存
# mem_fragmentation_ratio:1.50  # 碎片率 = rss / used
```

| 碎片率 | 含义 | 处理 |
| :-- | :-- | :-- |
| 0.9 ~ 1.1 | 健康 | 无需处理 |
| > 1.5 | 碎片较多 | 考虑整理 |
| < 1 | 使用了 swap | 内存不足，需扩容 |

#### 2.6.2 处理方式

```bash
# 在线碎片整理（Redis 4.0+）
activedefrag yes
active-defrag-ignore-bytes 100mb    # 碎片 < 100mb 不整理
active-defrag-threshold-lower 10    # 碎片率 > 10% 开始整理
active-defrag-threshold-upper 100   # 碎片率 > 100% 全力整理
```

> 碎片整理会消耗 CPU，建议先观察碎片率与 CPU 使用情况再决定是否开启。碎片率高且 CPU 空闲时才值得开启。

### 2.7 生产调优

| 配置 | 建议值 | 说明 |
| :-- | :-- | :-- |
| `maxmemory` | 物理内存的 60%~80% | 预留 fork 和系统开销 |
| `maxmemory-policy` | `allkeys-lfu` | 通用场景推荐 |
| `maxmemory-samples` | 10 | 采样数越大越精确，CPU 开销越大 |
| `lfu-log-factor` | 10 | 默认即可，除非有特殊访问模式 |
| `lfu-decay-time` | 1 | 默认即可 |

```bash
# 生产配置示例
maxmemory 8gb
maxmemory-policy allkeys-lfu
maxmemory-samples 10
```
