# 消息队列选型

## 1. 主流消息队列

| 特性 | Kafka | RabbitMQ | RocketMQ | Pulsar |
|------|-------|----------|----------|--------|
| 开发语言 | Java/Scala | Erlang | Java | Java |
| 吞吐量 | 百万级 | 万级 | 十万级 | 百万级 |
| 延迟 | 毫秒 | 微秒 | 毫秒 | 毫秒 |
| 消息模型 | 发布订阅 | 队列/发布订阅 | 队列/发布订阅 | 发布订阅 |
| 消息回溯 | ✅ | ❌ | ✅ | ✅ |
| 事务消息 | ✅ | ❌ | ✅ | ✅ |
| 流处理 | ✅ | ❌ | ❌ | ✅ |
| 社区活跃 | 极高 | 高 | 高 | 高 |

## 2. 选型建议

| 场景 | 推荐 |
|------|------|
| 日志/大数据/事件驱动 | Kafka |
| 业务消息/复杂路由 | RabbitMQ |
| 电商/金融/事务消息 | RocketMQ |
| 多租户/统一消息 | Pulsar |

## 3. Kafka 优势

- 极高吞吐量
- 消息持久化，可回溯
- 生态完善（Streams/Connect/ksqlDB）
- 社区活跃，文档丰富

## 4. 各消息队列深度对比

### 4.1 Kafka vs RabbitMQ

- **协议**：Kafka 使用自定义二进制协议，RabbitMQ 使用 AMQP 协议。
- **消费模型**：Kafka 使用 Pull 模型（消费者主动拉取），RabbitMQ 使用 Push 模型（Broker 推送）。Pull 模型让消费者可以控制消费速率。
- **消息堆积**：Kafka 消息存储在磁盘，堆积几乎不影响性能；RabbitMQ 消息堆积会导致性能下降。
- **适用场景**：Kafka 适合大数据量、高吞吐场景；RabbitMQ 适合需要复杂路由、低延迟的业务消息。

### 4.2 Kafka vs RocketMQ

- **事务消息**：两者都支持，但 RocketMQ 的事务消息模型更成熟（半消息机制）。
- **延迟消息**：RocketMQ 原生支持延迟消息等级，Kafka 需要通过时间轮或外部方案实现。
- **消息回溯**：两者都支持按时间回溯消费。

### 4.3 Kafka vs Pulsar

- **存储架构**：Pulsar 采用计算存储分离（BookKeeper），Kafka 采用计算存储一体。
- **多租户**：Pulsar 原生支持多租户，Kafka 需要通过 ACL 实现隔离。
- **Topic 数量**：Pulsar 支持百万级 Topic，Kafka 在 Topic 数量过多时性能下降明显。

## 5. 选型决策树

```
需要消息队列
    │
    ├── 高吞吐 + 大数据生态 → Kafka
    │
    ├── 业务消息 + 复杂路由 → RabbitMQ
    │
    ├── 金融级事务 + 低延迟 → RocketMQ
    │
    └── 多租户 + 存储分离 → Pulsar
```

## 6. 何时不选 Kafka

- 消息量小（<1万条/秒），RabbitMQ 更轻量。
- 需要严格的延迟保证（<1ms），RabbitMQ 表现更好。
- 需要复杂的路由规则（Topic/Headers 交换），RabbitMQ 更灵活。
- 团队没有 Java/Scala 技术栈，运维成本可能较高。

## 7. 最佳实践

1. **不要盲目追求 Kafka**：如果消息量不大，RabbitMQ 可能是更好的选择，运维更简单。
2. **评估运维能力**：Kafka 集群运维需要较多经验，小团队可以考虑 Confluent Cloud 等托管服务。
3. **混合使用**：大型系统中可以同时使用多种消息队列，Kafka 用于日志和数据管道，RabbitMQ 用于业务消息。
