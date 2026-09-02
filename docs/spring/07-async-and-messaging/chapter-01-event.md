# 事件机制

> Spring 内置了一套基于 `ApplicationEvent` 的发布-订阅模型，是解耦业务逻辑最轻量的方式。当用户注册后要发邮件、初始化积分、写日志，全塞在 Service 里又长又难测——Spring 事件让你把"注册"和"注册后要做的事"彻底分开。

## 1. 自定义事件与监听

### 1.1 基础用法

```java
// 1. 定义事件
public class UserRegisteredEvent extends ApplicationEvent {
    private final String username;
    private final String email;

    public UserRegisteredEvent(Object source, String username, String email) {
        super(source);
        this.username = username;
        this.email = email;
    }

    public String getUsername() { return username; }
    public String getEmail() { return email; }
}

// 2. 发布事件
@Service
public class UserService {
    private final ApplicationEventPublisher publisher;

    public UserService(ApplicationEventPublisher publisher) {
        this.publisher = publisher;
    }

    @Transactional
    public void register(String username, String email) {
        // 保存用户到数据库...
        publisher.publishEvent(new UserRegisteredEvent(this, username, email));
    }
}

// 3. 监听事件
@Component
public class UserEventListener {

    @EventListener
    public void sendWelcomeEmail(UserRegisteredEvent event) {
        System.out.println("发送欢迎邮件给: " + event.getEmail());
    }

    @EventListener
    public void initBonusPoints(UserRegisteredEvent event) {
        System.out.println("为用户 " + event.getUsername() + " 初始化积分");
    }
}
```

**同步 vs 异步事件**：默认情况下 `@EventListener` 是同步执行的，监听器在发布者线程中运行。要异步执行，加 `@Async`：

```java
@Component
public class UserEventListener {

    @Async
    @EventListener
    public void sendWelcomeEmail(UserRegisteredEvent event) {
        // 会在独立线程池中执行，不阻塞发布者
    }
}
```

> **踩坑提醒**：异步事件监听器抛出异常不会传播回调用方。如果需要感知异常，要自行处理或使用 `CompletableFuture`。

| 特性 | 同步事件 | 异步事件（@Async） |
|------|---------|-------------------|
| 执行线程 | 发布者线程 | 线程池线程 |
| 异常传播 | 会抛给调用方 | 静默吞掉（需配置 Handler） |
| 事务参与 | 同一事务 | 不在同一事务 |
| 适用场景 | 需要事务一致性的轻量操作 | 耗时操作（发邮件、推送） |

### 1.2 事件继承与泛型监听

```java
// 事件基类
@Getter
public abstract class DomainEvent extends ApplicationEvent {
    private final LocalDateTime occurredAt;
    private final String eventId;

    public DomainEvent(Object source) {
        super(source);
        this.occurredAt = LocalDateTime.now();
        this.eventId = UUID.randomUUID().toString();
    }
}

// 具体事件
@Getter
public class OrderCreatedEvent extends DomainEvent {
    private final Long orderId;
    private final Long userId;
    private final BigDecimal amount;

    public OrderCreatedEvent(Object source, Long orderId, Long userId, BigDecimal amount) {
        super(source);
        this.orderId = orderId;
        this.userId = userId;
        this.amount = amount;
    }
}

@Getter
public class OrderCancelledEvent extends DomainEvent {
    private final Long orderId;
    private final String reason;

    public OrderCancelledEvent(Object source, Long orderId, String reason) {
        super(source);
        this.orderId = orderId;
        this.reason = reason;
    }
}
```

## 2. 条件监听与事件排序

```java
@Component
@Slf4j
public class OrderEventListener {

    // 条件监听：只处理大额订单
    @EventListener(condition = "#event.amount > 10000")
    public void onLargeOrder(OrderCreatedEvent event) {
        log.info("大额订单告警: orderId={}, amount={}", event.getOrderId(), event.getAmount());
    }

    // 事件排序：先记录日志，再发送通知
    @EventListener
    @Order(1)
    public void auditLog(OrderCreatedEvent event) {
        log.info("订单创建审计: {}", event);
    }

    @EventListener
    @Order(2)
    public void sendNotification(OrderCreatedEvent event) {
        // 发送订单创建通知
    }

    // 异步监听（需要 @EnableAsync）
    @Async
    @EventListener
    public void sendEmailAsync(OrderCreatedEvent event) {
        // 异步发送邮件，不影响主流程
        emailService.sendOrderConfirmation(event.getUserId(), event.getOrderId());
    }
}
```

## 3. 事件的事务边界

**痛点**：事件发布在事务内，但监听器想在事务提交后再执行（比如发邮件），结果事务回滚了邮件却已经发出去了。

`@TransactionalEventListener` 让你精确控制事件监听器在哪个事务阶段执行：

