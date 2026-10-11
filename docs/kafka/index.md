# Kafka 知识库

本页负责选择入口。Kafka 的定义、架构组件和典型场景由[第一篇“Kafka 是什么”](./01-intro/chapter-01-what-is-kafka.md)说明。

## 从问题进入

| 你现在的问题 | 入口 |
| :-- | :-- |
| 第一次建立 Kafka 心智模型 | [Kafka 是什么](./01-intro/chapter-01-what-is-kafka.md) |
| 需要保证消息不丢、不重、有序 | [消息可靠性](./03-reliability/chapter-01-message-loss.md) |
| 要提高吞吐或调整分区容量 | [吞吐调优](./04-performance/chapter-02-throughput-tuning.md) |
| 消费者持续积压或延迟升高 | [消费积压排查](./05-troubleshooting/chapter-01-consumer-lag.md) |
| 需要核对参数或命令 | [参数速查](./reference/parameters.md) |

## 按目录浏览

- **入门与核心**：[入门](./01-intro/chapter-01-what-is-kafka.md)、[分区与 Offset](./02-core/chapter-01-partition-and-offset.md)、[副本与 ISR](./02-core/chapter-04-replication-and-isr.md)。
- **可靠性**：[消息丢失](./03-reliability/chapter-01-message-loss.md)、[重复与幂等](./03-reliability/chapter-02-message-dedup.md)、[Exactly Once](./03-reliability/chapter-04-exactly-once.md)。
- **性能与排查**：[吞吐调优](./04-performance/chapter-02-throughput-tuning.md)、[消费积压](./05-troubleshooting/chapter-01-consumer-lag.md)、[Broker 故障](./05-troubleshooting/chapter-06-broker-failure.md)。
- **参考**：[参数速查](./reference/parameters.md)、[命令速查](./reference/commands.md)。

## 内容边界

Spring 集成放在 [Spring 知识库](../spring/index.md)，RabbitMQ 的路由和队列模型放在 [RabbitMQ 知识库](../rabbitmq/index.md)，业务侧的去重、顺序和事务方案放在[场景实战](../scenarios/index.md)。
