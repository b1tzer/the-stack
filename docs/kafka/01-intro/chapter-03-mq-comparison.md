# 消息队列选型

> 选消息队列不是选「最好的」，而是选「最适合的」。本章从技术维度和业务维度对比主流消息队列，给出选型决策树。

## 1. 主流消息队列

| 特性 | Kafka | RabbitMQ | RocketMQ | Pulsar |
| :-- | :-- | :-- | :-- | :-- |
| 开发语言 | Java/Scala | Erlang | Java | Java |
| 吞吐量 | 百万级 | 万级 | 十万级 | 百万级 |
| 延迟 | 毫秒 | 微秒 | 毫秒 | 毫秒 |
| 消息模型 | 发布订阅 | 队列/发布订阅 | 队列/发布订阅 | 发布订阅 |
| 消息回溯 | ✅ | ❌ | ✅ | ✅ |
| 事务消息 | ✅ | ❌ | ✅ | ✅ |
| 流处理 | ✅ Streams | ❌ | ❌ | ✅ |
| 社区活跃 | 极高 | 高 | 高 | 高 |

> 吞吐量与延迟是量级经验参考，不是产品的固有能力，实际数值取决于消息大小、持久化、副本因子、确认策略和硬件。延迟测量口径（Broker 到消费者还是端到端）不同，结果差异很大。「事务消息」指生产者事务或事务消息机制，RabbitMQ 提供的是 AMQP 事务（txSelect/txCommit），语义不同且性能开销大，此处标 ❌ 只针对「事务消息」这一列，不代表 RabbitMQ 完全没有事务能力。「消息回溯」指 Kafka 任意 offset 重放能力，RabbitMQ 经典与仲裁队列不支持任意回放，RabbitMQ Streams 支持重复读取，属特殊队列类型。

## 2. 核心差异分析

### 2.1 吞吐量差异的根因

| 因素 | Kafka | RabbitMQ |
| :-- | :-- | :-- |
| 存储方式 | 分区追加日志，顺序写入 | 按队列类型区分，经典队列基于索引持久化，仲裁队列基于 Raft 日志 |
| 零拷贝 | 消费路径 sendfile() 跳过用户态拷贝 | 消息经交换机路由和队列进程，需多次内存拷贝 |
| 批量发送 | 生产者 batch 加消费者 Fetch 批量拉取 | 支持消费者 prefetch 和批量确认，投递粒度更细 |
| 消息堆积 | 顺序读磁盘，堆积不显著影响吞吐 | 堆积增加磁盘和内存压力，长队列需关注 |

Kafka 高吞吐的完整机制见 [为什么 Kafka 这么快](../04-performance/chapter-01-why-kafka-is-fast.md)。

### 2.2 消费模型差异

```txt
Kafka（Pull）：
  Consumer → Broker：给我 Partition 0 从 offset 100 开始的消息
  消费者控制速率，不会因推送风暴而不可用

RabbitMQ（Push）：
  Broker → Consumer：这是新消息，你处理吧
  Broker 推送速率可能超过消费者处理能力
```

Pull 模型的优势：消费者控制消费速率、支持批量拉取、消费者宕机不影响 Broker。

Push 模型的优势：实时性更好（消息到达即推送）、消费者实现更简单。

### 2.3 消息可靠性

| 维度 | Kafka | RabbitMQ | RocketMQ |
| :-- | :-- | :-- | :-- |
| 消息持久化 | 磁盘（可配置保留时间） | 磁盘（消息与队列可持久化） | 磁盘 |
| 副本机制 | ISR，可配置副本因子 | 经典队列（镜像功能 4.0 已移除，仲裁队列为可选替代） | 同步双写 |
| 事务 | 0.11+ 生产者事务 | AMQP 事务（非事务消息语义） | 事务消息（半消息） |
| 消息丢失窗口 | acks=all 且 min.insync.replicas 满足时最小 | 消费者确认前消息可重新入队，非直接丢失 | 同步刷盘加同步复制时最小 |

可靠性保障要分生产端、Broker 端、消费端三个阶段看，任何单一配置都不能保证端到端不丢消息：

