# 阻塞与故障排查

> 线上 Redis 变慢或异常，需要一套系统的方法快速定位根因。本章介绍排查工具与常见故障的定位思路。

## 1. 排查工具

| 工具 | 用途 |
| :-- | :-- |
| `INFO` | 查看服务器状态全貌（stats/memory/clients/commandstats） |
| `SLOWLOG` | 查看慢查询日志 |
| `MONITOR` | 实时观察命令流（有性能开销，慎用） |
| `CLIENT LIST` | 查看客户端连接详情 |
| `redis-cli --latency` | 测试网络延迟 |

```bash
INFO commandstats      # 各命令的调用统计与耗时
INFO memory            # 内存使用、碎片率
CLIENT LIST            # 连接数、每个客户端状态
```

## 2. 延迟突增

延迟突增是最常见的故障，按顺序排查：

![延迟排查顺序](/redis/05-operations-chapter-02-troubleshooting-1.svg)

| 排查点 | 说明 | 判断方法 |
| :-- | :-- | :-- |
| 慢命令 | 慢查询日志有耗时命令 | `SLOWLOG GET` |
| fork 停顿 | BGSAVE/AOF 重写引发 | `INFO stats` 的 `latest_fork_usec` |
| fsync 阻塞 | AOF `always` 刷盘慢 | 磁盘 IO 监控 |
| swap | 内存被换出到磁盘 | `INFO memory` 的 `used_memory_rss` 与 swap |

## 3. 内存异常

| 现象 | 可能原因 | 排查 |
| :-- | :-- | :-- |
| 内存持续增长 | key 无 TTL 堆积 | `INFO keyspace` 看 key 数量 |
| 碎片率高 | 频繁增删 key | `INFO memory` 的 `mem_fragmentation_ratio` |
| 使用了 swap | 内存超物理上限 | `used_memory_rss` > 物理内存 |

```bash
INFO memory
# used_memory            实际使用内存
# used_memory_rss        操作系统分配内存
# mem_fragmentation_ratio 碎片率
```

## 4. CPU 飙升

| 排查点 | 说明 |
| :-- | :-- |
| `INFO commandstats` | 找出调用频繁、耗时高的命令 |
| Lua 长脚本 | 脚本执行期间独占 CPU |
| 频繁 BGSAVE | fork 与 COW 消耗 CPU |
| 过期键过多 | 定期删除扫描消耗 CPU |

## 5. 连接数异常

| 现象 | 可能原因 | 排查 |
| :-- | :-- | :-- |
| 连接数过高 | 连接池泄漏、短连接 | `CLIENT LIST` 统计 |
| 连接被拒 | 达到 maxclients 上限 | `CONFIG GET maxclients` |
| TIME_WAIT 堆积 | 频繁短连接 | 系统层面 `ss -s` |

```bash
CONFIG GET maxclients      # 查看最大连接数
CLIENT LIST | wc -l        # 统计当前连接数
```

## 6. 排查方法论

一套可复用的排查流程：

![排查方法论循环](/redis/05-operations-chapter-02-troubleshooting-2.svg)

要点：

| 步骤 | 说明 |
| :-- | :-- |
| 观察现象 | 明确是延迟、内存还是 CPU 问题 |
| 收集指标 | 用 INFO、SLOWLOG 收集客观数据 |
| 提出假设 | 基于指标缩小范围 |
| 验证假设 | 用数据证实或推翻，不凭直觉 |
