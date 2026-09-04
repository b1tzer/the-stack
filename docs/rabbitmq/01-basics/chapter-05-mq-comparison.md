# 消息队列选型

> 选消息队列不是选「最好的」，而是选「最适合的」。本章聚焦 RabbitMQ 的核心优势与适用场景。完整技术对比见 [Kafka · 消息队列选型](/kafka/01-intro/chapter-03-mq-comparison)。

## RabbitMQ 的核心优势

| 维度 | RabbitMQ 的特点 |
| :-- | :-- |
| 路由能力 | 4 种 Exchange（Direct/Topic/Fanout/Headers），路由规则灵活 |
| 延迟 | 微秒级，比 Kafka 低一个数量级 |
| 协议支持 | AMQP/MQTT/STOMP，IoT 场景天然适配 |
| 死信队列 | 原生支持，无需额外开发 |
| 延迟消息 | 插件原生支持 |
| 运维成本 | 低于 Kafka，轻量级部署 |

## 选 RabbitMQ 的场景

- 复杂路由规则（按 routing key 精确/模糊匹配）
- 消息量中等（万级 QPS 以内）
- 需要微秒级低延迟
- IoT 设备通信（MQTT 协议）
- 企业内部微服务间可靠投递
- 需要死信队列、延迟消息等高级特性

## 不选 RabbitMQ 的场景

| 场景 | 原因 | 推荐 |
| :-- | :-- | :-- |
| 日志收集/大数据流 | 消息堆积后性能下降 | Kafka |
| 百万级 QPS | Erlang 单节点瓶颈 | Kafka / Pulsar |
| 消息回溯 | 不支持按 offset 回溯 | Kafka |
| 流处理 | 无原生流处理引擎 | Kafka Streams / Flink |

## 组合使用

实际项目中经常组合：

```txt
IoT 设备 ──MQTT──▶ RabbitMQ ──AMQP──▶ 业务服务
                                      │
                                      ▼
                              Kafka（日志/事件流）
```

> 不要为了「统一技术栈」强行用一个 MQ 解决所有问题。RabbitMQ 擅长业务消息、灵活路由；Kafka 擅长大数据量、高吞吐。各取所长。
