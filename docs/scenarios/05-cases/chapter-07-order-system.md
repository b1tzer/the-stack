# 电商订单系统

> 以电商订单系统为例，展示 RabbitMQ 在实际业务中的完整应用：订单创建、支付通知、库存扣减、物流通知。

## 1. 系统架构

```txt
┌──────────────┐         ┌──────────────┐
│  订单服务    │────────▶│ order.exchange│ (topic)
└──────────────┘         └──────┬───────┘
                                │
            ┌───────────────────┼───────────────────┐
            ▼                   ▼                   ▼
    ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
    │ order.created│   │ order.paid   │   │ order.shipped│
    │   .queue     │   │   .queue     │   │   .queue     │
    └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
           ▼                   ▼                   ▼
    ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
    │  库存服务    │   │  支付服务    │   │  物流服务    │
    └──────────────┘   └──────────────┘   └──────────────┘
```

## 2. 交换器与队列设计

```java
// 交换器
channel.exchangeDeclare("order.exchange", BuiltinExchangeType.TOPIC, true);

// 队列
channel.queueDeclare("order.created.queue", true, false, false, quorumArgs);
channel.queueDeclare("order.paid.queue", true, false, false, quorumArgs);
channel.queueDeclare("order.shipped.queue", true, false, false, quorumArgs);

// 死信
channel.exchangeDeclare("dlx.order.exchange", BuiltinExchangeType.DIRECT, true);
channel.queueDeclare("dlx.order.queue", true, false, false, null);

// 绑定
channel.queueBind("order.created.queue", "order.exchange", "order.created");
channel.queueBind("order.paid.queue", "order.exchange", "order.paid");
channel.queueBind("order.shipped.queue", "order.exchange", "order.shipped");
```

## 3. 订单创建流程

```java
// 1. 创建订单（数据库操作）
Order order = orderRepository.save(new Order(userId, items));

// 2. 发送订单创建事件
OrderEvent event = new OrderEvent(order.getId(), "CREATED", Instant.now());
rabbitTemplate.convertAndSend("order.exchange", "order.created", event);

// 3. 库存服务消费
@RabbitListener(queues = "order.created.queue")
public void handleOrderCreated(OrderEvent event, Channel channel) {
    try {
        inventoryService.decrease(event.getOrderId());
        channel.basicAck(event.getDeliveryTag(), false);
    } catch (Exception e) {
        channel.basicNack(event.getDeliveryTag(), false, false);
    }
}
```

## 4. 支付回调流程

```java
// 支付回调
@PostMapping("/pay/callback")
public void payCallback(PayCallbackRequest request) {
    // 1. 更新订单状态
    orderService.markPaid(request.getOrderId());

    // 2. 发送支付成功事件
    OrderEvent event = new OrderEvent(request.getOrderId(), "PAID", Instant.now());
    rabbitTemplate.convertAndSend("order.exchange", "order.paid", event);
}
```

## 5. 超时取消

```java
// 延迟队列实现订单超时取消
Map<String, Object> delayArgs = new HashMap<>();
delayArgs.put("x-message-ttl", 1800000); // 30 分钟
delayArgs.put("x-dead-letter-exchange", "order.exchange");
delayArgs.put("x-dead-letter-routing-key", "order.timeout");
channel.queueDeclare("delay.order.timeout", true, false, false, delayArgs);

// 创建订单时发送延迟消息
rabbitTemplate.convertAndSend("delay.exchange", "order.timeout", order.getId());

// 超时消费者
@RabbitListener(queues = "order.timeout.queue")
public void handleOrderTimeout(String orderId, Channel channel) {
    Order order = orderRepository.findById(orderId);
    if (order.getStatus().equals("CREATED")) {
        orderService.cancel(orderId);
        inventoryService.restore(orderId);
    }
    channel.basicAck(deliveryTag, false);
}
```

## 6. 消息可靠性保证

| 环节 | 措施 |
| :-- | :-- |
| 生产者 | Publisher Confirm + 消息入库 |
| Broker | Quorum Queue + 持久化 |
| 消费者 | 手动 ACK + 幂等处理 |
| 超时 | 延迟队列 + 状态检查 |
