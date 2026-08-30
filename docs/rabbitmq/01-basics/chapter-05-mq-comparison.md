# 消息队列选型

> RabbitMQ、Kafka、RocketMQ、Pulsar 各有擅长的场景。选型不是选"最好"的，而是选"最合适"的。

## 1. 全景对比

| 维度 | RabbitMQ | Kafka | RocketMQ | Pulsar |
| :-- | :-- | :-- | :-- | :-- |
| 协议 | AMQP 0-9-1 | 自定义 | 自定义 | 自定义 |
| 吞吐量 | 万级 QPS | 百万级 QPS | 十万级 QPS | 百万级 QPS |
| 延迟 | 微秒~毫秒 | 毫秒级 | 毫秒级 | 毫秒级 |
| 消息堆积 | 差（性能下降） | 优秀 | 优秀 | 优秀 |
| 消息模型 | Queue + Exchange | Topic + Partition | Topic + Queue | Topic + Subscription |
| 路由能力 | 强（4 种 Exchange） | 弱（分区有序） | 支持 Tag 过滤 | 支持 Tag 过滤 |
| 事务消息 | 支持 | 支持（0.11+） | 支持（半消息） | 支持 |
| 延迟消息 | 插件 | 不原生支持 | 支持 | 支持 |
| 死信队列 | 原生支持 | 不原生支持 | 支持 | 支持 |
| 协议多面手 | AMQP/MQTT/STOMP | 自定义 | 自定义 | AMQP/MQTT |
| 运维复杂度 | 低 | 中 | 中 | 高 |
| 生态成熟度 | 极高 | 极高 | 高 | 中 |

## 2. 场景选型指南

### 2.1 选 RabbitMQ

- 需要复杂路由规则（Topic/Direct/Fanout）
- 消息量中等（万级 QPS 以内）
- 需要可靠投递，消息不能丢
- 团队熟悉 AMQP 协议
- 需要支持多种协议（MQTT/STOMP）
- 企业内部微服务间通信

### 2.2 选 Kafka

- 日志收集、大数据流处理
- 超高吞吐（百万级 QPS）
- 消息可以大量堆积
- 需要消息回溯
- 流处理（Kafka Streams/Flink）

### 2.3 选 RocketMQ

- 电商订单、金融交易
- 需要事务消息（半消息）
- 延迟消息场景
- 团队以 Java 为主
- 阿里生态集成

### 2.4 选 Pulsar

- 多租户场景
- 计算存储分离架构
- 同时需要队列和流语义
- 云原生环境

## 3. 组合使用

实际项目中经常组合使用：

```text
IoT 设备 ──MQTT──▶ RabbitMQ ──AMQP──▶ 业务服务
                                      │
                                      ▼
                              Kafka（日志收集）
                                      │
                                      ▼
                              Flink（流处理）
                                      │
                                      ▼
                              Elasticsearch（搜索）
```
