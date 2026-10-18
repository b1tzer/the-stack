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
│              Stream Queue                    │
│                                              │
│  ┌─────────────────────────────────────────┐ │
│  │  Segment 0 (已关闭)                      │ │
│  │  [msg0][msg1][msg2]...[msg999]          │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │  Segment 1 (当前写入)                    │ │
│  │  [msg1000][msg1001]...                  │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  每个 Segment 是一个只追加的日志文件             │
│  消息按 offset 索引，支持任意位置读取            │
└──────────────────────────────────────────────┘
```

## 3. 核心特性

| 特性 | 说明 |
| :-- | :-- |
| 消息保留 | 消息不因确认而删除，按时间/大小保留 |
| 回溯消费 | 消费者可以从任意 offset 开始消费 |
| 多消费者 | 多个消费者独立消费，互不影响 |
| 顺序保证 | Stream 内消息按 offset 严格有序（日志顺序） |
| 高吞吐 | 追加式日志 + 批量处理，利于高吞吐 |
| 不支持死信 | Stream Queue 不支持 DLX |
| 不支持优先级 | 不支持 x-max-priority |

## 4. 声明与使用

```java
// 声明 Stream Queue
Map<String, Object> args = new HashMap<>();
args.put("x-queue-type", "stream");
args.put("x-stream-max-segment-size-bytes", 104857600);   // 每个 Segment 100MB
args.put("x-max-length-bytes", 10737418240L);             // 总大小 10GB
args.put("x-max-age", "7D");                              // 保留 7 天
channel.queueDeclare("event.stream", true, false, false, args);
```

### 4.1 保留策略

| 参数 | 说明 |
| :-- | :-- |
| x-stream-max-segment-size-bytes | 单个 Segment 大小（默认 500,000,000 字节） |
| x-max-length-bytes | Stream 总大小 |
| x-max-age | 消息最大保留时间 |

保留按 Segment 粒度执行，不是逐条删除，实际保留的数据量和时间可能超过设定边界；`x-max-length-bytes` 与 `x-max-age` 可组合使用。

## 5. 消费模式

Stream 消费通过 `x-stream-offset` 指定起始位置，且必须先设置 QoS（`basicQos`），否则会报错。

```java
channel.basicQos(100);  // Stream 消费必须设置 QoS

// 从最早的可用消息开始
Map<String, Object> args = new HashMap<>();
args.put("x-stream-offset", "first");
channel.basicConsume("event.stream", false, args, new StreamConsumer(channel));

// 从指定 offset 开始（数值不存在时会落到日志起点或终点）
args.put("x-stream-offset", 1000);
channel.basicConsume("event.stream", false, args, new StreamConsumer(channel));

// 从指定时间开始（Java 客户端用 Date 表示时间戳，基于消息到达时间）
args.put("x-stream-offset", new Date(1788134400000L));  // 2026-08-31 00:00:00 UTC
channel.basicConsume("event.stream", false, args, new StreamConsumer(channel));

// 或使用相对时间间隔（与 x-max-age 相同的单位格式）
args.put("x-stream-offset", "1h");
channel.basicConsume("event.stream", false, args, new StreamConsumer(channel));
```

`x-stream-offset` 可选值：`first`（最早可用消息）、`last`（最后写入的 chunk）、`next`（默认，仅消费新消息）、数值 offset、时间戳或相对时间间隔（如 `1h`）。

### 5.1 ACK 与消费进度

Stream 的 `basicAck` 不会删除消息，它只是消费确认，用于推进该消费者的投递。但 ACK 不等于持久化消费位置：AMQP 0-9-1 接口不提供 Broker 端的 offset tracking，应用重启后想从上次位置继续，需要自己持久化 offset 并据此重新指定 `x-stream-offset`；原生 Stream 协议客户端支持服务端 offset tracking，进度由 Broker 保存。

## 6. Stream Queue vs 其他队列

| 维度 | Classic | Quorum | Stream |
| :-- | :-- | :-- | :-- |
| 消息保留 | 确认即删除 | 确认即删除 | 按策略保留 |
| 回溯消费 | ❌ | ❌ | ✅ |
| 高可用 | 镜像（废弃） | Raft | Raft 复制 |
| 吞吐量 | 中 | 中 | 高（实际需基准测试） |
| 死信 | ✅ | ✅ | ❌ |
| 优先级 | ✅ | ❌ | ❌ |

## 7. 适用场景

| 场景 | 是否适合 |
| :-- | :-- |
| 事件溯源（Event Sourcing） | ✅ 非常适合 |
| 日志收集 | ✅ 高吞吐 + 保留策略 |
| 消息回溯 | ✅ 原生支持 |
| 业务消息（订单/支付） | ⚠️ 需消费确认与重投递语义时用 Quorum |
| 延迟消息 | ❌ 不支持 DLX |
| 实时推送 | ⚠️ 可以，但 Classic 更简单 |

## 8. 与 Kafka 的对比

Stream Queue 的设计理念和 Kafka 类似，但有一些关键区别：

| 维度 | Stream Queue | Kafka |
| :-- | :-- | :-- |
| 协议 | AMQP（RabbitMQ 原生） | 自定义协议 |
| 分区 | 单 Stream（Super Stream 支持分区） | 多 Partition |
| 消费者组 | AMQP 0-9-1 接口不支持；原生协议支持 | 支持 |
| 生态 | RabbitMQ 生态 | Kafka Connect/Streams/ksqlDB |
| 运维 | RabbitMQ 统一管理 | 独立集群 |

如果只需要"消息保留 + 回溯消费"，Stream Queue 够用。如果需要 Kafka 式的流处理生态（Connect/Streams/ksqlDB），再上 Kafka。
