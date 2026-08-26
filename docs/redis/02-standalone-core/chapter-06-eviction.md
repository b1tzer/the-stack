# 内存淘汰

> 内存是有限的。当 Redis 内存达到上限、又有新数据要写入时，就需要淘汰一部分旧数据。本章讲解 `maxmemory` 上限、8 种淘汰策略，以及 LRU 与 LFU 算法的差异。

## 1. maxmemory 配置

`maxmemory` 是 Redis 允许使用的最大内存，达到上限后触发淘汰。

```bash
maxmemory 4gb              # 内存上限
maxmemory-policy allkeys-lru   # 淘汰策略
```

设置建议：

| 建议 | 说明 |
| :-- | :-- |
| 留出余量 | 设为物理内存的 60%~80%，预留系统与 fork 开销 |
| 必须设上限 | 不设上限时内存会持续增长直到被 OOM 杀死 |
| 配合策略 | 上限 + 淘汰策略配套使用 |

当内存达到 `maxmemory` 时，Redis 根据 `maxmemory-policy` 指定的策略淘汰键。若策略是 `noeviction`（不淘汰），则写命令直接报错。

## 2. 八种淘汰策略

淘汰策略 = 「淘汰范围」×「淘汰算法」的组合。

```text
范围：allkeys（所有键） / volatile（只淘汰设置了 TTL 的键）
算法：lru / lfu / random / ttl
```

| 策略 | 范围 | 算法 | 说明 |
| :-- | :-- | :-- | :-- |
| `noeviction` | — | — | 不淘汰，写命令报错 |
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

## 3. LRU 与 LFU

LRU（Least Recently Used）与 LFU（Least Frequently Used）是两种主流淘汰算法，衡量标准不同。

### 3.1 LRU：最近最少使用

LRU 淘汰「最近一次访问时间最早」的键。适合「近期访问过的数据更可能再次被访问」的场景。

```text
键 A：最近访问 10 秒前
键 B：最近访问 1 小时前
→ 淘汰 B（更久没被访问）
```

Redis 的 LRU 是**近似 LRU**：随机抽样 N 个键，淘汰其中「最久未访问」的那个，而非精确维护全局有序链表。采样数越大越接近精确 LRU，但 CPU 开销也越大。

### 3.2 LFU：最不经常使用

LFU 淘汰「访问次数最少」的键。适合「冷热数据分明、需要区分高频与低频」的场景。

```text
键 A：访问 100 次
键 B：访问 2 次
→ 淘汰 B（访问次数更少）
```

LFU 在 LRU 基础上增加了「访问频率计数」，并引入**衰减机制**：计数随时间递减，避免老热点永远霸占内存、新键无法进入。

### 3.3 对比

| 维度 | LRU | LFU |
| :-- | :-- | :-- |
| 衡量标准 | 最近访问时间 | 访问频率 |
| 适合场景 | 时间局部性强（最近访问的更可能再访问） | 冷热分明（需要区分高频/低频） |
| 缺点 | 偶发访问会被误判为热点 | 需要处理计数衰减 |

## 4. 内存碎片

内存碎片指「Redis 实际分配的内存」与「实际使用的内存」之间的差值，通常由频繁的键增删导致。

### 4.1 查看碎片率

```bash
INFO memory
# used_memory          Redis 实际使用的内存
# used_memory_rss      操作系统分配给 Redis 的物理内存
# mem_fragmentation_ratio = rss / used_memory
```

| 碎片率 | 含义 | 处理 |
| :-- | :-- | :-- |
| ≈ 1 | 健康 | 无需处理 |
| > 1.5 | 碎片较多 | 考虑整理 |
| < 1 | 使用了 swap | 内存不足，需扩容 |

### 4.2 处理方式

| 方式 | 说明 |
| :-- | :-- |
| 重启 | 最彻底但影响服务 |
| `activedefrag yes` | 在线整理（4.0+，默认关闭，需评估 CPU 开销） |

```bash
activedefrag yes          # 开启自动碎片整理
active-defrag-ignore-bytes 100mb   # 碎片小于 100mb 不整理
```

> 碎片整理会消耗 CPU，建议先观察碎片率与 CPU 使用情况再决定是否开启。碎片率高且 CPU 空闲时才值得开启在线整理。
