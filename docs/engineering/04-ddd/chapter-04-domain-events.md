# 领域事件

> **核心问题**：什么是领域事件？如何定义和发布领域事件？领域事件与集成事件有什么区别？

## 1. 领域事件的定义

领域事件表示领域中发生的有意义的事情，通常是状态变更的结果。

```java
// 领域事件基类
public abstract class DomainEvent {
    private final String eventId;
    private final Instant occurredAt;
    
    protected DomainEvent() {
        this.eventId = UUID.randomUUID().toString();
        this.occurredAt = Instant.now();
    }
    
    public String getEventId() { return eventId; }
    public Instant getOccurredAt() { return occurredAt; }
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
    private final Instant confirmedAt;
    
    public OrderConfirmedEvent(Long orderId) {
        this.orderId = orderId;
        this.confirmedAt = Instant.now();
    }
    
    @Override
    public String getEventType() { return "order.confirmed"; }
    
    public Long getOrderId() { return orderId; }
    public Instant getConfirmedAt() { return confirmedAt; }
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
// 聚合根收集事件，由应用层统一发布
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

// 应用服务：事务内发布 Spring 进程内事件，由监听器延迟到事务提交后处理
@Service
public class OrderApplicationService {
    private final OrderRepository repo;
    private final ApplicationEventPublisher publisher;
    
    @Transactional
    public void confirmOrder(Long orderId) {
        Order order = repo.findById(orderId);
        order.confirm();
        repo.save(order);
        
        // 事务内发布进程内事件，配合 @TransactionalEventListener 延迟到提交后执行
        order.getDomainEvents().forEach(publisher::publishEvent);
        order.clearDomainEvents();
    }
}

// 监听器：仅在事务成功提交后执行，避免事务未提交就触发外部副作用
@Component
public class OrderEventHandler {
    
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onOrderConfirmed(OrderConfirmedEvent event) {
        // 发送确认邮件
        emailService.sendOrderConfirmation(event.getOrderId());
        // 更新统计数据
        statisticsService.incrementConfirmedOrders();
    }
}
```

> **边界说明**：
> 1. `@TransactionalEventListener(phase = AFTER_COMMIT)` 保证监听器在事务成功提交后执行；无事务时默认不触发，如需无事务场景也执行可设置 `fallbackExecution = true`。
> 2. 它只保证进程内回调的时序，不保证消息可靠投递。可靠投递到消息中间件需使用事务性 Outbox（见第 4 节）。

## 3. 领域事件 vs 集成事件

| 特性 | 领域事件 | 集成事件 |
| :-- | :-- | :-- |
| 语义 | 领域内发生的业务事实 | 对外广播的业务变化 |
| 受众 | 限界上下文内部 | 其他上下文或外部系统 |
| 契约 | 通常使用上下文内部的类型与模型 | 稳定的对外契约，不暴露内部领域对象 |
| 常见传输 | 进程内事件（内存） | 消息中间件（跨进程） |

> 领域事件与集成事件的本质区别在语义与受众，而非传输方式。一个上下文内部也可以通过消息中间件异步处理业务事件；一个领域事件可以在上下文边界处被转换为一个或多个集成事件对外发布。上表中的"传输"行是常见实现选择，不是分类定义。

```java
// 集成事件：跨服务通信
// 跨服务传输的时间字段使用带时区的 Instant（或 UTC 时间戳），避免 LocalDateTime 无时区导致歧义
public record OrderCreatedIntegrationEvent(
    String eventId,
    String orderId,
    String userId,
    BigDecimal amount,
    String currency,
    Instant occurredAt
) {}

// 发布集成事件到消息队列
@Component
public class IntegrationEventPublisher {
    private final RocketMQTemplate rocketMQ;
    
    // 由领域事件转换集成事件，沿用源事件的稳定 ID 与发生时间，保证消费端可幂等识别
    public void publishOrderCreated(OrderCreatedEvent domainEvent) {
        OrderCreatedIntegrationEvent event = new OrderCreatedIntegrationEvent(
            domainEvent.getEventId(),
            domainEvent.getOrderId().toString(),
            domainEvent.getUserId().toString(),
            domainEvent.getTotalAmount().amount(),
            domainEvent.getTotalAmount().currency().name(),
            domainEvent.getOccurredAt()
        );
        rocketMQ.convertAndSend("order-events", event);
    }
}
```

## 4. 事务性 Outbox

