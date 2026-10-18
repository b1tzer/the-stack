# 过期与淘汰

> 内存有限，键会因过期被删除，也会在内存超限时被淘汰。过期由 TTL 决定删除时机，淘汰则由 `maxmemory` 与 `maxmemory-policy` 决定保留哪些键。本章先讲过期的删除，再讲超限的淘汰。

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

过期时间单独存放在 `expires` 字典里，与主数据字典分离。检查一个键是否设置了过期时间，查 `expires` 字典即可，字典查询平均为 O(1)；要判断键是否已经过期，还需把截止时间与当前时间比较。

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

以上伪代码描述主节点的简化逻辑；从库读取到过期键时按不存在处理，不主动删除、也不传播 DEL（见 §1.5）。

特点：

| 维度 | 说明 |
| :-- | :-- |
| 优点 | 不做后台主动扫描，只在访问路径上附带检查 |
| 缺点 | 过期键长期不被访问就一直占内存 |
| 适用 | 作为补充策略，处理「访问到的过期键」 |

### 1.3 定期删除 {#active-expire}

定期删除指「定时主动扫描并删除一批过期键」——每隔一段时间随机抽取一些键，删除其中已过期的。

#### 1.3.1 执行机制

定期删除为什么不遍历整个 `expires` 字典、而是随机抽样？`expires` 可能包含海量键，全量扫描会长时间阻塞主线程，让所有命令排队等待。随机抽样把每轮删除的工作量限制在可控范围内，CPU 开销可控；代价是单轮扫描不保证清除全部过期键，未清理的键可能在后续主动扫描中被删除，也可能在访问时由惰性删除处理。

Redis 的主动过期清理有 fast 与 slow 两种执行模式（常量定义见 Redis 源码 `expire.c`）。slow cycle 由 `serverCron` 周期性触发，是主要的清理路径；fast cycle 在事件循环的 `beforeSleep` 路径上尝试执行，用于补充清理。fast cycle 受执行间隔、过期键残留情况和前一次 slow cycle 是否耗尽时间预算等条件限制，并非每次进入 `beforeSleep` 都会运行。

| 模式 | 触发位置 | 单次时间预算 | 作用 |
| :-- | :-- | :-- | :-- |
| slow | `serverCron`（默认 `hz=10`，周期约 100ms） | 默认约 `1000/hz × 25%`，`hz=10` 时约 25ms | 常规清理 |
| fast | 事件循环的 `beforeSleep` 路径 | 默认约 1ms，受 `active-expire-effort` 等参数影响 | 补充清理过期键 |

slow 模式每次执行：

以下描述的是默认 `active-expire-effort=1` 时的基准行为；20 是每轮数据库循环的抽样量，不代表整个 cycle 只检查 20 个键。

```txt
每次执行：
1. 从 expires 字典随机抽取 20 个键（默认 effort 下的基准抽样量）
2. 删除其中已过期的键
3. 默认 effort 下，若已过期键占比仍 > 10%，重复步骤 1~2（继续这一轮）
4. 否则本轮结束，等待下一次（约 100ms 后）
```

抽样参数：

| 参数 | 含义 |
| :-- | :-- |
| 20 个 | 每轮处理的基础抽样数量；实际工作量受 effort 和执行时间预算影响 |
| 10% | 判断是否继续清理的过期键残留比例阈值，不是整个数据库允许残留的过期键比例 |
| 25% | slow cycle 时间预算占 `serverCron` 周期的比例，不是过期键占比阈值 |

时间片不是固定值，而是在执行过程中动态结算：Redis 会在执行过程中定期检查耗时，达到时间预算后结束本轮，把剩余工作留给下一轮；检查并非每个操作都执行，因此实际耗时可能略超预算。这样即使过期键堆积，也不会单次阻塞主线程过久。每轮抽样后，Redis 根据过期键残留比例决定是否继续清理，同时受本轮时间预算限制。

两个可调参数：`active-expire-effort`（Redis 6.2+，默认 1，范围 1–10）是 Redis 的主动过期清理力度。提高它会增加每轮抽样量和时间预算，并降低继续清理所允许的过期键残留比例，清理更积极，但也会占用更多 CPU；`hz`（默认 10）控制 `serverCron` 每秒执行次数，间接决定 slow 模式的执行频率——上表「约 100ms」即由 `hz=10` 得出（1000ms ÷ 10）。