- 生产端：Kafka 靠 `acks=all` 与 `min.insync.replicas` 确认副本写入；RabbitMQ 靠发布确认（publisher confirm）。
- Broker 端：Kafka 靠副本与 ISR；RabbitMQ 靠队列持久化与副本（仲裁队列）。
- 消费端：Kafka 靠手动提交 Offset；RabbitMQ 靠消费者 ACK。

RabbitMQ 的「消费者确认前可能丢」说法不准确：消费者在 ACK 前异常断开，未确认消息会重新入队等待再次投递，除非消息被 reject 且未设置 requeue 才被丢弃。Kafka 的 `acks=all` 只等待当前 ISR 中的副本确认，还需配合 `min.insync.replicas` 并禁用非干净 Leader 选举才能最大程度避免丢失，消费端 Offset 提交属于另一阶段的保障。

更完整的可靠性分析见 [消息丢失](../03-reliability/chapter-01-message-loss.md) 与 [副本与 ISR](../02-core/chapter-04-replication-and-isr.md)；RabbitMQ 的副本与高可用见 [仲裁队列](../../rabbitmq/03-queue/chapter-03-quorum-queue.md)。

## 3. 选型决策树

```txt
需要消息队列
  │
  ├─ 高吞吐（量级参考 >10万/s）+ 大数据生态 → Kafka
  │
  ├─ 业务消息 + 复杂路由 + 低延迟 → RabbitMQ
  │
  ├─ 金融级事务 + 延迟消息 → RocketMQ
  │
  └─ 多租户 + 存储分离 → Pulsar
```

阈值只是初筛参考，不是排除某种产品的充分条件。最终选型还要结合消息保留、路由复杂度、消费模型、延迟目标、故障语义和运维成本综合判断。

## 4. 场景选型

| 场景 | 推荐 | 理由 |
| :-- | :-- | :-- |
| 日志收集 | Kafka | 高吞吐、消息回溯、ELK 生态 |
| 事件驱动 | Kafka | 高吞吐、持久化、消费者组 |
| 数据管道（CDC） | Kafka | Kafka Connect、Debezium 生态 |
| 流式处理 | Kafka | Kafka Streams / Flink 集成 |
| 业务消息（订单/支付） | RabbitMQ 或 RocketMQ | 低延迟、复杂路由、事务支持 |
| 即时通讯 | RabbitMQ | 低延迟、灵活路由 |
| 金融交易 | RocketMQ | 事务消息、定时消息、高可靠 |

## 5. 何时不选 Kafka

| 场景 | 原因 | 替代方案 |
| :-- | :-- | :-- |
| 消息量 < 1万/s | Kafka 运维成本高，杀鸡用牛刀 | RabbitMQ |
| 延迟要求 < 1ms | Kafka 毫秒级，RabbitMQ 延迟通常更低（量级参考） | RabbitMQ |
| 复杂路由规则 | Kafka 路由模型简单，Topic 加分区键分配 | RabbitMQ（Exchange/Binding） |
| 小团队无 Java 技术栈 | Kafka 运维需要 JVM 经验 | RabbitMQ 或云服务 |

> 表中阈值（< 1万/s、< 1ms）同为经验参考，需结合具体工作负载判断。低吞吐但要求复杂路由的业务更适合 RabbitMQ，吞吐不高但需要长期保留和重复读取的事件流仍可能适合 Kafka。RabbitMQ 的复杂路由能力见 [Exchange 基础](../../rabbitmq/02-exchange/chapter-01-exchange-basics.md)。

## 6. 混合使用

大型系统中可以同时使用多种消息队列：

```txt
业务消息（订单/支付）→ RabbitMQ（低延迟、复杂路由）
日志/事件           → Kafka（高吞吐、持久化）
数据管道            → Kafka Connect（CDC 生态）
```

> 不要为了「统一技术栈」而强行用一个消息队列解决所有问题。Kafka 擅长大数据量、高吞吐；RabbitMQ 擅长业务消息、灵活路由。各取所长。
