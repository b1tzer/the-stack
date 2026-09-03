# Stream Queue

> Stream Queue 是 RabbitMQ 3.9+ 引入的新队列类型，借鉴了 Kafka 的设计理念：消息持久化到磁盘，支持回溯消费。

## 1. 为什么引入 Stream Queue

Classic Queue 和 Quorum Queue 的共同问题：**消息被确认后就删除了**。如果消费者想重新消费已经处理过的消息，做不到。

Stream Queue 解决了这个问题：

- 消息持久化到磁盘日志（类似 Kafka 的 Log Segment）
- 消息不因确认而删除，按保留策略自动清理
- 支持多消费者独立回溯消费

## 2. Stream Queue 的存储模型

```txt
┌──────────────────────────────────────────────┐
│              Stream Queue                     │
│                                              │
│  ┌─────────────────────────────────────────┐ │
│  │  Segment 0 (已关闭)                     │ │
│  │  [msg0][msg1][msg2]...[msg999]          │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │  Segment 1 (当前写入)                   │ │
│  │  [msg1000][msg1001]...                  │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  每个 Segment 是一个只追加的日志文件          │
│  消息按 offset 索引，支持任意位置读取         │
└──────────────────────────────────────────────┘
```

## 3. 核心特性

| 特性 | 说明 |
| :-- | :-- |
| 消息保留 | 消息不因确认而删除，按时间/大小保留 |
| 回溯消费 | 消费者可以从任意 offset 开始消费 |
| 多消费者 | 多个消费者独立消费，互不影响 |
| 顺序保证 | 同一个 Stream 内消息严格有序 |
| 高吞吐 | 顺序写磁盘，性能接近 Kafka |
| 不支持死信 | Stream Queue 不支持 DLX |
| 不支持优先级 | 不支持 x-max-priority |

## 4. 声明与使用

```java
// 声明 Stream Queue
Map<String, Object> args = new HashMap<>();
args.put("x-queue-type", "stream");
args.put("x-stream-max-segment-size-bytes", 104857600);  // 每个 Segment 100MB
args.put("x-max-length-bytes", 10737418240);              // 总大小 10GB
args.put("x-stream-max-age", "7 days");                   // 保留7天
channel.queueDeclare("event.stream", true, false, false, args);
```

### 4.1 保留策略

| 参数 | 说明 |
| :-- | :-- |
| x-stream-max-segment-size-bytes | 单个 Segment 大小（默认 100MB） |
| x-max-length-bytes | Stream 总大小 |
| x-stream-max-age | 消息最大保留时间 |

## 5. 消费模式

Stream Queue 的消费方式和普通 Queue 不同：

```java
// 从头开始消费
channel.basicConsume("event.stream", false, new StreamConsumer(channel));

// 从指定 offset 开始消费
Map<String, Object> args = new HashMap<>();
args.put("x-stream-offset", 0);  // 从 offset 0 开始
channel.basicConsume("event.stream", false, args, new StreamConsumer(channel));

// 从指定时间开始消费
args.put("x-stream-offset", "2026-08-31T00:00:00+08:00");
channel.basicConsume("event.stream", false, args, new StreamConsumer(channel));
```

## 6. Stream Queue vs 其他队列

| 维度 | Classic | Quorum | Stream |
| :-- | :-- | :-- | :-- |
| 消息保留 | 确认即删除 | 确认即删除 | 按策略保留 |
| 回溯消费 | ❌ | ❌ | ✅ |
| 高可用 | 镜像（废弃） | Raft | 副本（可选） |
| 吞吐量 | 中 | 中 | 高 |
| 延迟 | 微秒 | 毫秒 | 毫秒 |
| 死信 | ✅ | ✅ | ❌ |
| 优先级 | ✅ | ❌ | ❌ |

## 7. 适用场景

| 场景 | 是否适合 |
| :-- | :-- |
| 事件溯源（Event Sourcing） | ✅ 非常适合 |
| 日志收集 | ✅ 高吞吐 + 保留策略 |
| 消息回溯 | ✅ 原生支持 |
| 业务消息（订单/支付） | ❌ 用 Quorum Queue |
| 延迟消息 | ❌ 不支持 DLX |
| 实时推送 | ⚠️ 可以，但 Classic 更简单 |

## 8. 与 Kafka 的对比

Stream Queue 的设计理念和 Kafka 类似，但有一些关键区别：

| 维度 | Stream Queue | Kafka |
| :-- | :-- | :-- |
| 协议 | AMQP（RabbitMQ 原生） | 自定义协议 |
| 分区 | 单分区（单 Queue） | 多 Partition |
| 消费者组 | 不支持（每个消费者独立） | 支持 |
| 生态 | RabbitMQ 生态 | Kafka Connect/Streams/ksqlDB |
| 运维 | RabbitMQ 统一管理 | 独立集群 |

如果只需要"消息保留 + 回溯消费"，Stream Queue 够用。如果需要"多分区 + 消费者组 + 流处理"，用 Kafka。