#### 1.3.2 特点

| 维度 | 说明 |
| :-- | :-- |
| 优点 | 主动清理，避免过期键长期堆积 |
| 缺点 | 随机抽样，可能漏掉部分过期键 |
| 时间上限 | 默认 `hz=10`、effort=1 时 slow cycle 约 25ms；实际值随 `hz`、effort 和模式变化 |

### 1.4 两种策略的配合

惰性删除与定期删除是互补的：

![惰性删除与定期删除配合](/redis/02-standalone-core-chapter-06-expiration-eviction-2.svg)

| 策略 | 触发方式 | 优点 | 缺点 |
| :-- | :-- | :-- | :-- |
| 惰性删除 | 访问时触发 | 不消耗额外 CPU | 不访问就永远不删 |
| 定期删除 | 周期性主动触发（fast + slow） | 主动清理 | 单轮扫描不保证清除全部 |

> 即使有这两种策略，仍可能有少量过期键暂时留在内存里。当内存紧张时，就会触发内存淘汰策略（见 §2.2）来兜底。

### 1.5 过期键与持久化

| 持久化方式 | 过期键处理 |
| :-- | :-- |
| RDB | 生成 RDB 时不保存已过期的键；加载时主节点跳过已过期键，从节点可保留这些键，后续由主节点的过期处理与复制传播保持一致 |
| AOF | 过期键被实际删除时，删除操作会传播为 DEL 命令；AOF 重写时跳过已过期的键 |
| 从库 | 从库通常不主动物理删除过期键，而是等主节点传播删除操作；读取时仍检查过期状态，已过期键按不存在处理 |

> 在正常复制和键访问路径下，从库会将已过期的键按不存在处理；实际删除通常由主节点执行，并通过复制传播到从库。复制延迟可能延后从库的物理清理，但不意味着从库会正常返回已过期键的值。

### 1.6 Hash 字段过期（Redis 7.4+） {#hash-field-expiry}

Redis 7.4 起，除了给整个 Key 设置 TTL，还可以只让 Hash 中的部分字段过期：

```bash
HSET session:alice status active profile cached
HEXPIRE session:alice 300 NX FIELDS 2 status profile
HTTL session:alice FIELDS 2 status profile
HPERSIST session:alice FIELDS 1 status
```

`HEXPIRE`、`HEXPIREAT`、`HPEXPIRE`、`HPEXPIREAT` 设置字段过期时间，`HTTL`、`HPTTL` 查询剩余时间，`HPERSIST` 移除字段过期时间。字段级 TTL 与 Key 级 TTL 相互独立：字段过期不会自动设置整个 Hash 的 TTL，Key 过期时则整个 Hash 及其字段都会失效。

### 1.7 过期删除的坑 {#production-notes}

| 问题 | 说明 |
| :-- | :-- |
| 大量键同时过期 | 大量键集中到期会增加主动过期清理与命令访问路径上的删除工作，可能推高 CPU 与延迟。解决方案：TTL 加随机偏移（见 [缓存失效：穿透·击穿·雪崩](../../scenarios/01-cache/chapter-01-cache-invalidation.md)） |
| 过期键不被访问 | 只靠定期删除清理，可能清理不及时。设置合理的 maxmemory 兜底 |
| 过期精度 | `EXPIRE` 按秒设置，`PEXPIRE` 按毫秒设置；实际删除可能因惰性检查和后台扫描而稍晚发生 |

## 2. 内存淘汰

### 2.1 maxmemory 配置

`maxmemory` 是 Redis 内部允许使用的最大内存（并非进程 RSS 或容器内存的硬上限），达到该阈值后触发淘汰。

```bash
maxmemory 4gb
maxmemory-policy allkeys-lru
```

设置建议：

| 建议 | 说明 |
| :-- | :-- |
| 留出余量 | 根据系统、监控、网络缓冲、写入模式和 fork/COW 实测预留空间，不套用固定比例 |
| 必须设上限 | 不设上限时 Redis 不会通过该配置限制数据集内存；业务持续写入可能挤占系统内存，甚至触发容器或操作系统的 OOM 处理 |
| 配合策略 | 上限 + 淘汰策略配套使用 |

