# 内存淘汰

> 内存是有限的。当 Redis 内存达到上限、又有新数据要写入时，就需要淘汰一部分旧数据。本章讲解 `maxmemory` 上限、8 种淘汰策略，以及 LRU 与 LFU 算法的近似实现。

## 1. maxmemory 配置

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

## 2. 八种淘汰策略 {#eviction-policies}

淘汰策略 = 「淘汰范围」×「淘汰算法」的组合。

```text
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

## 3. LRU：近似实现

LRU（Least Recently Used）淘汰「最近一次访问时间最早」的键。

### 3.1 为什么不用精确 LRU

精确 LRU 需要维护一个全局有序链表，每次访问都要把键移到链表头部。这对单线程的 Redis 来说开销太大——每次读写都要操作链表，O(1) 的 GET 变成 O(1)+链表操作。

### 3.2 近似 LRU 算法

Redis 的近似 LRU：

```text
1. 随机抽样 N 个键（N = maxmemory-samples，默认 5）
2. 比较这 N 个键的「最后一次访问时间」（lru 字段）
3. 淘汰其中最久未访问的那个
```

```bash
maxmemory-samples 10   # 采样数越大越接近精确 LRU，但 CPU 开销也越大
```

采样数是精度与 CPU 开销的权衡：抽样越多，越可能命中真正的最久未访问键，但每次淘汰要遍历更多键。Redis 作者 antirez 在《Random notes on improving the Redis LRU algorithm》中的结论是：增大采样数能显著逼近精确 LRU，但收益随采样数递增而递减，因此默认值取 5 作为起点。

### 3.3 LRU 时钟

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

### 3.4 LRU 的问题 {#lru-problems}

LRU 只看「最近访问时间」，不看「访问频率」。一个键被偶然访问一次，LRU 就认为它是「新」的，不会被淘汰——即使它之后再也不会被访问。

## 4. LFU：近似实现

LFU（Least Frequently Used）淘汰「访问次数最少」的键，解决了 LRU 的问题。

### 4.1 LFU 数据结构

Redis 用 `redisObject` 的 `lru` 字段（24 位）同时存储两个信息：

```text
高 16 位：ldt（last decrement time）— 上次衰减时间
低 8 位：logc（logistic counter）— 访问频率（对数计数器）
```

### 4.2 对数计数器

访问频率不是简单的计数器，而是对数增长的：

```text
概率 = 1 / (counter * lfu_log_factor + 1)

counter 越大，增长越慢
lfu_log_factor 默认 10，counter=100 时增长概率约为 1/1001
```

为什么用对数？避免热点键的计数器无限增长，让冷热数据之间有区分度的同时不会溢出。

### 4.3 衰减机制

LFU 的计数器随时间衰减，避免历史热点永远霸占内存：

```text
上次衰减时间（ldt）与当前时间的差值 → 按 lfu-decay-time 计算衰减量
counter = counter - 衰减量
```

```bash
lfu-decay-time 1       # 每分钟衰减一次（默认 1）
lfu-log-factor 10      # 对数增长因子（默认 10）
```

衰减机制的价值：一个曾经的热点数据如果长时间不被访问，计数器会逐渐降到 0，最终被淘汰。新数据有机会进入缓存。

### 4.4 LRU vs LFU

| 维度 | LRU | LFU |
| :-- | :-- | :-- |
| 衡量标准 | 最近访问时间 | 访问频率 |
| 适合场景 | 时间局部性强 | 冷热分明 |
| 缺点 | 偶发访问被误判为热点 | 需要调参衰减因子 |
| 默认策略 | Redis 3.0 前唯一选择 | Redis 4.0+ 推荐 |

> 如果不确定用哪个，`allkeys-lfu` 是更通用的选择。LFU 的频率统计比 LRU 的时间统计更能反映真实的访问模式。

## 5. 内存碎片

内存碎片指「Redis 实际分配的内存」与「实际使用的内存」之间的差值。

### 5.1 查看碎片率

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

### 5.2 处理方式

```bash
# 在线碎片整理（Redis 4.0+）
activedefrag yes
active-defrag-ignore-bytes 100mb    # 碎片 < 100mb 不整理
active-defrag-threshold-lower 10    # 碎片率 > 10% 开始整理
active-defrag-threshold-upper 100   # 碎片率 > 100% 全力整理
```

> 碎片整理会消耗 CPU，建议先观察碎片率与 CPU 使用情况再决定是否开启。碎片率高且 CPU 空闲时才值得开启。

## 6. 生产调优

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
