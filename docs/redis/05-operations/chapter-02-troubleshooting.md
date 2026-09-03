# 阻塞与故障排查

> 线上 Redis 变慢或异常，需要一套系统的方法快速定位根因。本章介绍排查工具与常见故障的定位思路，给出可复用的排查流程。

## 1. 排查工具箱

| 工具 | 用途 | 开销 |
| :-- | :-- | :-- |
| `INFO` | 服务器状态全貌 | 低 |
| `SLOWLOG` | 慢查询日志 | 低 |
| `MONITOR` | 实时命令流 | **高**（生产慎用） |
| `CLIENT LIST` | 客户端连接详情 | 中 |
| `redis-cli --latency` | 网络延迟测试 | 低 |
| `redis-cli --bigkeys` | 大 Key 扫描 | 中（SCAN 遍历） |
| `DEBUG OBJECT key` | 单 key 详情 | 低 |
| `MEMORY USAGE key` | 单 key 内存占用 | 低 |

```bash
# 快速全貌
redis-cli INFO all > /tmp/redis-info.txt

# 命令统计（找出耗时最高的命令）
INFO commandstats
# cmdstat_set:calls=1000000,usec=50000,usec_per_call=0.05
# cmdstat_keys:calls=10,usec=500000,usec_per_call=50000.00  ← 这个有问题
```

## 2. 延迟突增排查

延迟突增是最常见的故障，按顺序排查：

![延迟排查顺序](/redis/05-operations-chapter-02-troubleshooting-1.svg)

### 2.1 慢命令

```bash
SLOWLOG GET 10
# 如果看到 KEYS *、HGETALL 大 Hash → 用 SCAN 替代
# 如果看到 DEL 大 Key → 用 UNLINK 替代
```

### 2.2 fork 停顿

```bash
INFO stats | grep latest_fork_usec
# latest_fork_usec:150000  → fork 耗时 150ms，严重

# 解决方案：
# 1. 控制单实例内存 ≤ 10GB
# 2. 减少 BGSAVE 频率
# 3. 使用 AOF + 混合持久化（减少全量 RDB）
```

### 2.3 AOF fsync 阻塞

```bash
# 检查 fsync 延迟
redis-cli INFO persistence | grep aof_delayed_fsync
# aof_delayed_fsync:5  → 5 次 fsync 延迟

# 解决方案：
# 1. appendfsync 改为 everysec（不要 always）
# 2. 使用 SSD 替代 HDD
# 3. 开启 no-appendfsync-on-rewrite
```

### 2.4 swap 导致的延迟

```bash
# 检查是否使用了 swap
INFO memory | grep used_memory
# used_memory: 8GB
# used_memory_rss: 12GB  → rss > used 说明有 swap

# 系统层面确认
cat /proc/$(pidof redis-server)/smaps | grep Swap
```

swap 的解决：增加物理内存，或减小 maxmemory。

## 3. 内存异常排查

| 现象 | 可能原因 | 排查方法 |
| :-- | :-- | :-- |
| 内存持续增长 | key 无 TTL 堆积 | `INFO keyspace` 看 key 数量趋势 |
| 碎片率高（>1.5） | 频繁增删 key | `INFO memory` 的 `mem_fragmentation_ratio` |
| 使用了 swap | 内存超物理上限 | `used_memory_rss` > 物理内存 |
| 内存突增 | 大 Key 写入 | `redis-cli --bigkeys` 扫描 |

```bash
# 查看各 DB 的 key 数量
INFO keyspace
# db0:keys=1000000,expires=800000,avg_ttl=300000
# db1:keys=50,expires=0,avg_ttl=0

# 查看内存分布
INFO memory
# used_memory:1073741824
# used_memory_rss:1610612736
# used_memory_peak:2147483648
# mem_fragmentation_ratio:1.50
```

## 4. CPU 飙升排查

| 排查点 | 命令 | 说明 |
| :-- | :-- | :-- |
| 高频命令 | `INFO commandstats` | 找出调用频繁、耗时高的命令 |
| Lua 脚本 | `SLOWLOG` | 脚本执行期间独占 CPU |
| 频繁 BGSAVE | `INFO stats` | fork 与 COW 消耗 CPU |
| 过期键风暴 | `INFO stats` | `expired_keys` 突增 |

```bash
# 实时观察 CPU
top -p $(pidof redis-server)

# Redis 内部 CPU 统计
INFO cpu
# used_cpu_sys:1234.56
# used_cpu_user:5678.90
```

## 5. 连接数异常

| 现象 | 可能原因 | 排查 |
| :-- | :-- | :-- |
| 连接数过高 | 连接池泄漏、短连接 | `CLIENT LIST` 统计 |
| 连接被拒 | 达到 maxclients | `CONFIG GET maxclients` |
| TIME_WAIT 堆积 | 频繁短连接 | `ss -s` 系统层面 |

```bash
# 统计连接来源
CLIENT LIST | awk '{print $2}' | sort | uniq -c | sort -rn

# 查看最大连接数
CONFIG GET maxclients
```

## 6. 集群故障排查

| 现象 | 可能原因 | 排查 |
| :-- | :-- | :-- |
| MOVED 重定向频繁 | 槽分配不均 | `CLUSTER SLOTS` |
| ASK 重定向 | 槽迁移中 | `CLUSTER STATE` |
| 节点下线 | 网络或内存问题 | `CLUSTER NODES` |
| 数据不一致 | 复制延迟 | `INFO replication` |

## 7. 排查方法论

![排查方法论循环](/redis/05-operations-chapter-02-troubleshooting-2.svg)

```txt
观察现象 → 收集指标 → 提出假设 → 验证假设 → 修复 → 监控
```

| 步骤 | 说明 |
| :-- | :-- |
| 观察现象 | 明确是延迟、内存还是 CPU 问题 |
| 收集指标 | 用 INFO、SLOWLOG 收集客观数据 |
| 提出假设 | 基于指标缩小范围（慢命令？fork？swap？） |
| 验证假设 | 用数据证实或推翻，不凭直觉 |
| 修复 | 替换慢命令、调配置、扩内存 |
| 监控 | 修复后持续观察，确认问题消除 |
