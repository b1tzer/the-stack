# 性能优化

> Redis 性能优化不是玄学，而是围绕几个核心维度：慢命令、内存、网络、持久化。本章先建立指标体系，再逐维度讲解优化手段，最后给出生产环境的调优清单。

本页的判断顺序是：先确定业务延迟和错误率目标，再建立同负载基线；只有指标偏离目标时才定位慢命令、内存、网络或持久化；每次只调整一个变量，并用同一压测场景对比结果。无法测量的优化不进入生产配置。

## 1. 指标体系

评估 Redis 性能，先看这几个关键指标：

| 指标 | 含义 | 获取方式 |
| :-- | :-- | :-- |
| QPS | 每秒处理请求数 | `INFO stats` 的 `instantaneous_ops_per_sec` |
| 探测延迟 | Redis 对连续 `PING` 的往返时间 | `redis-cli --latency` |
| 内存 | 内存使用与碎片 | `INFO memory` |
| 命中率 | 缓存命中比例 | `keyspace_hits / (hits+misses)` |
| 连接数 | 客户端连接数 | `INFO clients` |
| fork 耗时 | BGSAVE/AOF 重写 fork 耗时 | `INFO stats` 的 `latest_fork_usec` |
| 复制延迟 | 主从偏移量差 | `INFO replication` |

```bash
redis-cli --latency          # 持续发送 PING，测试网络和服务端往返延迟
redis-cli --latency-history  # 延迟历史趋势
redis-cli --stat             # 实时统计 QPS
INFO stats                   # 查看累计统计
INFO memory                  # 查看内存
```

> 优化的第一步是「测量」，先量化当前基线（延迟、QPS、内存），优化后再对比，避免凭感觉优化。

## 2. 慢查询优化

慢命令是 Redis 单线程模型的头号杀手——一个慢命令会阻塞所有其他请求。

### 2.1 定位慢查询

```bash
SLOWLOG GET 10              # 查看最近 10 条慢查询
SLOWLOG LEN                 # 慢查询总数
CONFIG SET slowlog-log-slower-than 10000   # 示例：超过 10ms 记为慢查询
```

### 2.2 常见慢命令与替代

| 慢命令 | 问题 | 替代方案 |
| :-- | :-- | :-- |
| `KEYS *` | 全量遍历，O(n)，阻塞 | `SCAN` 游标分批遍历 |
| `HGETALL` 大 Hash | 返回全部字段 | `HSCAN` 分批获取 |
| `SMEMBERS` 大 Set | 返回全部元素 | `SSCAN` 分批获取 |
| `DEL` 大 Key | 同步删除阻塞 | `UNLINK` 异步删除 |
| `SORT` | 排序开销大 | 业务层排序或用有序集合 |
| `FLUSHALL` | 清空全部数据 | 生产环境禁用或异步执行 |

### 2.3 SCAN 的用法

```bash
SCAN 0 MATCH user:* COUNT 100
# 返回：cursor + 一批匹配的 key
# 用返回的 cursor 继续扫描，直到 cursor=0
```

| 参数 | 含义 |
| :-- | :-- |
| `cursor` | 游标，0 表示开始 |
| `MATCH` | 过滤模式 |
| `COUNT` | 每次返回的元素数（参考值，非精确） |

> 需要循环调用 `SCAN` 直到 cursor 归零。`COUNT` 是建议数量，实际返回可能多于或少于该值。无并发修改时，完整迭代应覆盖所有元素；迭代期间发生增删时，元素可能重复或遗漏，因此 `SCAN` 不是一致性快照。

## 3. 内存优化

### 3.1 选对结构

| 场景 | 错误做法 | 正确做法 |
| :-- | :-- | :-- |
| 存对象 | `SET user:1001 "{name:'张三',age:25}"` | `HSET user:1001 name "张三" age 25` |
| 存集合 | `SET tags "java,python,go"` | `SADD tags java python go` |
| 存列表 | `LPUSH` 大量元素 | 分多个 key 或用 listpack 节点 |

### 3.2 控制编码

小数据用紧凑编码，避免触发升级：

```bash
# 查看 key 的编码
OBJECT ENCODING key

# 配置编码阈值
hash-max-listpack-entries 512
hash-max-listpack-value 64
set-max-intset-entries 512
zset-max-listpack-entries 128
```

### 3.3 设置 TTL

```bash
# 批量设置 TTL（扫描 + 设置）
SCAN 0 MATCH cache:* COUNT 1000
# 对每个 key 执行 EXPIRE

# TTL 随机化防雪崩：由客户端或 Lua 计算随机值
ttl_seconds=$((300 + RANDOM % 60))
EXPIRE key "$ttl_seconds"
```

### 3.4 maxmemory 配置

```bash
maxmemory 4gb                    # 示例值；实际值由容量压测和系统余量确定
maxmemory-policy allkeys-lfu     # 淘汰策略
maxmemory-samples 10             # 采样数
```

## 4. 网络优化

| 手段 | 说明 | 适用场景 |
| :-- | :-- | :-- |
| Pipeline | 批量命令，减少 RTT | 批量读写 |
| 连接池 | 复用连接，避免建连开销 | 所有场景 |
| 长连接 | 避免短连接反复握手 | 所有场景 |
| 避免大 Key | 大 Key 占带宽 | 所有场景 |
| Lua 脚本 | 逻辑在服务端执行，减少交互 | 复合操作 |

## 5. 持久化调优

| 配置 | 影响 | 建议 |
| :-- | :-- | :-- |
| `appendfsync always` | 每次写入后刷盘 | 仅在较低 RPO 经过业务论证和压测后使用 |
| `appendfsync everysec` | 每秒刷盘 | 生产推荐 |
| `save 900 1` | BGSAVE 频率 | 根据数据重要程度调整 |
| `rdb-save-incremental-fsync` | 增量 fsync | 大 RDB 文件时开启 |
| `no-appendfsync-on-rewrite` | 后台子进程进行重写时暂停 AOF fsync | 可减少重写期间 IO，但会扩大该阶段的数据丢失窗口 |

## 6. 大 Key 治理

大 Key 是性能问题的常见根因。大 Key 与热 Key 的定义、危害、发现与处理的完整方案见 [大 Key 与热 Key](./chapter-07-big-hot-key.md)。性能视角的结论只有一句，删除大 Key 用 `UNLINK` 而非 `DEL`，避免阻塞主线程。

## 7. 生产调优清单

| 类别 | 检查项 | 建议值 |
| :-- | :-- | :-- |
| 内存 | `maxmemory` | 按系统、容器、fork/COW 和增长速度计算 |
| 内存 | `maxmemory-policy` | 缓存按访问模式选择；主数据通常为 `noeviction` |
| 持久化 | `appendfsync` | `everysec` |
| 持久化 | 主节点持久化 | 由 RPO、副本延迟和恢复演练决定 |
| 慢查询 | `slowlog-log-slower-than` | 10000（10ms） |
| 连接 | 连接池 | 客户端框架需要复用连接时配置，并限制池大小、超时和重试 |
| 命令 | 无 KEYS/大 DEL | SCAN/UNLINK 替代 |
| 监控 | 内存/延迟/命中率 | 已接入告警 |