领域事件如需可靠投递到消息中间件，不能直接在业务事务内发送消息，否则事务回滚后消息已发出，或消息发出时事务尚未提交。事务性 Outbox 在同一个本地数据库事务中保存聚合变更与待发送事件，再由独立发布器异步投递并标记已发布。

```java
// Outbox 表结构：id 是存储主键，event_id 是业务事件标识（唯一，用于幂等）
// CREATE TABLE outbox_events (
//     id BIGINT PRIMARY KEY AUTO_INCREMENT,
//     event_id VARCHAR(36) UNIQUE NOT NULL,
//     event_type VARCHAR(100) NOT NULL,
//     aggregate_type VARCHAR(100) NOT NULL,
//     aggregate_id VARCHAR(100) NOT NULL,
//     payload JSON NOT NULL,
//     occurred_at TIMESTAMP NOT NULL,
//     published BOOLEAN DEFAULT FALSE
// );

// 关键前提：聚合变更与 Outbox 记录必须在同一个数据库事务中写入。
// 需要可靠投递时，把第 2 节"发布进程内事件"替换为写入 Outbox 记录：
@Transactional
public void confirmOrder(Long orderId) {
    Order order = repo.findById(orderId);
    order.confirm();
    repo.save(order);
    order.getDomainEvents().forEach(
        e -> outboxStore.save(e, "Order", orderId.toString())
    );
}

@Repository
public class OutboxEventStore {
    
    // 不单独标注 @Transactional，加入应用服务的既有事务（REQUIRED 传播）
    public void save(DomainEvent event, String aggregateType, String aggregateId) {
        OutboxEventEntity entity = new OutboxEventEntity();
        entity.setEventId(event.getEventId());       // 业务事件标识，与表主键 id 分离
        entity.setEventType(event.getEventType());
        entity.setAggregateType(aggregateType);
        entity.setAggregateId(aggregateId);
        entity.setPayload(toJson(event));
        entity.setOccurredAt(event.getOccurredAt());
        entity.setPublished(false);
        jpaRepo.save(entity);
    }
    
    // 反序列化必须恢复持久化的原始 eventId 与 occurredAt，不能走构造函数重新生成，
    // 否则 markPublished 找不到对应记录，消费端幂等标识也会随之改变
    public List<DomainEvent> findUnpublished() {
        return jpaRepo.findByPublishedFalse().stream()
            .map(this::toDomainEvent)   // 从记录恢复原始 ID、时间与载荷
            .toList();
    }
    
    // 独立事务更新状态（发布器在业务事务结束后调用，不能复用已结束的业务事务）
    public void markPublished(String eventId) {
        jpaRepo.markPublishedByEventId(eventId);     // 按 event_id 标记已发布
    }
}

// 独立发布器：轮询待发送事件，投递成功后标记已发布
// 示例假设单发布器实例；多实例部署需引入并发领取机制（如数据库行锁或状态条件更新），避免重复发送同一条记录
@Component
public class OutboxPublisher {
    private final OutboxEventStore outboxStore;
    private final RocketMQTemplate rocketMQ;
    
    @Scheduled(fixedDelay = 1000)
    public void publish() {
        for (DomainEvent event : outboxStore.findUnpublished()) {
            try {
                // toIntegrationEvent 只转换需要对外发布的事件，按事件类型路由，
                // 并非所有领域事件都对外广播
                rocketMQ.convertAndSend("order-events", toIntegrationEvent(event));
                outboxStore.markPublished(event.getEventId());
            } catch (Exception e) {
                // 记录事件 ID 与异常，保留 published=false 等待下次轮询重试
                log.error("outbox 发送失败, eventId={}", event.getEventId(), e);
            }
        }
    }
}
```

> **边界说明**：Outbox 解决的是数据库与消息中间件"双写"的原子性问题，不是事件溯源。事件溯源以事件序列作为聚合状态的事实来源，通过重放事件重建状态；Outbox 则以业务数据为主要持久化对象，事件仅用于对外投递，本节的事件记录不用于重建聚合状态。在发布器持续重试且不丢弃待发送记录的前提下，Outbox 通常提供至少一次投递语义；消息发送成功但标记失败会导致重复投递，因此消费端仍需按稳定 `eventId` 幂等去重。

> **核心原则**：领域事件是领域专家关心的事件，不是技术事件。"订单已确认"是领域事件，"数据库记录已更新"不是。