```java
@Component
public class TransactionalEventListeners {

    // 事务提交后执行：保证事件只在事务成功时触发
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void afterCommit(OrderCreatedEvent event) {
        // 事务已提交，安全地发送消息到 MQ
        kafkaTemplate.send("order-created", event.getOrderId().toString(), event);
    }

    // 事务提交前执行（适合注册到事务性资源）
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    public void beforeCommit(OrderCreatedEvent event) {
        // 事务提交前的准备工作
    }

    // 事务回滚后执行（适合补偿操作）
    @TransactionalEventListener(phase = TransactionPhase.AFTER_ROLLBACK)
    public void afterRollback(OrderCreatedEvent event) {
        log.warn("订单创建事务回滚: orderId={}", event.getOrderId());
    }

    // 事务完成后执行（无论提交还是回滚）
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMPLETION)
    public void afterCompletion(OrderCreatedEvent event) {
        // 清理资源
    }
}
```

| TransactionPhase | 触发时机 | 典型场景 |
|------------------|---------|---------|
| `BEFORE_COMMIT` | 事务提交前 | 注册到事务性资源 |
| `AFTER_COMMIT` | 事务提交后（默认） | 发邮件、推送通知 |
| `AFTER_ROLLBACK` | 事务回滚后 | 补偿操作、清理资源 |
| `AFTER_COMPLETION` | 无论提交/回滚 | 通用清理 |

> **踩坑提醒**：如果用 `@TransactionalEventListener` 但发布事件的方法没有 `@Transactional`，监听器默认会立即执行（等同于无事务）。确保事件发布在事务上下文中。

## 4. 事件 vs 消息队列选型

什么时候用 Spring Event，什么时候该上消息队列？核心区别在于**边界**。

```
┌─────────────────────────────────────────────────────┐
│                   进程内 (JVM)                       │
│                                                     │
│  Service A ──publish──► Spring Event ──► Listener   │
│                                                     │
│  ✅ 快速  ✅ 简单  ❌ 无持久化  ❌ 无法跨进程       │
└─────────────────────────────────────────────────────┘

┌──────────────┐    ┌──────────┐    ┌──────────────┐
│  Service A   │───►│  MQ      │───►│  Service B   │
│  (Producer)  │    │ (持久化)  │    │  (Consumer)  │
└──────────────┘    └──────────┘    └──────────────┘
  ✅ 跨进程  ✅ 持久化  ✅ 削峰填谷  ❌ 复杂度高
```

| 维度 | Spring Event | 消息队列（Kafka/RabbitMQ） |
|------|-------------|--------------------------|
| 边界 | 进程内 | 跨进程、跨服务 |
| 持久化 | 无 | 有（可配置） |
| 可靠性 | JVM 存活就可靠 | 支持确认机制 |
| 延迟 | 微秒级 | 毫秒~秒级 |
| 复杂度 | 极低 | 中高（需运维 MQ） |
| 典型场景 | 解耦模块、审计日志、缓存刷新 | 异步通信、削峰填谷、最终一致性 |

> **经验法则**：如果发完事件后"做不做都行"（best-effort），用 Spring Event。如果"必须做到"（at-least-once），用消息队列。

## 5. 非 Spring 事件：Guava EventBus 对比

```java
// Guava EventBus（轻量级，不依赖 Spring 容器）
EventBus eventBus = new AsyncEventBus(Executors.newFixedThreadPool(4));

// 注册监听器
eventBus.register(new Object() {
    @Subscribe
    public void onOrderCreated(OrderCreatedEvent event) {
        System.out.println("收到事件: " + event);
    }
});

// 发布事件
eventBus.post(new OrderCreatedEvent(this, 1L, 10086L, BigDecimal.valueOf(99.9)));
```

| 特性 | Spring Event | Guava EventBus |
|------|-------------|----------------|
| 事务感知 | ✅ @TransactionalEventListener | ❌ |
| 异步支持 | ✅ @Async | ✅ AsyncEventBus |
| 条件过滤 | ✅ SpEL condition | ❌ |
| 排序 | ✅ @Order | ❌ |
| 错误处理 | 全局 ApplicationEventMulticaster | ErrorHandler |
| 适用场景 | Spring 应用内事件 | 非 Spring 环境、简单解耦 |

## 6. 最佳实践

1. **事件类用不可变对象**——所有字段 `final`，只有 getter
2. **事务事件用 `AFTER_COMMIT`**——避免事务回滚后发送了不该发的消息
3. **耗时操作用 `@Async`**——邮件、推送等不要阻塞主流程
4. **事件不要传递大数据**——只传 ID，监听器按需查询
5. **事件命名用过去式**——`OrderCreatedEvent`、`UserRegisteredEvent`
