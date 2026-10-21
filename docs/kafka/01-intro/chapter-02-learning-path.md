# 学习路径

> Kafka 文档按问题域组织，不按 Kafka 组件组织。本文提供三条阅读路径（新手、开发者、运维），动手实践与专项参考列在后面。

## 新手路径：建立心智模型

如果你刚接触 Kafka，按以下顺序阅读，从"是什么"到"为什么这样设计"，逐步建立核心机制的心智模型。

| 顺序 | 文档 | 读完后你能回答 |
| :-- | :-- | :-- |
| 1 | [Kafka 是什么](./chapter-01-what-is-kafka.md) | Kafka 的本质、架构分层、组件关系 |
| 2 | [分区与 Offset](../02-core/chapter-01-partition-and-offset.md) | 消息存在哪、怎么定位、为什么这样分片 |
| 3 | [生产者内部机制](../02-core/chapter-02-producer-internals.md) | 消息从发送到落盘经过了哪些步骤 |
| 4 | [消费者组](../02-core/chapter-03-consumer-group.md) | 多个消费者怎么协作、Rebalance 是什么 |
| 5 | [副本与 ISR](../02-core/chapter-04-replication-and-isr.md) | 副本如何同步、ISR 如何影响写入可靠性，以及哪些故障可能导致数据丢失 |
| 6 | [ACK 与幂等](../02-core/chapter-05-ack-and-idempotence.md) | 生产者如何确认写入结果、幂等生产者如何处理重试导致的重复写入 |

读完这 6 篇，你应该能解释消息如何存储、生产者如何发送、消费者如何协作，以及副本和幂等机制分别解决什么问题。想动手跑起来，接[第一个 Kafka 应用](../10-practice/chapter-01-first-app.md)。

## 开发者路径：解决实际问题

如果你已经在用 Kafka，遇到了具体问题或想优化生产环境，按问题导向阅读。

### 可靠性：消息不丢、不重、有序

| 文档 | 解决什么问题 |
| :-- | :-- |
| [消息丢失](../03-reliability/chapter-01-message-loss.md) | 消息在哪个环节丢、怎么防 |
| [消息去重](../03-reliability/chapter-02-message-dedup.md) | 重复消息怎么来的、怎么去重 |
| [消息顺序](../03-reliability/chapter-03-message-ordering.md) | 业务需要有序怎么保证、全局有序的代价 |
| [Exactly Once](../03-reliability/chapter-04-exactly-once.md) | 事务的完整机制、什么场景才需要 |

### 性能：吞吐、延迟、扩展

| 文档 | 解决什么问题 |
| :-- | :-- |
| [为什么 Kafka 这么快](../04-performance/chapter-01-why-kafka-is-fast.md) | 高吞吐背后的四个机制 |
| [吞吐调优](../04-performance/chapter-02-throughput-tuning.md) | 生产者/消费者/Broker 三端参数怎么调 |
| [分区数选择](../04-performance/chapter-03-partition-sizing.md) | 分区设多少合适、过多有什么代价 |
| [压缩权衡](../04-performance/chapter-04-compression-tradeoff.md) | 压缩算法怎么选、CPU vs 带宽 |

## 运维路径：保障生产稳定

如果你负责 Kafka 集群的运维和故障处理，按以下顺序阅读。先了解监控指标，再学习故障排查，最后进入集群管理与容灾。

| 顺序 | 文档 | 解决什么问题 |
| :-- | :-- | :-- |
| 1 | [监控体系](../06-operations/chapter-01-monitoring.md) | 核心指标是什么、怎么接到 Prometheus/Grafana |
| 2 | [消费者 Lag 过大](../05-troubleshooting/chapter-01-consumer-lag.md) | 消费跟不上生产怎么排查 |
| 3 | [ISR 频繁收缩](../05-troubleshooting/chapter-02-isr-shrink.md) | ISR 为什么抖动、怎么稳定下来 |
| 4 | [高延迟排查](../05-troubleshooting/chapter-04-high-latency.md) | 端到端延迟高怎么定位 |
| 5 | [磁盘空间不足](../05-troubleshooting/chapter-05-disk-space.md) | 磁盘满了怎么办、怎么规划容量 |
| 6 | [Broker 故障](../05-troubleshooting/chapter-06-broker-failure.md) | Broker 起不来、Controller 故障怎么处理 |
| 7 | [集群管理](../06-operations/chapter-02-cluster-management.md) | 扩缩容、分区重分配、配置修改 |
| 8 | [安全配置](../06-operations/chapter-03-security.md) | SASL/SSL/ACL 怎么上生产 |
| 9 | [多集群拓扑](../07-multi-cluster/chapter-01-scenarios.md) | 什么时候需要跨集群复制、如何选择集群拓扑 |

## 动手与生态

按需进入，不作为主路径的必读项。

| 需求 | 文档 |
| :-- | :-- |
| 第一次跑通生产与消费 | [第一个 Kafka 应用](../10-practice/chapter-01-first-app.md) |
| 用代码管理集群 | [AdminClient](../10-practice/chapter-02-admin-client.md) |
| 日志收集、事件驱动等落地形态 | [常见模式](../10-practice/chapter-03-common-patterns.md) |
| Spring 侧集成 | [Spring Kafka 入口](../10-practice/chapter-04-spring-kafka.md) |
| 用 Kafka 做流处理 | [Streams 概览](../08-streams/chapter-01-streams-basics.md) |
| 与外部系统对接（CDC、入库） | [Connect 基础](../09-connect/chapter-01-connect-basics.md) |
| 跨集群复制与容灾切换 | [MirrorMaker 2](../07-multi-cluster/chapter-02-mirrormaker2.md) |

## 按需查阅

| 需求 | 文档 |
| :-- | :-- |
| 消息队列选型对比 | [消息队列选型](./chapter-03-mq-comparison.md) |
| Schema Registry 怎么用 | [Schema 与序列化](../02-core/chapter-06-schema-and-serialization.md) |
| 数据保留策略怎么选 | [数据保留](../02-core/chapter-07-data-retention.md) |
| Controller 和 KRaft 是什么 | [Controller 与 KRaft](../02-core/chapter-08-controller-and-kraft.md) |
| RecordBatch 字节级细节 | [RecordBatch 格式](../reference/chapter-01-record-batch-format.md) |
| 命令和参数速查 | [命令手册](../reference/commands.md) / [参数手册](../reference/parameters.md) |
