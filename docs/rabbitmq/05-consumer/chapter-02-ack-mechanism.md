# ACK 机制

> ACK（Acknowledgement）是 RabbitMQ 保证"消息不丢"的最后一道防线。

## 1. 消息确认的完整链路

```txt
Producer ──Confirm──▶ Broker ──投递──▶ Consumer ──ACK──▶ Broker 删除消息
         (消息到达)          (消息送达)         (消息处理完成)
```

三个环节缺一不可：

- **Publisher Confirm**：保证消息到达 Broker
- **Consumer ACK**：保证消息被成功处理
- **持久化**：保证 Broker 崩溃后消息不丢

## 2. ACK 的时机

```java
channel.basicConsume("order.queue", false, new DefaultConsumer(channel) {
    @Override
    public void handleDelivery(String tag, Envelope envelope,
                               AMQP.BasicProperties props, byte[] body) {
        try {
            // 1. 先处理业务逻辑
            processOrder(body);
            
            // 2. 处理成功后确认
            channel.basicAck(envelope.getDeliveryTag(), false);
        } catch (Exception e) {
            // 3. 处理失败后拒绝
            channel.basicNack(envelope.getDeliveryTag(), false, true);
        }
    }
});
```

**关键**：必须在业务处理完成后再 ack。如果先 ack 再处理，处理时崩溃会导致消息丢失。

## 3. 批量 ACK

```java
// 确认 deliveryTag 及之前的所有消息
channel.basicAck(deliveryTag, true);
```

批量 ack 的风险：如果 ack 了 tag=100，但 tag=50 的消息处理失败，50 也被确认了。谨慎使用。

## 4. 拒绝与重试

### 4.1 拒绝并重新入队

```java
channel.basicNack(tag, false, true);  // requeue=true
```

消息回到 Queue 头部，会被重新消费。问题：如果消息本身有缺陷（如格式错误），会无限重试。

### 4.2 拒绝并进入死信

```java
channel.basicNack(tag, false, false);  // requeue=false
```

消息进入 DLX。适用于多次重试失败的消息。

### 4.3 重试策略

```java
int retryCount = message.getMessageProperties()
    .getHeaders().getOrDefault("x-retry-count", 0);

try {
    processMessage(body);
    channel.basicAck(tag, false);
} catch (Exception e) {
    if (retryCount < 3) {
        // 重试：更新 retry count，重新入队
        AMQP.BasicProperties newProps = new AMQP.BasicProperties.Builder()
            .headers(Map.of("x-retry-count", retryCount + 1))
            .build();
        channel.basicPublish("", "order.queue", newProps, body);
        channel.basicAck(tag, false);  // 确认原消息
    } else {
        // 超过重试次数，进死信
        channel.basicNack(tag, false, false);
    }
}
```

## 5. ACK 超时

如果 Consumer 收到消息后长时间不 ack，会发生什么？

- 消息处于 unacked 状态，不会被重新投递给其他 Consumer
- 如果 Consumer 断开连接，unacked 消息自动重新入队
- Prefetch 限制了 unacked 消息数量，不会无限堆积

**最佳实践**：设置合理的处理超时，超时后 nack 并重新入队。

## 6. ACK 与 Prefetch 的配合

```txt
Prefetch = 10
  Consumer 当前有 7 条未确认消息
  Broker 还能推 3 条
  Consumer 处理完 1 条并 ack → Broker 再推 1 条
```

Prefetch 保证了：如果 Consumer 处理慢，Broker 不会无限制地推送消息。

## 7. 幂等消费

由于消息可能被重复投递（网络问题、Consumer 崩溃），消费者必须做幂等处理：

```java
// 方案 1：消息 ID 去重
String messageId = props.getMessageId();
if (redis.setIfAbsent("consumed:" + messageId, "1", 24, TimeUnit.HOURS)) {
    processMessage(body);
    channel.basicAck(tag, false);
} else {
    log.info("Duplicate message: {}", messageId);
    channel.basicAck(tag, false);  // 直接确认，不重复处理
}

// 方案 2：业务唯一键去重
String orderId = extractOrderId(body);
if (orderService.tryProcess(orderId)) {  // 数据库唯一约束
    channel.basicAck(tag, false);
} else {
    channel.basicAck(tag, false);
}
```
