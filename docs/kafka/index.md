# Kafka 知识库

根据你当前的问题选择入口。Kafka 的定义、架构组件和典型场景由[第一篇“Kafka 是什么”](./01-intro/chapter-01-what-is-kafka.md)说明。

## 从问题进入

| 你现在的问题 | 入口 |
| :-- | :-- |
| 第一次建立 Kafka 心智模型 | [Kafka 是什么](./01-intro/chapter-01-what-is-kafka.md) |
| 第一次跑通生产与消费 | [第一个 Kafka 应用](./10-practice/chapter-01-first-app.md) |
| 需要排查消息丢失、重复或顺序问题 | [消息可靠性](./03-reliability/chapter-01-message-loss.md) |
| 要提高吞吐或调整分区容量 | [吞吐调优](./04-performance/chapter-02-throughput-tuning.md) |
| 消费者持续积压或延迟升高 | [消费积压排查](./05-troubleshooting/chapter-01-consumer-lag.md) |
| 需要建立监控体系 | [监控体系](./06-operations/chapter-01-monitoring.md) |
| 需要管理集群或执行运维操作 | [集群管理](./06-operations/chapter-02-cluster-management.md) |
| 需要配置认证、授权或传输安全 | [安全](./06-operations/chapter-03-security.md) |
| 要做跨集群复制或容灾切换 | [多集群拓扑](./07-multi-cluster/chapter-01-scenarios.md) |
| 需要处理 Kafka 数据流 | [Streams 概览](./08-streams/chapter-01-streams-basics.md) |
| 需要在 Kafka 与外部系统之间同步数据 | [Connect 基础](./09-connect/chapter-01-connect-basics.md) |
| 需要核对配置参数 | [参数速查](./reference/parameters.md) |
| 需要查找 Kafka 运维命令 | [命令速查](./reference/commands.md) |

## 按主题浏览

- **入门与核心**：[入门](./01-intro/chapter-01-what-is-kafka.md)、[分区与 Offset](./02-core/chapter-01-partition-and-offset.md)、[副本与 ISR](./02-core/chapter-04-replication-and-isr.md)。
- **可靠性**：[消息丢失](./03-reliability/chapter-01-message-loss.md)、[重复与幂等](./03-reliability/chapter-02-message-dedup.md)、[Exactly Once](./03-reliability/chapter-04-exactly-once.md)。
- **性能与排查**：[吞吐调优](./04-performance/chapter-02-throughput-tuning.md)、[消费积压](./05-troubleshooting/chapter-01-consumer-lag.md)、[Broker 故障](./05-troubleshooting/chapter-06-broker-failure.md)。
- **运维与容灾**：[监控](./06-operations/chapter-01-monitoring.md)、[集群管理](./06-operations/chapter-02-cluster-management.md)、[安全](./06-operations/chapter-03-security.md)、[MirrorMaker 2](./07-multi-cluster/chapter-02-mirrormaker2.md)。
- **生态**：[Streams 概览](./08-streams/chapter-01-streams-basics.md)、[Connect 基础](./09-connect/chapter-01-connect-basics.md)。
- **实践**：[第一个应用](./10-practice/chapter-01-first-app.md)、[AdminClient](./10-practice/chapter-02-admin-client.md)、[常见模式](./10-practice/chapter-03-common-patterns.md)。
- **参考**：[参数速查](./reference/parameters.md)、[命令速查](./reference/commands.md)。

## 内容边界

Spring 集成放在 [Spring 知识库](../spring/index.md)，RabbitMQ 的路由和队列模型放在 [RabbitMQ 知识库](../rabbitmq/index.md)，业务侧的去重、顺序和事务方案放在[场景实战](../scenarios/index.md)。
