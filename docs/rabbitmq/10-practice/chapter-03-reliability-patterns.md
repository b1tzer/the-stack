# 可靠性模式

> 本章总结保证 RabbitMQ 消息可靠性的完整方案，从生产到消费的全链路。

## 1. 可靠性全景

```text
Producer ──Confirm──▶ Exchange ──Binding──▶ Queue ──ACK──▶ Consumer
    │                    │                   │               │
    ▼                    ▼                   ▼               ▼
 消息入库            路由失败             持久化          业务处理
 补发机制            Return/AE            Quorum         幂等设计
```

## 2. 生产端可靠性

### 2.1 本地消息表

```java
@Transactional
public void createOrder(Order order) {
    // 1. 保存订单
    orderRepository.save(order);

    // 2. 保存消息到本地表
    messageRepository.save(new OutboxMessage(
        UUID.randomUUID().toString(),
        "order.exchange",
        "order.created",
        objectMapper.writeValueAsString(order),
        "PENDING"
    ));
}

// 异步发送
@Scheduled(fixedDelay = 1000)
public void sendPendingMessages() {
    List<OutboxMessage> messages = messageRepository.findByStatus("PENDING");
    for (OutboxMessage msg : messages) {
        rabbitTemplate.convertAndSend(msg.getExchange(), msg.getRoutingKey(), msg.getBody());
        messageRepository.updateStatus(msg.getId(), "SENT");
    }
}
```

### 2.2 事务消息（半消息）

```java
// 1. 发送半消息到 broker
// 2. 执行本地事务
// 3. 根据事务结果 commit 或 rollback
```

## 3. 消费端可靠性

### 3.1 幂等消费

```java
@RabbitListener(queues = "order.queue")
public void handleOrder(Message message, Channel channel) {
    String messageId = message.getMessageProperties().getMessageId();

    // 去重检查
    if (processedMessageRepository.exists(messageId)) {
        channel.basicAck(deliveryTag, false);
        return;
    }

    // 处理 + 记录（同一事务）
    processOrder(message);
    processedMessageRepository.save(messageId);

    channel.basicAck(deliveryTag, false);
}
```

### 3.2 重试 + 死信

```java
// 重试 3 次后进入死信
int retryCount = getRetryCount(message);
if (retryCount >= 3) {
    channel.basicNack(deliveryTag, false, false); // 进入死信
} else {
    // 重试：延迟后重新发布
    delayAndRetry(message, retryCount + 1);
    channel.basicAck(deliveryTag, false);
}
```

## 4. 可靠性检查清单

| 环节 | 检查项 |
| :-- | :-- |
| 生产者 | ✅ 开启 Publisher Confirm |
| 生产者 | ✅ 消息持久化（deliveryMode=2） |
| 生产者 | ✅ 本地消息表或事务消息 |
| Broker | ✅ 交换器持久化 |
| Broker | ✅ 队列持久化 |
| Broker | ✅ 使用 Quorum Queue |
| 消费者 | ✅ 手动 ACK |
| 消费者 | ✅ 幂等处理 |
| 消费者 | ✅ 死信队列兜底 |
| 监控 | ✅ 死信队列告警 |
| 监控 | ✅ 消息堆积告警 |

## 5. 不同可靠性级别

| 级别 | 配置 | 适用场景 |
| :-- | :-- | :-- |
| 最低 | auto-ack, 非持久化 | 日志、监控 |
| 中等 | manual-ack, 持久化 | 一般业务 |
| 最高 | Confirm + Quorum + 本地消息表 | 订单、支付 |
