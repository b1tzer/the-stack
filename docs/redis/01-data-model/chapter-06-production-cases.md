# 线上问题案例集

> 学完数据模型五章，得到的是一套「现象 → 机制」的判断框架：内存为什么突然暴涨、删了数据为什么不降、UV 为什么和数据库对不上。这些看似玄学的线上现象，都能在数据结构与编码机制里找到确定解释。本章收集 5 个公开的真实事故，每个案例回答三件事——现象是什么、根因落在哪个知识点、怎么处理和预防。

## 1. 知识地图：数据模型能解释哪些生产问题

5 个案例的根因全部落在前五章的知识点上。先建立映射，再逐个展开：

![数据模型知识点与生产问题映射](/redis/01-data-model-chapter-06-production-cases-1.svg)

| 知识点 | 生产问题 | 案例 |
| :-- | :-- | :-- |
| String 单值结构，整存整取 | 大 Key 阻塞、带宽打满 | [案例一](#case-1) |
| BitMap 建立在 String 之上 | 稀疏偏移量撑爆内存 | [案例二](#case-2) |
| 紧凑编码 ↔ 普通编码切换 | 编码不可逆升级、内存翻倍 | [案例三](#case-3) |
| HyperLogLog 概率基数统计 | UV 对账对不上 | [案例四](#case-4) |
| SDS 惰性释放 + 分配器碎片 | 内存只涨不降（RSS 偏高） | [案例五](#case-5) |

## 2. 案例一：用 String 存整块对象，一个 Key 打满带宽 {#case-1}

### 2.1 现象

2024 年双十一，京东科技上线一个促销活动。后端把整套活动配置（规则、奖励项）打包成一个对象，序列化后整体写入一个 String key，体积约 1.5MB。

活动生效的瞬间，所有服务实例的本地缓存同时失效（冷启动），几千 QPS 穿透到同一个 key。Redis 单个分片设了 200Mbps 网络限流（约 25MB/s），25MB/s ÷ 1.5MB ≈ 16 次/秒的有效吞吐，远低于实际并发。分片网络随即拥塞、请求排队超时，核心服务可用率从 100% 跌到 20%。

### 2.2 根因

根因不在流量，在数据结构选错：把复杂对象当成一个 String 整存整取。

String 是单值结构，一个 key 对应一整块 value（见[基础类型 §1](./chapter-02-basic-types.md#string)）。活动配置这种几十个字段的对象，序列化成一个 String 后，每次读取都要传输完整的 1.5MB——即使调用方只用到其中两三个字段。字段越多、对象越大，这个放大效应越明显。

这正是[基础类型 §1](./chapter-02-basic-types.md#string) 点名的反模式：「不要用 String 存整个 JSON 对象来模拟对象存储」。对象的字段应当拆开用 Hash 存，按需 `HGET` 单个字段，而不是每次 `GET` 整个对象。

1.5MB 的 String 早已超过 44 字节，编码是 `raw`，对象头和数据分离分配（见[对象编码 §3.3](./chapter-05-object-encoding.md#raw-encoding)）。但这只是次要因素，主因仍是「整块存取」这个选型。

### 2.3 处理与预防

应急手段（先止血，不阻塞）：

- 序列化瘦身：JSON 换 Protostuff，1.5MB → 500KB。
- 压缩：对超过阈值（如 100KB）的对象做 gzip，500KB → 17KB。
- 本地缓存加锁：用 `get(key, callable)` 只放一个线程回源，避免击穿。

根治手段（改结构）：

- 大对象拆字段，改用 Hash 存储，按需 `HGET`。
- 禁止缓存整表、整个聚合对象。

## 3. 案例二：BitMap 稀疏偏移量撑爆内存 {#case-2}

### 3.1 现象

三个独立事故，同一个根因：

- 腾讯云开发者社区案例：用钉钉 userId（字符串 + 数字）hash 后当 offset，hash 值 1762177145。一次 `SETBIT` 后 BitMap 达 210.07MB，生产环境 Redis 内存被吃到 60G。
- 博客园案例（2013）：用 `HHmmssss`（时分秒毫秒）当 offset，平均偏移量 11798000 位，约 1.4MB/key，2000 个 key 共占 2.8G。
- 「因为 BitMap 白白搭进去 8 台服务器」：用户 ID 稀疏（最小 1、最大 10 亿），一个 Bitmap 就占约 119MB。

### 3.2 根因

BitMap 不是独立类型，它建立在 String 之上（见[高级类型 §1](./chapter-03-advanced-types.md#bitmap)）。Redis 按 offset 分配连续内存：把第 N 位设为 1，就分配 `ceil(N/8)` 字节，中间空位全部填 0。

内存占用 = 最大 offset ÷ 8，与「实际置 1 的位数」无关。稀疏 ID 下，只有少数位是 1，内存却按最大 offset 全量分配：

```bash
SETBIT mykey 1 1            # 分配 1 字节
SETBIT mykey 100000000 1    # 分配约 12.5MB，尽管只有 2 个位是 1
MEMORY USAGE mykey          # 约 13421789 字节（12.8MB）
```

上限由 String 的 512MB 决定：offset 最大 2^32-1，超过直接报 `ERR bit offset is not an integer or out of range`。

### 3.3 处理与预防

- 先重新编号，让 ID 密集，再映射到 BitMap。
- 分段存储：IP 场景按四段拆分，每段最大 255 位。
- 稀疏数据改用 Set 或 HyperLogLog。

## 4. 案例三：紧凑编码不可逆升级，内存翻倍 {#case-3}

### 4.1 现象

51CTO 案例：运维为了让更多 Hash 走紧凑编码省内存，把 `hash-max-ziplist-entries` 从 512 调到 10240，把 `hash-max-ziplist-value` 从 64 调到 512。结果内存不降反升。

复现实验：插入 10000 个小型 Hash（每个 500 字段、每值 50 字节），紧凑编码下总内存约 300MB；调大阈值后随机给 10% 的 Hash 插入一个超 512 字节的大字段，这些 Hash 立即升级为 hashtable，总内存飙到近 1GB。

### 4.2 根因

Hash/Set/ZSet 在元素少、值小时用紧凑编码（listpack，连续内存、无指针），超过阈值切换 hashtable（有桶数组和指针开销，见[对象编码 §4](./chapter-05-object-encoding.md#hash-encoding)）。

两个机制叠加：

1. **切换是单向的**：一旦升级为 hashtable，即使删掉超长字段也降不回 listpack（见[对象编码 §4.3](./chapter-05-object-encoding.md#irreversible)）。
2. **调大阈值反而增加升级概率**：value 阈值调大后，原本会被「拒之门外」的超长字段现在会混进来，一旦写入就触发整表升级；而 entries 阈值越大，升级发生时 Hash 越「大」，成本越高。

用一个 key 验证：

```bash
HSET h a 1 b 2
OBJECT ENCODING h                           # "listpack"

HSET h c "$(printf 'x%.0s' {1..65})"        # 写一个 65 字节的 value，超过默认 64 阈值
OBJECT ENCODING h                           # "hashtable" —— 永久升级

HDEL h c
OBJECT ENCODING h                           # 仍是 "hashtable"，不会降回
```

intset 有相同的单向机制（见[底层数据结构 §5.2](./chapter-04-data-structures.md#intset-upgrade)）：Set 全存小整数时用 16 位 intset，存入一个 70000 升级为 32 位，删掉后仍是 32 位。

### 4.3 处理与预防

- 别盲目调大编码阈值，它可能适得其反。
- 用 `OBJECT ENCODING` 抽查实际编码，发现意外升级。
- 上线前按业务预估 field 数量与 value 长度，控制 key 规模。

## 5. 案例四：HyperLogLog 概率误差，UV 对账对不上 {#case-4}

### 5.1 现象

用 HyperLogLog 统计千万级 UV，运营拿 `PFCOUNT` 的结果和数据库精确值对账，发现始终对不上：1000 万 UV 的误差可达 ±8.1 万。

### 5.2 根因

HyperLogLog 是概率结构（见[高级类型 §2](./chapter-03-advanced-types.md#hyperloglog)）：固定 12KB、16384 个桶，标准误差约 0.81%。

它只能估算「大概有多少个不重复元素」，不能返回具体元素，也不能精确对账。0.81% 的误差在亿级 UV 下就是几十万的绝对偏差。当基数较小时相对误差会更大，合并多个 HLL 时误差还会累积。

### 5.3 处理与预防

- UV 等「规模」类指标，展示时标注「约」。
- 财务、审计、订单计数等强一致场景，改用 Set 或数据库精确计数。
- 需要「去重后还能取出元素」用 Set；需要「规模 + 可容忍误差」用 HLL。

## 6. 案例五：内存只涨不降——惰性释放与分配器碎片 {#case-5}

### 6.1 现象

「删了数据内存不降」在生产里其实是两类现象，常被混为一谈：

- **单个 key 缩短后不降**：value 从 10MB 缩到 10 字节，`MEMORY USAGE` 变化很小。
- **进程整体碎片不降**：大量 key 频繁增删后，`INFO memory` 里 `used_memory_rss`（进程实际占用）远高于 `used_memory`（逻辑数据量），`mem_fragmentation_ratio` 持续 > 1.5，Kubernetes 下触发 OOM Killer 重启。

### 6.2 根因

两类现象来自两个不同层面，机制不同，不能用一个原因解释。

**单 key 缩短不降，来自 SDS 惰性释放**（见[底层数据结构 §1.3](./chapter-04-data-structures.md#sds-prealloc)）。SDS 缩短字符串（`sdstrim`、`sdsclear` 这类内部操作）只改 `len`、不减小 `alloc`，多出的空间留给同一对象后续写入复用。它只发生在对象内部，规模很小；`SET` 整体覆盖或 `DEL` 会调用 `sdsfree` 真正释放旧值，不属于此列。

**进程整体碎片不降，来自分配器**。jemalloc 释放内存后不立即归还操作系统，而是留在自己的内存池复用，导致 RSS 高于逻辑数据量。这是分配器行为，与 SDS 无关。

### 6.3 处理与预防

两类现象的处理方式不同：

| 现象 | 是否需处理 | 手段 |
| :-- | :-- | :-- |
| 单 key 缩短不降 | 不需要 | 设计使然，预留空间会被复用 |
| 整体碎片高（RSS >> used_memory） | 需要 | `activedefrag` / `MEMORY PURGE` / 重启 |

- SDS 惰性释放是设计使然，不是 bug，无需针对它做任何处理。
- 碎片率持续 > 1.5 时，首选 `CONFIG SET activedefrag yes`——这是官方 4.0 起提供的在线内存整理，默认关闭，仅 jemalloc 下生效。
- `MEMORY PURGE` 是手动辅助手段：官方定义是「尝试清理脏页让分配器回收」，仅 jemalloc 有效，属 `@slow` 类别，不建议频繁调用。它只作用于分配器，回收不了 SDS 预留的空间。
- 重启最彻底，但需配合主从切换与持久化。

## 7. 小结与检查清单

5 个案例的共同点：问题不在 Redis 本身，而在「选错了结构」或「误读了机制」。

| 检查项 | 说明 |
| :-- | :-- |
| 对象用 Hash 不用 String | 避免大 Key 与全量覆盖 |
| BitMap 前先评估 ID 密集度 | 稀疏 ID 先重新编号 |
| `OBJECT ENCODING` 抽查 | 发现意外升级为 hashtable / intset |
| 不盲目调大编码阈值 | 调大可能增加升级概率 |
| 强一致统计不用 HLL | 财务对账用精确计数 |
| 关注 `used_memory` 与 RSS 差 | 识别内存碎片 |

## 8. 参考资料

- [一个1.5MB的Redis Key，让整个系统在双十一瘫痪](https://cloud.tencent.com/developer/article/2639616)（京东科技，案例一）
- [慎用BitMap，小心玩爆你的内存](https://developer.cloud.tencent.com.cn/article/2421953)（案例二）
- [线上redis服务内存异常分析](https://www.cnblogs.com/montya/p/3162114.html)（案例二）
- [因为 BitMap，白白搭进去 8 台服务器](http://www.hqwc.cn/a/898374.html)（案例二）
- [Redis内存暴增后，我发现一个容易忽视的配置陷阱](https://blog.51cto.com/itchenhan/14534692)（案例三）
- [Redis HyperLogLog：12KB搞定亿级数据去重](https://blog.csdn.net/weixin_42148384/article/details/148855697)（案例四）
- [利用Redis的HyperLogLog进行千万级独立访客统计时的误差率控制](https://m.tulingxueyuan.cn/tlzx/javamst/22549.html)（案例四）
- [Redis 生产环境大 Key 事故复盘：从内存碎片到集群雪崩](https://tsight.io/articles/11462731)（案例五）
