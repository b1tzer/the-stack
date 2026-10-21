---
doc_id: dp-观察者模式
title: 观察者模式（Observer Pattern）
---

# 观察者模式（Observer Pattern）

> **一句话记忆口诀**：观察者一对多通知，发布-订阅解耦，Spring `ApplicationEvent` 和 JDK `Observable` 是最熟悉的例子。

## 1. 引入：它解决了什么问题？

### 1.1 没有观察者模式时的问题

当一个对象状态变化需要通知多个其他对象时，直接调用会导致强耦合：

```java
// ❌ 反例：订单状态变化时，直接调用所有依赖方
public class OrderService {
    private EmailService emailService;
    private SMSService smsService;
    private InventoryService inventoryService;
    private PointsService pointsService;
    private LogService logService;

    public void completeOrder(Order order) {
        order.setStatus(OrderStatus.COMPLETED);
        orderRepository.save(order);

        // 直接调用所有依赖方——强耦合！
        emailService.sendConfirmationEmail(order);    // 发邮件
        smsService.sendSMS(order.getUserPhone(), "订单完成"); // 发短信
        inventoryService.deductStock(order);          // 扣库存
        pointsService.addPoints(order.getUserId(), order.getAmount()); // 加积分
        logService.logOrderComplete(order);           // 记录日志

        // 新增一个通知方式？必须修改 OrderService！
        // 如果某个服务抛异常，后续通知都不会执行！
    }
}
```

**问题根因**：

1. `OrderService` 与所有通知方强耦合，新增通知方必须修改核心业务代码
2. 通知逻辑与业务逻辑混在一起，违反单一职责原则
3. 当前实现按顺序调用通知方，某个调用抛出未处理异常时，后续通知会中断

### 1.2 工作中的典型应用场景

| 场景 | Spring/JDK 中的例子 |
| :-- | :-- |
| Spring 事件机制 | `ApplicationEvent` + `@EventListener` |
| GUI 事件处理 | `ActionListener`、`MouseListener` |
| 消息队列 | Kafka/RabbitMQ 的发布-订阅 |
| 数据库变更通知 | MySQL Binlog 监听 |
| 配置中心 | Nacos/Apollo 配置变更推送 |

## 2. 类比：用生活模型建立直觉

### 2.1 生活类比：微信公众号订阅

一个公众号（被观察者/Subject）发布文章时，所有订阅了该公众号的用户（观察者/Observer）都会收到推送通知。用户可以随时订阅或取消订阅，公众号不需要知道具体有哪些用户。

- **接口/抽象角色**：
  - 公众号接口（`Subject`）：定义订阅、取消订阅、通知方法
  - 用户接口（`Observer`）：定义接收通知的方法
- **具体实现角色**：
  - 具体公众号（`TechBlog`）：维护订阅者列表，发布文章时通知所有人
  - 具体用户（`UserA`、`UserB`）：实现接收通知的逻辑
- **调用方**：公众号运营者（`Client`），触发文章发布

### 2.2 抽象定义

> 观察者模式定义对象间的一种一对多的依赖关系，当一个对象的状态发生改变时，所有依赖于它的对象都得到通知并被自动更新。

## 3. 原理：逐步拆解核心机制

### 3.1 UML 类图

```mermaid
classDiagram
    class Subject {
        <<interface>>
        +addObserver(Observer) void
        +removeObserver(Observer) void
        +notifyObservers(event) void
    }
    class Observer {
        <<interface>>
        +update(event) void
    }
    class OrderEventPublisher {
        -observers List~Observer~
        +addObserver(Observer) void
        +removeObserver(Observer) void
        +notifyObservers(event) void
        +completeOrder(Order) void
    }
    class EmailNotifier {
        +update(event) void
    }
    class SMSNotifier {
        +update(event) void
    }
    class InventoryUpdater {
        +update(event) void
    }

    Subject <|.. OrderEventPublisher
    Observer <|.. EmailNotifier
    Observer <|.. SMSNotifier
    Observer <|.. InventoryUpdater
    OrderEventPublisher --> Observer : notifies
    note for OrderEventPublisher "Subject 维护观察者列表<br/>状态变化时逐一通知"
```

### 3.2 Java 代码示例（手动实现）

