# 事件驱动架构

> 事件驱动架构（EDA）是微服务间解耦的核心范式。RabbitMQ 天然支持事件发布与订阅。

## 1. 领域事件

```java
// 领域事件定义
public class OrderCreatedEvent {
    private String orderId;
    private String userId;
    private BigDecimal amount;
    private List<OrderItem> items;
    private Instant occurredAt;
}

// 事件发布
@Service
public class OrderDomainEventPublisher {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    public void publish(OrderCreatedEvent event) {
        rabbitTemplate.convertAndSend(
            "domain.events",
            "order.created",
            event,
            message -> {
                message.getMessageProperties().setHeader("event-type", "OrderCreated");
                message.getMessageProperties().setHeader("event-version", "1.0");
                return message;
            }
        );
    }
}
```

## 2. 事件消费

```java
// 库存服务 - 扣减库存
@RabbitListener(bindings = @QueueBinding(
    value = @Queue(value = "inventory.order.created", durable = "true"),
    exchange = @Exchange(value = "domain.events", type = ExchangeTypes.TOPIC),
    routingKey = "order.created"
))
public void handleOrderCreated(OrderCreatedEvent event) {
    inventoryService.decrease(event.getItems());
}

// 通知服务 - 发送通知
@RabbitListener(bindings = @QueueBinding(
    value = @Queue(value = "notification.order.created", durable = "true"),
    exchange = @Exchange(value = "domain.events", type = ExchangeTypes.TOPIC),
    routingKey = "order.created"
))
public void handleOrderCreated(OrderCreatedEvent event) {
    notificationService.sendOrderConfirmation(event.getUserId(), event.getOrderId());
}
```

## 3. 事件溯源

```text
Event Store (RabbitMQ Stream Queue)
  ├── OrderCreated
  ├── OrderPaid
  ├── OrderShipped
  └── OrderCompleted

消费者可以回溯重放所有事件
```

## 4. 最终一致性

```text
订单服务 ──Event──▶ 库存服务 ──Event──▶ 积分服务
     │                                      │
     └────────── 最终一致 ◀─────────────────┘
```

每个服务独立消费事件，通过重试和补偿保证最终一致。

## 5. 事件设计原则

| 原则 | 说明 |
| :-- | :-- |
| 不可变 | 事件一旦发布不可修改 |
| 自描述 | 包含足够的上下文信息 |
| 版本化 | 支持事件 schema 演进 |
| 幂等 | 消费端幂等处理 |
| 异步 | 不阻塞发布者 |
