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
    
    @Transactional
    public Long createOrder(CreateOrderCommand command) {
        Order order = new Order(command.userId(), command.amount());
        orderRepository.save(order);
        
        // 发布领域事件，事务提交后由 AFTER_COMMIT 监听器处理
        publisher.publishEvent(new OrderCreatedEvent(
            order.getId(), order.getUserId(), order.getAmount(), null
        ));
        return order.getId();
    }
}

// 事件监听（同步）
@Component
public class OrderEventListener {
    
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onOrderCreated(OrderCreatedEvent event) {
        // AFTER_COMMIT 默认仍在发布线程同步执行，不是异步。
        // 此时订单已持久化，下游失败无法再回滚原事务。
        inventoryService.deduct(event.orderId());
        notificationService.sendOrderConfirmation(event.orderId());
    }
}
```

上面的示例是进程内事件通知，与跨服务的可靠投递是两回事。事务提交后执行的动作如果允许丢失，可以用进程内事件；如果必须可靠送达（如订单事件要驱动其他服务），要用事务性发件箱（Transactional Outbox），在同一数据库事务里写入业务数据和待发送事件，再由后台任务或 CDC 投递。进程内事件的机制细节见 [Spring 事件](../../spring/07-async-and-messaging/chapter-01-event.md)。

## 3. CQRS（命令查询职责分离）

将读写操作分离为独立的模型和路径。下面的示例展示两种形态：`OrderQueryService` 是逻辑 CQRS，读写模型分离但共用同一数据库，读模型直接查询写库；`OrderReadModelProjector` 是独立读库的物化投影，写模型发布事件、投影器更新独立宽表、查询端读宽表。二者是不同方案，实际项目二选一或按需组合。

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

// 查询端（读模型）：逻辑 CQRS，读写模型分离但共用同一数据库
@Service
public class OrderQueryService {
    private final JdbcTemplate jdbcTemplate;
    
    // 读模型直接查询写库的表（同一数据库），只为隔离读写职责
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

// 进阶方案：独立读库 + 物化投影（与上面的逻辑 CQRS 是两条不同路径，二选一）
// 下面的代码只是投影处理的局部示意，不是端到端实现。完整的物化投影需要
// 写模型发布事件、投影器监听创建/确认/取消等全部状态变化，并处理幂等与重建。
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

不存储当前状态，而是存储所有状态变更事件，通过重放事件得到当前状态。下面的代码是教学伪代码，省略真实持久化、快照与并发控制，只展示状态演化机制。

```java
// 事件存储（教学伪代码，省略真实持久化与并发控制）
public class EventStore {
    private final List<DomainEvent> events = new ArrayList<>();
    
    // expectedVersion 用于乐观并发控制。下面的内存实现只是示意，
    // 版本校验与追加之间不具备原子性，真实实现需在存储层原子完成校验与提交。
    public void append(String aggregateId, long expectedVersion, List<DomainEvent> newEvents) {
        if (getVersion(aggregateId) != expectedVersion) {
            throw new ConcurrentModificationException("聚合版本冲突");
        }
        events.addAll(newEvents);
        // 持久化到事件存储（如 Kafka、EventStoreDB），并原子提交版本
    }
    
    public List<DomainEvent> getEvents(String aggregateId) {
        return events.stream()
            .filter(e -> e.aggregateId().equals(aggregateId))
            .toList();
    }
    
    private long getVersion(String aggregateId) {
        return events.stream()
            .filter(e -> e.aggregateId().equals(aggregateId))
            .count();
    }
}

// 聚合根：通过重放事件恢复状态（教学伪代码）
public class OrderAggregate {
    private String id;
    private OrderStatus status;
    private BigDecimal amount;
    private List<DomainEvent> uncommittedEvents = new ArrayList<>();
    
    // 从事件流重建聚合，只应用事件不记录未提交
    public static OrderAggregate fromEvents(List<DomainEvent> events) {
        OrderAggregate order = new OrderAggregate();
        events.forEach(order::apply);
        return order;
    }
    
    // 命令方法：产生新事件并更新状态
    public void create(String userId, BigDecimal amount) {
        raise(new OrderCreatedEvent(generateId(), userId, amount, LocalDateTime.now()));
    }
    
    public void confirm() {
        if (status != OrderStatus.CREATED) {
            throw new IllegalStateException("只有已创建的订单才能确认");
        }
        raise(new OrderConfirmedEvent(id, LocalDateTime.now()));
    }
    
    // 产生新事件：更新状态并记入未提交列表
    private void raise(DomainEvent event) {
        apply(event);
        uncommittedEvents.add(event);
    }
    
    // 应用事件：只更新状态，不修改未提交列表
    private void apply(DomainEvent event) {
        when(event);
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
| 需要从事件重建状态或查询历史状态 | 事件溯源 | 按事件重放得到任意历史状态 |
| 实时数据流 | 事件流处理 | Kafka Streams / Flink |

选型边界：

- 同步请求适合必须立即获得结果、需要明确失败反馈的操作。
- 异步事件适合允许延迟完成、需要独立消费或降低直接依赖的工作流。
- 事件溯源适合状态历史本身有业务价值、需要按事件重建状态的场景。普通审计日志、CDC、领域事件与事件溯源解决的问题不同，不应仅因审计要求就默认采用事件溯源。
- 关键业务链路要评估消息可靠投递、消费者幂等、顺序要求、积压恢复与端到端可观测性。

> **核心原则**：事件驱动不是万能药。对于简单的 CRUD 应用，传统的请求-响应模型更简单直接。只有当业务确实需要解耦、异步处理或基于事件重建状态时，才值得引入事件驱动的复杂度。

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
| 可用性耦合 | 缺少有效降级或超时控制时，下游故障可能传导到上游 |
| 扩展受限 | 每次请求都依赖下游容量，瓶颈服务可能限制整条链路的吞吐量 |

事件驱动把「同步调用」改成「异步订阅」：上游发布事件后即可返回（发布端可能仍需等待代理确认），下游按自己的节奏消费。这减少了调用方对下游即时响应的依赖，但也引入了最终一致性、消息可靠投递和消费失败恢复等问题，是否采用需要结合业务对响应时间、一致性和可靠性的要求权衡（详见 [Kafka](../../kafka/01-intro/chapter-01-what-is-kafka) 与消息可靠性相关章节）。

## 7. 命令 vs 事件

| 维度 | 命令（Command） | 事件（Event） |
| :-- | :-- | :-- |
| 语义 | 请求做某件事（意图） | 陈述已发生的事实 |
| 时态 | 未来 | 过去 |
| 命名 | 动词，如 `CreateOrder` | 过去分词，如 `OrderCreated` |
| 可否拒绝 | 可以拒绝、可以失败 | 语义上不可拒绝，事实已发生，但事件处理可能失败 |
| 消费方 | 单一目标 | 常见为多个订阅者，点对点消息也可表达事实 |

命名上的区别最容易混淆：`CreateOrderCommand` 是「请创建一个订单」，可能被拒；`OrderCreatedEvent` 是「订单已创建」，已成事实。把两者混用，会导致订阅者对「这是请求还是事实」产生歧义。

表中的区别是语义约定，不是所有消息系统的强制约束。点对点队列同样可以传递已发生的事实，是否可拒绝、消费方数量取决于具体设计，而非「命令」或「事件」的命名。
