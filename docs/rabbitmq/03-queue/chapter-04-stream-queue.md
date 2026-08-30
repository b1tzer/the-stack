# Stream Queue

> Stream Queue（流队列）是 RabbitMQ 3.9 引入的新型队列，借鉴了 Kafka 的设计理念：消息以追加日志形式存储，支持多消费者独立消费。

## 1. 核心设计

```text
Producer ──追加写入──▶ [消息0][消息1][消息2][消息3]... ──Stream──
                                                          │
                                                    ┌─────┼─────┐
                                                    ▼     ▼     ▼
                                               Consumer Consumer Consumer
                                               offset=0 offset=5 offset=10
```

与传统队列的区别：

| 特性 | Classic/Quorum | Stream |
| :-- | :-- | :-- |
| 消费模式 | 竞争消费（消息被取走） | 独立消费（消息保留） |
| 消息删除 | ACK 后删除 | 按策略保留 |
| 回溯 | 不支持 | 支持按 offset 回溯 |
| 吞吐量 | 万级 | 百万级 |
| 存储 | Erlang 进程 | 追加日志文件 |

## 2. 声明 Stream Queue

```java
Map<String, Object> args = new HashMap<>();
args.put("x-queue-type", "stream");
args.put("x-stream-max-length-bytes", 10_000_000_000L);  // 10GB
args.put("x-stream-max-segment-size-bytes", 100_000_000L); // 100MB
channel.queueDeclare("event.stream", true, false, false, args);
```

## 3. 消费方式

### 3.1 AMQP 1.0

Stream Queue 推荐使用 AMQP 1.0 协议消费：

```java
// 使用 RabbitMQ Stream Java Client
Environment environment = Environment.builder()
    .host("localhost")
    .port(5552)
    .build();

Stream stream = environment.streamBuilder("event.stream").build();
```

### 3.2 RabbitMQ Stream 插件

```bash
rabbitmq-plugins enable rabbitmq_stream
```

Stream 监听端口：5552

## 4. 消息保留策略

| 策略 | 参数 | 说明 |
| :-- | :-- | :-- |
| 时间 | x-stream-max-age | 如 "7d" 保留 7 天 |
| 大小 | x-stream-max-length-bytes | 如 10GB |
| 段大小 | x-stream-max-segment-size-bytes | 每个日志段大小 |

## 5. 适用场景

- 事件溯源（Event Sourcing）
- 消息回溯（需要重新消费历史消息）
- 高吞吐场景（百万级 QPS）
- 多消费者独立消费同一消息流
- 日志收集与分析

## 6. 不适用场景

- 需要严格顺序保证（单分区）
- 需要消息删除确认
- 传统请求-应答模式
- 低延迟场景（微秒级）
