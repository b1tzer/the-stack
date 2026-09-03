# 事件驱动架构

> **核心问题**：什么是事件驱动？CQRS 和事件溯源如何工作？在什么场景下使用？

## 1. 事件驱动的核心概念

事件驱动架构（EDA）中，组件通过发布和订阅事件来通信，而非直接调用。

| 概念 | 说明 |
| :-- | :-- |
| 事件（Event） | 已发生的事实，不可变，如 `OrderCreated` |
| 生产者 | 发布事件的组件 |
| 消费者 | 订阅并处理事件的组件 |
| 事件总线 | 事件的传输通道（Kafka、RocketMQ） |

## 2. 领域事件模式

```java
// 领域事件定义
public record OrderCreatedEvent(
    Long orderId,
    String userId,
    BigDecimal amount,
    LocalDateTime occurredAt
) {
    public OrderCreatedEvent {
        if (occurredAt == null) occurredAt = LocalDateTime.now();
    }
}

// 事件发布
@Service
public class OrderService {
    private final ApplicationEventPublisher publisher;
    
    public OrderService(ApplicationEventPublisher publisher) {
        this.publisher = publisher;
    }
    
    public Long createOrder(CreateOrderCommand command) {
        Order order = new Order(command.userId(), command.amount());
        orderRepository.save(order);
        
        // 发布领域事件
        publisher.publishEvent(new OrderCreatedEvent(
            order.getId(), order.getUserId(), order.getAmount(), null
        ));
        return order.getId();
    }
}

// 事件监听（同步）
@Component
public class OrderEventListener {
    
    @EventListener
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onOrderCreated(OrderCreatedEvent event) {
        // 事务提交后执行：扣减库存、发送通知等
        inventoryService.deduct(event.orderId());
        notificationService.sendOrderConfirmation(event.orderId());
    }
}
```

## 3. CQRS（命令查询职责分离）

将读写操作分离为独立的模型和路径。

```java
// 命令端（写模型）- 关注业务规则
@Service
public class OrderCommandService {
    private final OrderRepository repository;
    
    public void createOrder(CreateOrderCommand cmd) {
        Order order = new Order(cmd.getUserId(), cmd.getAmount());
        order.addItem(cmd.getProductId(), cmd.getQuantity());
        order.confirm();  // 业务规则校验
        repository.save(order);
    }
    
    public void cancelOrder(Long orderId) {
        Order order = repository.findById(orderId);
        order.cancel();  // 状态变更
        repository.save(order);
    }
}

// 查询端（读模型）- 关注查询性能
@Service
public class OrderQueryService {
    private final JdbcTemplate jdbcTemplate;
    
    // 查询优化：使用专门的读模型（宽表、反范式化）
    public OrderDetailVO getOrderDetail(Long orderId) {
        String sql = """
            SELECT o.id, o.status, o.amount, 
                   u.name AS user_name, u.phone AS user_phone,
                   GROUP_CONCAT(p.name) AS product_names
            FROM orders o
            JOIN users u ON o.user_id = u.id
            JOIN order_items oi ON o.id = oi.order_id
            JOIN products p ON oi.product_id = p.id
            WHERE o.id = ?
            GROUP BY o.id
            """;
        return jdbcTemplate.queryForObject(sql, new OrderDetailMapper(), orderId);
    }
}

// 读模型物化：通过事件同步到查询数据库
@Component
public class OrderReadModelProjector {
    
    @EventListener
    public void onOrderCreated(OrderCreatedEvent event) {
        // 将写入事件同步到读数据库（反范式化的宽表）
        jdbcTemplate.update(
            "INSERT INTO order_read_model (order_id, user_name, amount, status, created_at) " +
            "VALUES (?, ?, ?, ?, ?)",
            event.orderId(), getUserName(event.userId()), 
            event.amount(), "CREATED", event.occurredAt()
        );
    }
}
```

## 4. 事件溯源（Event Sourcing）

不存储当前状态，而是存储所有状态变更事件，通过重放事件得到当前状态。

