# Kafka 概览

## 1. 什么是 Kafka

Apache Kafka 是分布式流处理平台，由 LinkedIn 开发，2011 年开源。

## 2. 核心能力

| 能力 | 说明 |
|------|------|
| 消息队列 | 发布/订阅模式，解耦生产者和消费者 |
| 流处理 | 实时处理数据流 |
| 数据管道 | 连接不同系统，ETL |

## 3. 与 RabbitMQ/RocketMQ 对比

| 特性 | Kafka | RabbitMQ | RocketMQ |
|------|-------|----------|----------|
| 吞吐量 | 极高（百万级） | 中等 | 高 |
| 延迟 | 毫秒级 | 微秒级 | 毫秒级 |
| 消息模型 | 发布/订阅 | 队列/发布订阅 | 队列/发布订阅 |
| 消息回溯 | ✅ | ❌ | ✅ |
| 流处理 | ✅ Streams | ❌ | ❌ |
| 适用场景 | 日志/大数据/事件驱动 | 业务消息 | 电商/金融 |

## 4. 使用场景

- 日志收集（ELK）
- 事件驱动架构
- 数据管道（CDC）
- 流式处理（Flink/Spark）
- 指标监控

## 5. Kafka 的设计哲学

Kafka 的核心设计理念是**将持久化、高吞吐和分布式统一起来**。传统消息队列通常在可靠性和性能之间做取舍，而 Kafka 通过以下设计实现了两者兼顾：

- **追加写入（Append-Only）**：消息只能追加到日志末尾，不允许修改或删除（除保留策略外），这让磁盘顺序写入的性能接近内存随机写入。
- **分区并行**：每个 Topic 被分成多个 Partition，分布在不同 Broker 上，实现水平扩展。分区数决定了消费者的最大并行度。
- **消费组隔离**：不同消费组独立消费同一 Topic，互不影响，天然支持发布/订阅模式。
- **存储与计算分离**：Kafka 只负责存储消息，不关心消费者如何处理，消费者可以随时回溯消费。

## 6. Kafka 的版本演进

| 版本 | 里程碑 |
|------|--------|
| 0.8 | 引入副本机制 |
| 0.10 | 引入 Kafka Streams |
| 0.11 | 引入事务和 Exactly Once 语义 |
| 2.0 | 引入 AdminClient API |
| 2.8 | 引入 KRaft（早期预览） |
| 3.3 | KRaft 生产就绪 |
| 3.7 | ZooKeeper 模式正式弃用通知 |
| 4.0 | 默认 KRaft，移除 ZooKeeper |

## 7. 快速体验

```bash
# 启动 Kafka（KRaft 模式）
kafka-storage.sh random-uuid
kafka-storage.sh format -t $(kafka-storage.sh random-uuid) -c config/kraft/server.properties
kafka-server-start.sh config/kraft/server.properties

# 创建 Topic
kafka-topics.sh --create --topic test --partitions 3 --replication-factor 1 --bootstrap-server localhost:9092

# 生产消息
kafka-console-producer.sh --topic test --bootstrap-server localhost:9092

# 消费消息
kafka-console-consumer.sh --topic test --from-beginning --bootstrap-server localhost:9092
```

## 8. 最佳实践

1. **生产环境至少 3 个 Broker**：保证高可用，支持副本因子为 3。
2. **合理规划分区数**：分区数 = 期望的消费者并发数，分区一旦创建只能增加不能减少。
3. **使用 KRaft 模式**：新项目直接使用 KRaft，避免 ZooKeeper 的运维复杂度。
4. **监控消费者 Lag**：这是衡量系统健康度的关键指标。
