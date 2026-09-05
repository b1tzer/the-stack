# Kafka 参数速查

> 本表列出常用参数的官方默认值与生产选取建议。所有默认值来自 [Kafka 官方配置文档](https://kafka.apache.org/documentation/#configuration)，版本相关的差异会在备注中说明。推荐值只写有明确理由的取值，不写「随手拍」的区间。

## 1. Broker 配置

| 参数 | 官方默认 | 生产建议 | 说明与版本 |
| :-- | :-- | :-- | :-- |
| `broker.id` | `-1`（自动） | 显式设置为唯一整数 | 自动生成从 `reserved.broker.max.id + 1` 起分配 |
| `num.partitions` | `1` | 按吞吐容量规划 | 自动创建 Topic 时的分区数；生产 Topic 建议显式指定 `--partitions` |
| `default.replication.factor` | `1` | `3` | 自动创建 Topic 的副本因子；生产必须提升 |
| `min.insync.replicas` | `1` | `2` | 仅当 `acks=all` 时生效；与 RF=3 搭配 |
| `unclean.leader.election.enable` | `false`（0.11+） | 保持 `false` | 允许 = 换取可用性、丢数据 |
| `auto.leader.rebalance.enable` | `true` | `true` | 自动把 Leader 迁回 preferred replica |
| `log.retention.hours` | `168`（7 天） | 按业务保留窗口调整 | 也可用 `log.retention.ms` / `log.retention.bytes` |
| `log.retention.bytes` | `-1`（不限制） | 与磁盘容量匹配 | 按分区计算 |
| `log.segment.bytes` | `1073741824`（1 GiB） | 默认足够 | 段过小 → 段文件过多；过大 → 清理粒度粗 |
| `log.index.interval.bytes` | `4096` | 默认 | 稀疏索引密度，详见 [日志分段与索引](./chapter-02-log-segment.md) |
| `message.max.bytes` | `1048588`（≈ 1 MiB） | 显式设置，且与生产者 `max.request.size`、消费者 `fetch.max.bytes` 一致 | 三处不匹配会导致上游能发、下游拿不到 |
| `replica.lag.time.max.ms` | `30000`（2.5+）／`10000`（2.4 及以前，[KIP-537](https://cwiki.apache.org/confluence/display/KAFKA/KIP-537)） | 保持默认 | 调小易触发 spurious ISR 收缩 |
| `num.replica.fetchers` | `1` | `2`–`4`（磁盘/网卡富余时） | 提升 Follower 并行度 |

## 2. Producer 配置

| 参数 | 官方默认 | 生产建议 | 说明与版本 |
| :-- | :-- | :-- | :-- |
| `acks` | `all`（3.0+，[KIP-679](https://cwiki.apache.org/confluence/display/KAFKA/KIP-679)）／`1`（3.0 前） | `all` | 与 `min.insync.replicas` 配合才有意义 |
| `enable.idempotence` | `true`（3.0+，[KIP-679](https://cwiki.apache.org/confluence/display/KAFKA/KIP-679)）／`false`（3.0 前） | `true` | 开启会强制 `acks=all`、`retries=MAX_VALUE`、`max.in.flight ≤ 5` |
| `retries` | `Integer.MAX_VALUE`（幂等开启时强制） | 保持默认 | 启用幂等后 Kafka 自动设为 MAX_VALUE；关闭幂等时也应保持较大值靠 `delivery.timeout.ms` 兜底 |
| `delivery.timeout.ms` | `120000`（2 min） | 与业务超时对齐 | 覆盖 `linger.ms + request.timeout.ms + retry` 总时长 |
| `max.in.flight.requests.per.connection` | `5` | 幂等模式下 `≤ 5` | 关闭幂等时 `>1` 有乱序风险 |
| `batch.size` | `16384`（16 KiB） | `32768`–`131072` | 提高批量效率；配合 `linger.ms` |
| `linger.ms` | `0` | `5`–`20` | 允许攒批的等待时长 |
| `buffer.memory` | `33554432`（32 MiB） | 视吞吐上调 | 缓冲不足时 send 会阻塞或抛异常 |
| `compression.type` | `none` | `lz4` 或 `zstd` | 生产者压缩，broker 存原样透传 |

## 3. Consumer 配置

| 参数 | 官方默认 | 生产建议 | 说明与版本 |
| :-- | :-- | :-- | :-- |
| `group.id` | 无 | 必填 | 唯一标识消费者组 |
| `auto.offset.reset` | `latest` | 视业务选 `earliest` 或 `latest` | 无 committed offset 时的行为 |
| `enable.auto.commit` | `true` | `false`（业务处理完再手动提交） | 详见 [Offset 管理](../02-core/chapter-03-consumer-group.md) |
| `max.poll.records` | `500` | 保持默认；处理耗时长时下调 | 与 `max.poll.interval.ms` 联动 |
| `max.poll.interval.ms` | `300000`（5 min） | > 最坏批处理时长 | 超过则被踢出组触发 rebalance |
| `session.timeout.ms` | `45000`（3.0+，[KIP-735](https://cwiki.apache.org/confluence/display/KAFKA/KIP-735)）／`10000`（3.0 前） | 保持默认 | 太小则 GC 抖动就触发 rebalance |
| `heartbeat.interval.ms` | `3000` | `session.timeout.ms / 3` | 心跳线程独立于 poll |
| `fetch.min.bytes` | `1` | 高吞吐时可上调 | broker 攒够字节再返回 |
| `fetch.max.wait.ms` | `500` | 默认 | 与 `fetch.min.bytes` 配合 |
| `isolation.level` | `read_uncommitted` | 事务场景 `read_committed` | 详见 [Exactly Once 语义](../03-reliability/chapter-04-exactly-once.md) |

## 4. JVM 与 OS

Kafka Broker 的堆调优核心是**留足内存给 Page Cache**，详细推理见 [Page Cache 与零拷贝](../04-performance/chapter-01-why-kafka-is-fast.md) §4。

```bash
# Broker JVM（32 GiB 物理内存示例）
export KAFKA_HEAP_OPTS="-Xms6g -Xmx6g"
export KAFKA_JVM_PERFORMANCE_OPTS="-XX:+UseG1GC -XX:MaxGCPauseMillis=20 \
  -XX:InitiatingHeapOccupancyPercent=35"

# OS 层
# /etc/sysctl.d/99-kafka.conf
vm.swappiness=1                 # 尽量避免 Page Cache 被换出
vm.max_map_count=1000000        # 分区规模大时必须调高（默认 65530 会被打穿）
# ulimit
* soft nofile 100000
* hard nofile 100000
```

> Xmx 与 Xms 相等避免堆动态扩缩；32 GiB 物理内存里堆保持 6 GiB 左右，剩余全部让 OS 用作 Page Cache。这套推荐来自 [Kafka 官方 §Hardware and OS](https://kafka.apache.org/documentation/#hardware) 与 [Kafka 官方 §Performance](https://kafka.apache.org/documentation/#maximizingefficiency)。
