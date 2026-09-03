# 学习路径

> Kafka 文档按问题域组织，不按 Kafka 组件组织。本文提供三条阅读路径，按你的角色和需求选择。

## 新手路径：建立心智模型

如果你刚接触 Kafka，按以下顺序阅读，从"是什么"到"为什么这样设计"，逐步建立完整的心智模型。

| 顺序 | 文档 | 读完后你能回答 |
| :-- | :-- | :-- |
| 1 | [Kafka 是什么](./chapter-01-what-is-kafka.md) | Kafka 的本质、架构分层、组件关系 |
| 2 | [分区与 Offset](../_core/chapter-01-partition-and-offset.md) | 消息存在哪、怎么定位、为什么这样分片 |
| 3 | [生产者内部机制](../_core/chapter-02-producer-internals.md) | 消息从发送到落盘经过了哪些步骤 |
| 4 | [消费者组](../_core/chapter-03-consumer-group.md) | 多个消费者怎么协作、Rebalance 是什么 |
| 5 | [副本与 ISR](../_core/chapter-04-replication-and-isr.md) | 数据怎么保证不丢、Leader/Follower 怎么同步 |
| 6 | [ACK 与幂等](../_core/chapter-05-ack-and-idempotence.md) | 生产者怎么确认消息写成功、怎么去重 |

读完这 6 篇，你对 Kafka 的核心机制就有了系统认知。

## 开发者路径：解决实际问题

如果你已经在用 Kafka，遇到了具体问题或想优化生产环境，按问题导向阅读。

### 可靠性：消息不丢、不重、有序

| 文档 | 解决什么问题 |
| :-- | :-- |
| [消息丢失](../reliability/chapter-01-message-loss.md) | 消息在哪个环节丢、怎么防 |
| [消息去重](../reliability/chapter-02-message-dedup.md) | 重复消息怎么来的、怎么消除 |
| [消息顺序](../reliability/chapter-03-message-ordering.md) | 业务需要有序怎么保证、全局有序的代价 |
| [Exactly Once](../reliability/chapter-04-exactly-once.md) | 事务的完整机制、什么场景才需要 |

### 性能：吞吐、延迟、扩展

| 文档 | 解决什么问题 |
| :-- | :-- |
| [为什么 Kafka 这么快](../performance/chapter-01-why-kafka-is-fast.md) | 高吞吐背后的四个机制 |
| [吞吐调优](../performance/chapter-02-throughput-tuning.md) | 生产者/消费者/Broker 三端参数怎么调 |
| [分区数选择](../performance/chapter-03-partition-sizing.md) | 分区设多少合适、过多有什么代价 |
| [压缩权衡](../performance/chapter-04-compression-tradeoff.md) | 压缩算法怎么选、CPU vs 带宽 |

## 运维路径：保障生产稳定

如果你负责 Kafka 集群的运维和故障处理，按以下顺序阅读。

| 顺序 | 文档 | 解决什么问题 |
| :-- | :-- |
| 1 | [监控体系](../operations/monitoring.md) | 该看哪些指标、告警阈值怎么设 |
| 2 | [消费者 Lag 过大](../troubleshooting/chapter-01-consumer-lag.md) | 消费跟不上生产怎么排查 |
| 3 | [ISR 频繁收缩](../troubleshooting/chapter-02-isr-shrink.md) | ISR 为什么抖动、怎么稳定下来 |
| 4 | [高延迟排查](../troubleshooting/chapter-04-high-latency.md) | 端到端延迟高怎么定位 |
| 5 | [磁盘空间不足](../troubleshooting/chapter-05-disk-space.md) | 磁盘满了怎么办、怎么规划容量 |
| 6 | [Broker 故障](../troubleshooting/chapter-06-broker-failure.md) | Broker 起不来、Controller 故障怎么处理 |
| 7 | [集群管理](../operations/cluster-management.md) | 扩缩容、分区重分配、滚动升级 |
| 8 | [多集群](../operations/multi-cluster.md) | MirrorMaker2、容灾、Offset 转换 |

## 按需查阅

| 需求 | 文档 |
| :-- | :-- |
| 消息队列选型对比 | [消息队列选型](./chapter-03-mq-comparison.md) |
| Schema Registry 怎么用 | [Schema 与序列化](../_core/chapter-06-schema-and-serialization.md) |
| 数据保留策略怎么选 | [数据保留](../_core/chapter-07-data-retention.md) |
| Controller 和 KRaft 是什么 | [Controller 与 KRaft](../_core/chapter-08-controller-and-kraft.md) |
| Kafka Streams 入门 | [Streams 基础](../streams/streams-basics.md) |
| Kafka Connect 入门 | [Connect 基础](../connect/connect-basics.md) |
| RecordBatch 字节级细节 | [RecordBatch 格式](../reference/chapter-01-record-batch-format.md) |
| 命令和参数速查 | [命令手册](../reference/commands.md) / [参数手册](../reference/parameters.md) |
