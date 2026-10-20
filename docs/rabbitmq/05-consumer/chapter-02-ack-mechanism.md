# ACK 机制

> ACK（Acknowledgement）是 RabbitMQ 消费端保障消息可靠处理的最后一道防线。

## 1. 消息确认的完整链路

```txt
Producer ──Confirm──▶ Broker ──投递──▶ Consumer ──ACK──▶ Broker 删除消息
         (消息到达)          (消息送达)         (消息处理完成)
```

三个环节缺一不可：

- **Publisher Confirm**：确认消息到达 Broker
- **Consumer ACK**：确认消息被消费处理
- **持久化**：让消息在 Broker 重启后仍可恢复

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

这里把 `requeue=true` 作为所有异常的默认处理，只是最简演示。生产代码应区分可重试错误与永久性错误（如消息格式错误），避免对同一缺陷消息无限重试。

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

消息重新入队（位置不保证回到队头），会被重新消费。问题：如果消息本身有缺陷（如格式错误），会无限重试。

### 4.2 拒绝并进入死信

```java
channel.basicNack(tag, false, false);  // requeue=false
```

消息不重新入队；若队列配置了 DLX，则路由到死信队列，否则消息被直接丢弃。适用于多次重试失败的消息。

### 4.3 重试策略

```java
Object retryObj = message.getMessageProperties()
    .getHeaders().getOrDefault("x-retry-count", 0);
int retryCount = retryObj instanceof Integer ? (Integer) retryObj : 0;

try {
    processMessage(body);
    channel.basicAck(tag, false);
} catch (Exception e) {
    if (retryCount < 3) {
        // 重试：复制原 headers 后更新计数，保留原 headers
        Map<String, Object> headers = new HashMap<>(message.getMessageProperties().getHeaders());
        headers.put("x-retry-count", retryCount + 1);
        AMQP.BasicProperties newProps = new AMQP.BasicProperties.Builder()
            .headers(headers)
            .build();
        channel.basicPublish("", "order.queue", newProps, body);
        channel.basicAck(tag, false);  // 确认原消息
    } else {
        // 超过重试次数，进死信
        channel.basicNack(tag, false, false);
    }
}
```

上面的重新发布是简化示意，存在可靠性缺口：`basicPublish` 正常返回不代表重试消息已被 Broker 可靠接收并落盘，若先 ack 原消息而重试消息在 Broker 端丢失，业务消息就没了。可靠的实现应使用 Publisher Confirm 确认重试消息已被 Broker 接受、且目标路由有效后再 ack 原消息；确认结果未知（如连接中断）时不要 ack 原消息，并接受重试发布可能产生重复消息的情况，配合幂等消费兜底。或改用 RabbitMQ 原生的重试机制（延迟队列 + DLX）。

## 5. ACK 超时

如果 Consumer 收到消息后长时间不 ack，会发生什么？

- 消息处于 unacked 状态，不会被重新投递给其他 Consumer
- 如果 Consumer 断开连接，unacked 消息自动重新入队
- Prefetch 限制了 unacked 消息数量，不会无限堆积

超时处理要区分两个层面，不能混为一谈：

- **业务处理超时**：由消费者应用自行检测，超时后按业务策略 nack、重新发布或进入重试流程。这是应用层行为。
- **Broker 确认超时**：RabbitMQ 的 delivery acknowledgement timeout，用于检测长时间未确认的投递。超时后 Broker 将未确认消息重新入队（4.3 基线仅 Quorum Queue 支持；AMQP 0-9-1 客户端在支持 `consumer_cancel_notify` 时收到 `basic.cancel` 取消该消费者，否则关闭 Channel），它不会代替应用执行 nack 逻辑。

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

方案 1 存在原子性窗口：`setIfAbsent` 成功后若业务处理失败或进程崩溃，重投的消息会被识别为重复并直接 ack，导致业务实际未完成。去重标记只代表「消息已接收」，不能代替「业务已成功完成」。涉及订单、支付等不能遗漏的业务时，应优先用数据库唯一约束或事务内状态更新实现幂等，而不是仅凭一次 Redis SETNX 的成功就视为处理完成。方案 2 的可靠性同样取决于唯一约束与事务边界是否真正覆盖业务操作，`tryProcess` 返回 true 不等同于天然幂等。
