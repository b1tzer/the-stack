# 领域事件

> **核心问题**：什么是领域事件？如何定义和发布领域事件？领域事件与集成事件有什么区别？

## 1. 领域事件的定义

领域事件表示领域中发生的有意义的事情，通常是状态变更的结果。

```java
// 领域事件基类
public abstract class DomainEvent {
    private final String eventId;
    private final LocalDateTime occurredAt;
    
    protected DomainEvent() {
        this.eventId = UUID.randomUUID().toString();
        this.occurredAt = LocalDateTime.now();
    }
    
    public String getEventId() { return eventId; }
    public LocalDateTime getOccurredAt() { return occurredAt; }
    public abstract String getEventType();
}

// 具体领域事件
public class OrderCreatedEvent extends DomainEvent {
    private final Long orderId;
    private final Long userId;
    private final Money totalAmount;
    
    public OrderCreatedEvent(Long orderId, Long userId, Money totalAmount) {
        this.orderId = orderId;
        this.userId = userId;
        this.totalAmount = totalAmount;
    }
    
    @Override
    public String getEventType() { return "order.created"; }
    
    public Long getOrderId() { return orderId; }
    public Long getUserId() { return userId; }
    public Money getTotalAmount() { return totalAmount; }
}

public class OrderConfirmedEvent extends DomainEvent {
    private final Long orderId;
    private final LocalDateTime confirmedAt;
    
    public OrderConfirmedEvent(Long orderId) {
        this.orderId = orderId;
        this.confirmedAt = LocalDateTime.now();
    }
    
    @Override
    public String getEventType() { return "order.confirmed"; }
    
    public Long getOrderId() { return orderId; }
}

public class OrderCancelledEvent extends DomainEvent {
    private final Long orderId;
    private final String reason;
    
    public OrderCancelledEvent(Long orderId, String reason) {
        this.orderId = orderId;
        this.reason = reason;
    }
    
    @Override
    public String getEventType() { return "order.cancelled"; }
    
    public Long getOrderId() { return orderId; }
    public String getReason() { return reason; }
}
```

## 2. 事件发布机制

```java
// 方式一：聚合根收集事件，由应用层统一发布
public class Order {
    private final List<DomainEvent> domainEvents = new ArrayList<>();
    
    public void confirm() {
        this.status = OrderStatus.CONFIRMED;
        domainEvents.add(new OrderConfirmedEvent(this.id));
    }
    
    public List<DomainEvent> getDomainEvents() {
        return Collections.unmodifiableList(domainEvents);
    }
    
    public void clearDomainEvents() {
        domainEvents.clear();
    }
}

// 应用服务中发布事件
@Service
public class OrderApplicationService {
    private final OrderRepository repo;
    private final DomainEventPublisher publisher;
    
    @Transactional
    public void confirmOrder(Long orderId) {
        Order order = repo.findById(orderId);
        order.confirm();
        repo.save(order);
        
        // 事务提交后发布事件
        order.getDomainEvents().forEach(publisher::publish);
        order.clearDomainEvents();
    }
}

// 方式二：使用 Spring 的 ApplicationEventPublisher
@Component
public class SpringDomainEventPublisher implements DomainEventPublisher {
    private final ApplicationEventPublisher springPublisher;
    
    @Override
    public void publish(DomainEvent event) {
        springPublisher.publishEvent(event);
    }
}

// 监听器
@Component
public class OrderEventHandler {
    
    @EventListener
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onOrderConfirmed(OrderConfirmedEvent event) {
        // 发送确认邮件
        emailService.sendOrderConfirmation(event.getOrderId());
        // 更新统计数据
        statisticsService.incrementConfirmedOrders();
    }
}
```

## 3. 领域事件 vs 集成事件

| 特性 | 领域事件 | 集成事件 |
| :-- | :-- | :-- |
| 范围 | 限界上下文内部 | 跨限界上下文 |
| 传输 | 进程内（内存） | 跨进程（消息队列） |
| 格式 | 领域对象 | DTO / 通用格式 |
| 发布 | 事务提交后 | 通过消息中间件 |

```java
// 集成事件：跨服务通信
public record OrderCreatedIntegrationEvent(
    String eventId,
    String orderId,
    String userId,
    BigDecimal amount,
    String currency,
    LocalDateTime occurredAt
) {}

// 发布集成事件到消息队列
@Component
public class IntegrationEventPublisher {
    private final RocketMQTemplate rocketMQ;
    
    public void publishOrderCreated(Order order) {
        OrderCreatedIntegrationEvent event = new OrderCreatedIntegrationEvent(
            UUID.randomUUID().toString(),
            order.getId().toString(),
            order.getUserId().toString(),
            order.getTotalAmount().amount(),
            order.getTotalAmount().currency().name(),
            LocalDateTime.now()
        );
        rocketMQ.convertAndSend("order-events", event);
    }
}
```

## 4. 事件存储

```java
// 事件存储表结构
// CREATE TABLE domain_events (
//     id BIGINT PRIMARY KEY AUTO_INCREMENT,
//     event_type VARCHAR(100) NOT NULL,
//     aggregate_type VARCHAR(100) NOT NULL,
//     aggregate_id VARCHAR(100) NOT NULL,
//     payload JSON NOT NULL,
//     occurred_at TIMESTAMP NOT NULL,
//     published BOOLEAN DEFAULT FALSE
// );

@Repository
public class JpaDomainEventStore implements DomainEventStore {
    
    @Override
    @Transactional
    public void save(DomainEvent event, String aggregateType, String aggregateId) {
        DomainEventEntity entity = new DomainEventEntity();
        entity.setEventType(event.getEventType());
        entity.setAggregateType(aggregateType);
        entity.setAggregateId(aggregateId);
        entity.setPayload(toJson(event));
        entity.setOccurredAt(event.getOccurredAt());
        entity.setPublished(false);
        jpaRepo.save(entity);
    }
    
    @Override
    public List<DomainEvent> findUnpublished() {
        return jpaRepo.findByPublishedFalse().stream()
            .map(this::toDomainEvent)
            .toList();
    }
}
```

> **核心原则**：领域事件是领域专家关心的事件，不是技术事件。"订单已确认"是领域事件，"数据库记录已更新"不是。事件的命名应该使用业务语言，而非技术语言。