```java
// 事件存储
public class EventStore {
    private final List<DomainEvent> events = new ArrayList<>();
    
    public void append(String aggregateId, DomainEvent event) {
        events.add(event);
        // 持久化到事件存储（如 Kafka、EventStoreDB）
    }
    
    public List<DomainEvent> getEvents(String aggregateId) {
        return events.stream()
            .filter(e -> e.aggregateId().equals(aggregateId))
            .toList();
    }
}

// 聚合根：通过重放事件恢复状态
public class OrderAggregate {
    private String id;
    private OrderStatus status;
    private BigDecimal amount;
    private List<DomainEvent> uncommittedEvents = new ArrayList<>();
    
    // 从事件流重建聚合
    public static OrderAggregate fromEvents(List<DomainEvent> events) {
        OrderAggregate order = new OrderAggregate();
        events.forEach(order::apply);
        return order;
    }
    
    // 命令方法：产生事件
    public void create(String userId, BigDecimal amount) {
        apply(new OrderCreatedEvent(generateId(), userId, amount, LocalDateTime.now()));
    }
    
    public void confirm() {
        if (status != OrderStatus.CREATED) {
            throw new IllegalStateException("只有已创建的订单才能确认");
        }
        apply(new OrderConfirmedEvent(id, LocalDateTime.now()));
    }
    
    // 应用事件：更新状态
    private void apply(DomainEvent event) {
        when(event);
        uncommittedEvents.add(event);
    }
    
    private void when(DomainEvent event) {
        if (event instanceof OrderCreatedEvent e) {
            this.id = e.orderId();
            this.status = OrderStatus.CREATED;
            this.amount = e.amount();
        } else if (event instanceof OrderConfirmedEvent) {
            this.status = OrderStatus.CONFIRMED;
        }
    }
    
    private String generateId() { return UUID.randomUUID().toString(); }
}
```

## 5. 事件驱动的适用场景

| 场景 | 推荐方案 | 原因 |
| :-- | :-- | :-- |
| 简单 CRUD | 传统 MVC | 事件驱动增加不必要的复杂度 |
| 跨服务数据同步 | 领域事件 + 消息队列 | 解耦服务，最终一致性 |
| 复杂查询需求 | CQRS | 读写分离，各自优化 |
| 审计需求 | 事件溯源 | 完整的操作历史 |
| 实时数据流 | 事件流处理 | Kafka Streams / Flink |

> **核心原则**：事件驱动不是万能药。对于简单的 CRUD 应用，传统的请求-响应模型更简单直接。只有在需要解耦、异步处理、审计追踪等场景时，才值得引入事件驱动的复杂度。

## 6. 为什么需要事件驱动：同步链路的局限

事件驱动的价值，只有在看清同步链路的瓶颈后才能真正理解。一条典型的同步调用链：

```txt
用户下单 → 订单服务 → 库存服务 → 积分服务 → 通知服务
              │           │           │           │
              └───────────┴───────────┴───────────┘
                    同步 RPC，逐个等待返回
```

同步链路有三个痛点：

| 痛点 | 表现 |
| :-- | :-- |
| 延迟叠加 | 总耗时 = 各环节耗时之和，任一环节慢则全链路慢 |
| 可用性耦合 | 下游挂了，上游跟着失败，一个环节拖垮整条链路 |
| 扩展受限 | 流量峰值需要所有环节同步扩容，成本高 |

事件驱动把「同步调用」改成「异步订阅」：上游发布事件即返回，下游按自己的节奏消费。代价是引入了最终一致性和消息可靠性问题——这正是事件驱动架构需要谨慎权衡的地方（详见 [Kafka](../../kafka/01-intro/chapter-01-what-is-kafka) 与消息可靠性相关章节）。

## 7. 命令 vs 事件

| 维度 | 命令（Command） | 事件（Event） |
| :-- | :-- | :-- |
| 语义 | 请求做某件事（意图） | 陈述已发生的事实 |
| 时态 | 未来 | 过去 |
| 命名 | 动词，如 `CreateOrder` | 过去分词，如 `OrderCreated` |
| 可否拒绝 | 可以拒绝、可以失败 | 不可拒绝，事实已发生 |
| 消费方 | 单一目标 | 多个订阅者 |

命名上的区别最容易混淆：`CreateOrderCommand` 是「请创建一个订单」，可能被拒；`OrderCreatedEvent` 是「订单已创建」，已成事实。把两者混用，会导致订阅者对「这是请求还是事实」产生歧义。