```java
// ===== 事件对象（携带通知数据）=====
public class OrderCompletedEvent {
    private final Order order;
    private final LocalDateTime occurredAt;

    public OrderCompletedEvent(Order order) {
        this.order = order;
        this.occurredAt = LocalDateTime.now();
    }
    // getters...
}

// ===== 观察者接口 =====
public interface OrderObserver {
    void onOrderCompleted(OrderCompletedEvent event);
}

// ===== 被观察者接口 =====
public interface OrderSubject {
    void addObserver(OrderObserver observer);
    void removeObserver(OrderObserver observer);
    void notifyObservers(OrderCompletedEvent event);
}

// ===== 具体被观察者（Subject）=====
public class OrderService implements OrderSubject {
    // 使用 CopyOnWriteArrayList 保证线程安全（观察者列表可能被并发修改）
    private final List<OrderObserver> observers = new CopyOnWriteArrayList<>();

    @Override
    public void addObserver(OrderObserver observer) {
        observers.add(observer);
    }

    @Override
    public void removeObserver(OrderObserver observer) {
        observers.remove(observer);
    }

    @Override
    public void notifyObservers(OrderCompletedEvent event) {
        // 逐一通知所有观察者
        for (OrderObserver observer : observers) {
            try {
                observer.onOrderCompleted(event);
            } catch (Exception e) {
                // 某个观察者失败不影响其他观察者
                log.error("观察者通知失败: {}", observer.getClass().getSimpleName(), e);
            }
        }
    }

    public void completeOrder(Order order) {
        order.setStatus(OrderStatus.COMPLETED);
        orderRepository.save(order);
        // 只发布事件，不关心谁来处理
        notifyObservers(new OrderCompletedEvent(order));
    }
}

// ===== 具体观察者 =====
public class EmailNotifier implements OrderObserver {
    @Override
    public void onOrderCompleted(OrderCompletedEvent event) {
        System.out.println("发送确认邮件给: " + event.getOrder().getUserEmail());
    }
}

public class InventoryUpdater implements OrderObserver {
    @Override
    public void onOrderCompleted(OrderCompletedEvent event) {
        System.out.println("扣减库存: " + event.getOrder().getItems());
    }
}

// ===== 使用示例 =====
public class Main {
    public static void main(String[] args) {
        OrderService orderService = new OrderService();

        // 注册观察者（新增通知方式只需注册，不修改 OrderService）
        orderService.addObserver(new EmailNotifier());
        orderService.addObserver(new InventoryUpdater());
        orderService.addObserver(event ->
                System.out.println("积分服务: 添加积分 " + event.getOrder().getAmount()));

        orderService.completeOrder(new Order(1L));
    }
}
```

> **实现说明**：`CopyOnWriteArrayList` 适合读多写少、遍历频繁的观察者集合，通知遍历基于数组快照，取消订阅不会中止已开始的通知；高频注册或取消订阅时，每次写都会复制整个数组，成本较高。示例选择「单个观察者失败后继续通知其他观察者」这一策略，`log.error` 只做记录，不等于失败恢复——若通知承担关键业务责任，还需定义失败传播、重试与幂等策略。此外，`OrderCompletedEvent` 的 `final` 字段只保证引用不变，不保证 `Order` 内容不再变化，需要稳定事件快照时应传递订单 ID、必要字段或不可变 DTO。

### 3.3 Spring 事件机制（工作中最常用）

```java
// ===== Spring 事件对象 =====
public class OrderCompletedEvent extends ApplicationEvent {
    private final Order order;

    public OrderCompletedEvent(Object source, Order order) {
        super(source);
        this.order = order;
    }
    public Order getOrder() { return order; }
}

// ===== 事件发布者（被观察者）=====
@Service
public class OrderService {
    @Autowired
    private ApplicationEventPublisher eventPublisher; // Spring 内置发布者

    @Transactional
    public void completeOrder(Order order) {
        order.setStatus(OrderStatus.COMPLETED);
        orderRepository.save(order);
        // 发布事件，不关心谁来处理
        eventPublisher.publishEvent(new OrderCompletedEvent(this, order));
    }
}

// ===== 事件监听者（观察者）=====
@Component
public class EmailNotifier {
    // @EventListener 自动注册为观察者
    @EventListener
    public void onOrderCompleted(OrderCompletedEvent event) {
        emailService.sendConfirmation(event.getOrder());
    }
}

@Component
public class InventoryUpdater {
    @EventListener
    @Async // 交给异步执行器处理，通常不等待其执行完成；任务提交失败与异步异常需单独处理
    public void onOrderCompleted(OrderCompletedEvent event) {
        inventoryService.deduct(event.getOrder());
    }
}
```

### 3.4 核心流程图

```mermaid
flowchart TD
    A[业务逻辑触发状态变化] --> B[Subject 发布事件]
    B --> C[遍历观察者列表]
    C --> D[Observer1.update]
    C --> E[Observer2.update]
    C --> F[Observer3.update]
    D --> G[各自处理，互不影响]
    E --> G
    F --> G

    style B fill:#ff9,stroke:#333
    note1["Subject 不关心观察者的具体实现<br/>观察者之间也互不依赖"]
```

