# ACK 机制

> ACK（Acknowledgement）机制保证消息被成功处理。它是 RabbitMQ 消息可靠性消费的核心。

## 1. ACK 模式

### 1.1 自动 ACK（不推荐）

```java
channel.basicConsume(queue, true, deliverCallback, cancelCallback);
```

消息发送给消费者即认为消费成功。如果消费者处理过程中崩溃，消息丢失。

### 1.2 手动 ACK（推荐）

```java
channel.basicConsume(queue, false, deliverCallback, cancelCallback);

// 处理成功
channel.basicAck(deliveryTag, false);

// 处理失败
channel.basicNack(deliveryTag, false, true);  // requeue = true
```

## 2. ACK 语义

| 方法 | 说明 |
| :-- | :-- |
| basicAck | 确认消息被成功处理 |
| basicNack | 拒绝消息，可选择重新入队 |
| basicReject | 拒绝单条消息，可选择重新入队 |

### 2.1 basicAck

```java
// 确认单条
channel.basicAck(deliveryTag, false);

// 确认多条（deliveryTag 及之前的所有消息）
channel.basicAck(deliveryTag, true);
```

### 2.2 basicNack

```java
// 拒绝单条，重新入队
channel.basicNack(deliveryTag, false, true);

// 拒绝多条，不重新入队（进入死信）
channel.basicNack(deliveryTag, true, false);
```

### 2.3 basicReject

```java
// 拒绝单条，不重新入队
channel.basicReject(deliveryTag, false);
```

与 basicNack 的区别：basicReject 不支持批量（multiple）。

## 3. requeue 的陷阱

```java
// 危险：消息会反复入队，形成死循环
channel.basicNack(deliveryTag, false, true);
```

正确做法：

```java
// 先检查重试次数
int retryCount = (int) delivery.getProperties()
    .getHeaders().getOrDefault("x-retry-count", 0);

if (retryCount < 3) {
    // 重试：增加重试计数，重新发布到原队列
    AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
        .headers(Map.of("x-retry-count", retryCount + 1))
        .build();
    channel.basicPublish(exchange, routingKey, props, body);
    channel.basicAck(deliveryTag, false);
} else {
    // 超过重试次数，进入死信
    channel.basicNack(deliveryTag, false, false);
}
```

## 4. 最佳实践

- 永远使用手动 ACK
- 消息处理完成后再 ACK，不要提前
- 处理失败时 nack + requeue=false，让死信队列处理
- 设置重试次数上限，避免无限循环
- 消费者崩溃时未 ACK 的消息会自动重新投递