当内存达到 `maxmemory` 时，Redis 根据 `maxmemory-policy` 指定的策略淘汰键。使用 `noeviction` 时，Redis 不通过淘汰键释放空间；当命令需要分配内存而又无法满足内存限制时，相关写入可能返回 OOM 错误，只读命令通常仍可执行。

### 2.2 淘汰策略 {#eviction-policies}

淘汰策略 = 「淘汰范围」×「淘汰算法」的组合。下表按 Redis 8.4 及以前的经典策略介绍，Redis 8.6 起新增了按最近修改时间淘汰的 `allkeys-lrm` 与 `volatile-lrm`（见下方说明）。

```txt
范围：allkeys（所有键） / volatile（只淘汰设置了 TTL 的键）
算法：lru / lfu / random / ttl，8.6 起新增 lrm
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
| `allkeys-lrm` | 所有键 | LRM | 淘汰最近最少修改的键（Redis 8.6+） |
| `volatile-lrm` | 有 TTL 的键 | LRM | 淘汰最近最少修改的、有过期时间的键（Redis 8.6+） |

> `allkeys-lrm` 与 `volatile-lrm` 是 Redis 8.6 引入的 LRM（Least Recently Modified）策略。LRM 与 LRU 的区别在时间戳刷新时机：LRU 在读和写时都刷新，LRM 只在写时刷新。因此 LRM 适合希望淘汰长期未更新数据、而不希望频繁读取延长其保留时间的场景；若热点主要由持续读取形成，应先验证 LRM 对缓存命中率的影响再决定是否采用。这两个策略在 8.6 之前不存在，配置后旧版本会拒绝。

选型建议：

| 场景 | 推荐策略 |
| :-- | :-- |
| 纯缓存（键都有 TTL） | `allkeys-lru` 或 `allkeys-lfu` |
| 部分键不能丢（永久数据） | `volatile-lru`（只淘汰有 TTL 的） |
| 访问模式无明显热点 | `allkeys-random` |
| 热点数据需要保留 | `allkeys-lfu`（频率比时间更重要） |

> `volatile-*` 只从设置了 TTL 的键中挑选淘汰对象。当库中没有符合条件的键时，Redis 无法继续通过当前策略释放内存，内存限制下的写命令会像 `noeviction` 一样返回 OOM 错误。因此采用 `volatile-*` 时，需持续关注带 TTL 键的数量，并确认业务能处理候选键不足时的写入失败。

### 2.3 LRU：近似实现

LRU（Least Recently Used）淘汰「最近一次访问时间最早」的键。

#### 2.3.1 为什么不用精确 LRU

精确 LRU 需要维护键的全局访问顺序，每次相关访问都要更新访问记录，才能准确找出最久未访问的键。Redis 选择近似 LRU：记录键的最近访问时间，内存不足时通过随机抽样挑选淘汰候选。这样不必为每次访问维护全局有序结构，能在控制额外开销的同时获得较好的淘汰效果。

#### 2.3.2 近似 LRU 算法

Redis 的近似 LRU：

```txt
1. 随机抽样 N 个键（N = maxmemory-samples，默认 5）
2. 把候选键放入固定大小的淘汰池（eviction pool），按空闲时间排序，保留更可能被淘汰的键；后续采样会继续更新这个池
3. 内存不足时，从池中选空闲时间最长的键淘汰
```

```bash
maxmemory-samples 10   # 采样数越大越接近精确 LRU，但 CPU 开销也越大
```

采样数是精度与 CPU 开销的权衡：抽样越多，越可能命中真正的最久未访问键，但 CPU 成本也上升。Redis 作者 antirez 在《Random notes on improving the Redis LRU algorithm》中指出，增大采样数能显著逼近精确 LRU，但收益随采样数递增而递减，因此默认值取 5 作为起点。

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

Redis 在对象访问路径中维护最近访问时间，压缩存储在 `lru` 字段中。淘汰时需要根据当前时钟与对象记录的时间戳计算经过的时间，并处理 24 位时钟的回绕，不能直接按 `lru` 字段数值大小排序：24 位时钟约 194 天回绕一次，直接比数值会把回绕后不久访问的键误判成最久未访问。

### 2.4 LFU：近似实现

LFU（Least Frequently Used）根据近似访问频率淘汰键。与 LRU 相比，它不容易因为一次近期访问就把冷数据当成热点，但需要通过计数器衰减适应访问模式的变化。

#### 2.4.1 LFU 数据结构

Redis 用 `redisObject` 的 `lru` 字段（24 位）同时存储两个信息：

```txt
高 16 位：ldt（last decrement time）— 用于衰减计算的时间记录
低 8 位：logc（logistic counter）— 访问频率（对数计数器）
```

#### 2.4.2 对数计数器

访问频率不是简单计数器，计数器采用概率递增，而不是每次访问都加一。增长概率随当前计数值增大而降低：

```txt
概率 = 1 / (counter * lfu-log-factor + 1)

