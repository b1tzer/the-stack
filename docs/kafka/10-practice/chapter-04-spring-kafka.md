# Spring Kafka 集成

> Kafka 原生机制（生产者、消费者、可靠性、AdminClient）在本目录与[核心概念](../01-intro/chapter-02-learning-path.md)中讲解；Spring 侧的集成内容不在本文展开。

监听器（`@KafkaListener`）、事务消息、消费者幂等、并发容器工厂与错误处理、`@EmbeddedKafka` 测试等 Spring 集成知识，已在 Spring 专项的[消息集成 · Kafka 集成](../../spring/07-async-and-messaging/chapter-04-messaging.md#kafka-integration)一章完整讲解。

## 1. 阅读去向

| 需求 | 去哪读 |
| :-- | :-- |
| Kafka 原生生产/消费机制与本地可运行示例 | [第一个 Kafka 应用](./chapter-01-first-app.md) |
| Spring 侧监听器、事务、并发消费 | [消息集成 · Kafka 集成](../../spring/07-async-and-messaging/chapter-04-messaging.md#kafka-integration) |
| 用代码动态管理 Topic、消费组 | [AdminClient：用代码管理 Kafka](./chapter-02-admin-client.md)（含 Spring `KafkaAdmin`） |
| 常见场景与生产上线配置 | [常见场景与上线检查](./chapter-03-common-patterns.md) |
| ACK、幂等、分区、KRaft 等概念 | [核心概念导航](../01-intro/chapter-02-learning-path.md) |