## 4. 特性：关键对比

### 4.1 观察者模式 vs 发布-订阅模式

| 对比维度 | 观察者模式 | 发布-订阅模式 |
| :-- | :-- | :-- |
| **依赖关系** | Subject 直接持有 Observer 引用，有一定耦合 | 通过事件通道/中间件路由，发布者与订阅者互不感知 |
| **执行时机** | 默认同步，也可异步调度 | 通常异步，取决于中间件实现 |
| **中间层** | 无 | 有（消息中间件/事件总线） |
| **典型例子** | JDK `Observable`、Spring `ApplicationEvent` | Kafka、RabbitMQ |

> 上表是入门级的简化区分。同步/异步、进程内/跨进程取决于具体实现，并非两种模式的固有属性：观察者同样可以异步调度，发布-订阅也不必然依赖消息中间件。Spring `ApplicationEvent` 是观察者模式的典型代表（进程内），Kafka 是发布-订阅的典型代表（跨进程），但两者在进程边界、持久化、投递语义与故障恢复上的差异，不能仅凭同步或异步来定义。

### 4.2 在 Spring / JDK 中的应用

| 框架/类 | 说明 |
| :-- | :-- |
| Spring `ApplicationEvent` | Spring 内置事件机制，`@EventListener` 注册观察者 |
| JDK `java.util.Observable` | JDK 内置观察者（已废弃，JDK 9+） |
| Guava `EventBus` | 基于注解的事件总线 |
| RxJava `Observable` | 响应式编程的观察者 |
| Kafka Consumer | 消息消费者是观察者 |

## 5. 边界：异常情况与常见误区

### 5.1 误区一：观察者抛异常导致后续观察者不执行（运行期问题）

```java
// ❌ 错误：没有异常处理，一个观察者失败导致后续都不执行
public void notifyObservers(OrderCompletedEvent event) {
    for (OrderObserver observer : observers) {
        observer.onOrderCompleted(event); // 如果这里抛异常，后续观察者不执行！
    }
}

// ✅ 正确：捕获每个观察者的异常，保证其他观察者正常执行
public void notifyObservers(OrderCompletedEvent event) {
    for (OrderObserver observer : observers) {
        try {
            observer.onOrderCompleted(event);
        } catch (Exception e) {
            log.error("观察者 {} 处理失败", observer.getClass().getSimpleName(), e);
            // 继续通知下一个观察者
        }
    }
}
```

### 5.2 误区二：Spring @EventListener 默认同步执行，影响主流程性能（运行期问题）

```java
// ❌ 问题：@EventListener 默认同步执行，耗时操作会阻塞主流程
@EventListener
public void onOrderCompleted(OrderCompletedEvent event) {
    // 发送邮件可能需要 2 秒，会阻塞订单完成的主流程！
    emailService.sendEmail(event.getOrder().getUserEmail());
}

// ✅ 正确：对耗时操作使用 @Async 异步处理
@EventListener
@Async("emailExecutor") // 指定线程池，避免使用默认线程池
public void onOrderCompleted(OrderCompletedEvent event) {
    emailService.sendEmail(event.getOrder().getUserEmail());
}

// 注意：@Async 需要在配置类上加 @EnableAsync
```

### 5.3 误区三：在事务方法内发布事件，忽略事务提交边界（数据一致性问题）

```java
// ❌ 问题：在 @Transactional 内发布事件，默认同步监听器在事务提交前执行
@Transactional
public void completeOrder(Order order) {
    order.setStatus(OrderStatus.COMPLETED);
    orderRepository.save(order);
    eventPublisher.publishEvent(new OrderCompletedEvent(this, order));
    // 监听器此时可能已经执行，但事务尚未提交；
    // 若事务随后回滚，监听器产生的外部副作用（邮件、短信）不会随之回滚。
}
```

Spring 的普通事件发布不会自动等待事务提交。默认同步监听器在 `publishEvent()` 调用过程中执行，可能在事务提交前访问数据库或触发外部操作；`@Async` 引入线程切换后，监听任务可能在原事务提交前开始，也可能在回滚后继续执行。对订单、库存、通知这类业务，这不再是性能问题，而是数据一致性边界。

```java
// ✅ 正确：需要「事务提交后」再执行的副作用，用 @TransactionalEventListener
@Component
public class EmailNotifier {
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onOrderCompleted(OrderCompletedEvent event) {
        emailService.sendConfirmation(event.getOrder());
    }
}
```