counter 越大，增长越慢
lfu-log-factor 默认 10，counter=100 时增长概率约为 1/1001
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

一个曾经的热点键如果长时间不再被访问，其 LFU 计数会随时间衰减。内存紧张时，它不再像持续被访问的键那样占据淘汰优势。

### 2.5 LRU vs LFU {#lru-vs-lfu}

LRU 只看「最近访问时间」，不看「访问频率」。一次近期访问会暂时降低键被淘汰的概率，但这不代表它此后不会被淘汰——LRU 只影响候选键的优先级，不承诺近期访问过的键一定保留。

| 维度 | LRU | LFU |
| :-- | :-- | :-- |
| 衡量标准 | 最近访问时间 | 访问频率 |
| 适合场景 | 时间局部性强 | 冷热分明 |
| 缺点 | 偶发访问被误判为热点 | 需要调参衰减因子 |
| 默认策略 | Redis 3.0 前唯一选择 | Redis 4.0 引入 |

### 2.6 内存碎片

`used_memory` 反映 Redis 分配器统计的内存使用量，`used_memory_rss` 反映操作系统统计的 Redis 进程常驻内存。两者的差异不仅可能来自内存碎片，还可能来自分配器的内存保留行为，以及代码、共享库、栈等未计入 `used_memory` 的进程内存开销；共享内存和内存页的驻留情况也会影响 RSS 的统计结果。

#### 2.6.1 查看内存指标

```bash
INFO memory
# used_memory:1073741824       # Redis 分配器统计的内存（字节）
# used_memory_rss:1610612736   # 操作系统统计的进程常驻内存（字节）
# mem_fragmentation_ratio:1.50  # rss / used
```

`mem_fragmentation_ratio` 是 `used_memory_rss / used_memory`，只是观察指标，不能单独用来判断是否存在严重碎片。排查内存差值可按以下顺序：

```txt
1. 看 used_memory 与 used_memory_rss 的绝对差值是否足够大
2. 看 allocator_frag_bytes、allocator_rss_bytes、rss_overhead_bytes 等指标，区分分配器碎片、分配器驻留内存与分配器之外的 RSS 开销
3. 回顾最近是否有大规模删除、数据集缩小或内存峰值
4. 检查是否存在 swap、容器内存限制或共享内存因素
```

#### 2.6.2 主动碎片整理

```bash
# 在线碎片整理（Redis 4.0+）
activedefrag yes
active-defrag-ignore-bytes 100mb    # 碎片小于该值不整理
active-defrag-threshold-lower 10    # 碎片率高于该值开始整理
active-defrag-threshold-upper 100   # 碎片率高于该值以最大强度整理
```

> 碎片整理会消耗 CPU。应结合分配器指标、内存差值和延迟测试决定是否开启，而不是只凭碎片率一个数字。

### 2.7 生产调优

| 配置 | 建议值 | 说明 |
| :-- | :-- | :-- |
| `maxmemory` | 由容量压测和故障场景确定 | 预留系统、网络缓冲和 fork/COW 空间 |
| `maxmemory-policy` | 缓存场景按访问模式选择 | 不可淘汰数据用 `noeviction`，并接受内存满时写失败 |
| `maxmemory-samples` | 5（默认） | 采样数越大越精确，CPU 开销越大 |
| `lfu-log-factor` | 10 | 默认即可，除非有特殊访问模式 |
| `lfu-decay-time` | 1 | 默认即可 |

```bash
# 以下仅展示配置项组合方式，内存上限、淘汰算法与采样数应结合部署资源和访问模式确定
maxmemory 8gb
maxmemory-policy allkeys-lfu
maxmemory-samples 10
```
