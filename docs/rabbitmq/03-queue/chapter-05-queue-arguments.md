# 队列参数

> Queue 的扩展参数（x-arguments）决定了队列的行为特性。这些参数在声明时设置，创建后不能修改。

## 1. 参数总览

| 参数 | 类型 | Classic | Quorum | Stream | 说明 |
|------|------|---------|--------|--------|------|
| x-queue-type | string | ✅ | ✅ | ✅ | 队列类型 |
| x-max-length | int | ✅ | ✅ | ❌ | 最大消息数 |
| x-max-length-bytes | int | ✅ | ✅ | ✅ | 最大字节数 |
| x-overflow | string | ✅ | ✅ | ❌ | 超限行为 |
| x-message-ttl | int | ✅ | ✅ | ❌ | 消息 TTL（ms） |
| x-expires | int | ✅ | ✅ | ❌ | Queue 空闲超时（ms） |
| x-max-priority | int | ✅ | ❌ | ❌ | 最大优先级 |
| x-dead-letter-exchange | string | ✅ | ✅ | ❌ | 死信 Exchange |
| x-dead-letter-routing-key | string | ✅ | ✅ | ❌ | 死信 routing key |
| x-delivery-limit | int | ❌ | ✅ | ❌ | 最大投递次数 |
| x-quorum-initial-group-size | int | ❌ | ✅ | ❌ | 初始组大小 |
| x-max-in-memory-length | int | ❌ | ✅ | ❌ | 内存中最大消息数 |
| x-max-in-memory-bytes | int | ❌ | ✅ | ❌ | 内存中最大字节数 |
| x-stream-max-segment-size-bytes | int | ❌ | ❌ | ✅ | Segment 大小 |
| x-stream-max-age | string | ❌ | ❌ | ✅ | 消息保留时间 |

## 2. 超限行为（x-overflow）

| 值 | 说明 |
|------|------|
| `drop-head` | 丢弃队头最老的消息（默认） |
| `reject-publish` | 拒绝新消息（生产者收到 nack） |
| `reject-publish-dlx` | 拒绝新消息并发送到 DLX |

```java
Map<String, Object> args = new HashMap<>();
args.put("x-max-length", 10000);
args.put("x-overflow", "reject-publish");
channel.queueDeclare("bounded.queue", true, false, false, args);
```

## 3. 消息 TTL（x-message-ttl）

消息在 Queue 中的最大存活时间。超时后消息变成死信。

```java
// Queue 级别 TTL：所有消息统一 60 秒
Map<String, Object> args = new HashMap<>();
args.put("x-message-ttl", 60000);
args.put("x-dead-letter-exchange", "dlx.exchange");
channel.queueDeclare("delay.queue", true, false, false, args);
```

也可以在发送消息时设置单条消息的 TTL（`expiration` 属性），两者取较小值。

## 4. Queue 过期（x-expires）

Queue 在指定时间内没有消费者连接则自动删除。

```java
Map<String, Object> args = new HashMap<>();
args.put("x-expires", 300000);  // 5 分钟无消费者则删除
channel.queueDeclare("temp.queue", false, false, false, args);
```

适用于临时 Queue 的自动清理。

## 5. 参数不可变

Queue 创建后，扩展参数**不能修改**。要改参数，必须：

1. 创建一个新 Queue（新参数）
2. 将生产者切换到新 Queue
3. 等待旧 Queue 消费完毕
4. 删除旧 Queue

这是 AMQP 协议的设计约束，不是 RabbitMQ 的限制。