`@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)` 在关联事务成功提交后执行监听器，适合提交后的非关键副作用。它默认要求发布事件时存在可关联的事务：没有事务时，监听器默认不执行，除非启用 `fallbackExecution`。`AFTER_COMMIT` 只约束执行阶段，不提供进程崩溃后的事件恢复或可靠投递保证。若监听器在提交后还要执行新的数据库写操作，应使用独立事务（如 `@Transactional(propagation = Propagation.REQUIRES_NEW)`）并确认调用经过 Spring 代理。需要跨进程可靠投递时，应进一步考虑事务 Outbox、消息投递重试与幂等消费，而不是仅添加 `@Async`。

### 5.4 误区四：观察者修改业务状态触发再次通知，形成事件反馈循环（设计问题）

这里要先澄清概念：持有 Subject 引用本身不构成「循环依赖」。循环依赖通常指依赖注入层面 A 与 B 互相注入导致无法实例化；而这里的问题是「事件反馈循环」——观察者在处理事件时修改业务状态并再次发布事件，若缺少状态转换条件或幂等处理，可能无限递归。

```java
// ❌ 错误：观察者处理事件时反向修改业务状态并再次发布事件，可能形成事件反馈循环
public class InventoryObserver implements OrderObserver {
    private final OrderService orderService; // 持有 Subject 引用本身不是错误

    @Override
    public void onOrderCompleted(OrderCompletedEvent event) {
        // 修改订单状态并再次发布事件，若未做状态判断/幂等，可能递归触发，形成无限循环
        orderService.updateOrderStatus(event.getOrder(), OrderStatus.SHIPPED);
        orderService.publishEvent(new OrderShippedEvent(event.getOrder()));
    }
}

// ✅ 正确：观察者可以调用领域服务完成后续业务，但需通过状态判断/幂等避免重复触发
public class InventoryObserver implements OrderObserver {
    @Override
    public void onOrderCompleted(OrderCompletedEvent event) {
        // 只做库存扣减，不反向修改订单状态、不重复发布同一事件
        inventoryService.deduct(event.getOrder());
    }
}
```

避免无限循环的关键不是「禁止持有 Subject 引用」，而是明确事件语义、限定状态转换条件、做幂等处理或限制重复发布。

## 6. 总结：面试标准化表达

### 6.1 高频问题

**Q1：观察者模式解决了什么问题？Spring 如何实现？**

> 观察者模式解决了对象间一对多依赖的耦合问题。当一个对象状态变化需要通知多个对象时，直接调用会导致强耦合，新增通知方必须修改核心业务代码。观察者模式通过接口解耦：Subject 只知道 Observer 接口，不知道具体实现；新增观察者只需注册，不修改 Subject。Spring 通过 `ApplicationEvent` + `@EventListener` 实现，`ApplicationEventPublisher.publishEvent()` 发布事件，`@EventListener` 注解的方法自动成为观察者，加 `@Async` 可实现异步通知。

**Q2：观察者模式和发布-订阅模式有什么区别？**

> 两者核心区别在于耦合关系：观察者模式中 Subject 直接持有 Observer 引用列表，通知时直接调用，两者有直接依赖；发布-订阅模式通过事件通道或消息中间件（如 Kafka、RabbitMQ）路由，发布者与订阅者互不知道对方存在。同步/异步、进程内/跨进程取决于具体实现，并非两种模式的固有属性——观察者同样可以异步调度。Spring 的 `ApplicationEvent` 是观察者模式的典型代表（进程内），Kafka 是发布-订阅的典型代表（跨进程），但应关注它们在进程边界、持久化、投递语义上的差异，而非仅凭同步或异步定义模式。

**Q3：使用观察者模式有哪些注意事项？**

> 主要注意点：①异常隔离——每个观察者的异常应被捕获，避免一个观察者失败影响其他观察者，但「继续通知」是一种策略选择，日志记录不等于失败恢复，关键业务还需定义失败传播、重试与幂等；②异步处理——耗时的观察者逻辑应异步执行（Spring `@Async`），避免阻塞主流程；③事务边界——在事务方法内发布事件时，默认同步监听器可能在事务提交前执行，需要「提交后执行」时用 `@TransactionalEventListener(phase = AFTER_COMMIT)`，跨进程可靠投递还需 Outbox 与重试；④避免事件反馈循环——观察者不应无节制地反向修改业务状态并重复发布事件。另外，观察者列表可用线程安全的集合（如 `CopyOnWriteArrayList`），但它适合读多写少、遍历频繁的场景，且遍历基于快照，不保证取消订阅能中止已开始的通知。
