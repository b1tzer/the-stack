# Spring 事务管理

> **核心问题：** Spring 是如何让「手动管理事务」这件繁琐的事变成一个注解就能搞定的？事务传播机制在嵌套调用时到底怎么运作？为什么你明明加了 `@Transactional`，数据还是"飞"了？编程式事务在什么场景下比声明式更合适？

## 1. @Transactional 原理

### 1.1 一个注解背后的完整链条

当你在 Service 方法上写下 `@Transactional`，你省略掉的是以下这段"样板代码"：

```java
// 没有 Spring 之前，你得这么写
Connection conn = null;
try {
    conn = dataSource.getConnection();
    conn.setAutoCommit(false);

    // 业务逻辑：扣库存、创建订单、写日志……
    orderDao.insert(order);
    inventoryDao.decrease(sku, quantity);

    conn.commit();
} catch (Exception e) {
    if (conn != null) conn.rollback();
    throw e;
} finally {
    if (conn != null) conn.setAutoCommit(true);
    if (conn != null) conn.close();
}
```

加上 `@Transactional` 之后：

```java
@Transactional
public void createOrder(Order order, String sku, int quantity) {
    orderDao.insert(order);
    inventoryDao.decrease(sku, quantity);
    // 事务的开启、提交、回滚全部由框架代理完成
}
```

Spring 并没有"消灭"事务管理，而是把它搬到了方法的外面——**AOP 代理层**。

### 1.2 调用链路：从注解到数据库

整个过程可以用以下流程来描述：

![tx-propagation](/java/tx-propagation.svg)

**关键点：** `@Transactional` 生效的前提是方法调用必须经过代理对象。理解这一点，后面 6.3 节的"失效场景"就全部有迹可循了。

### 1.3 注解的常用属性

```java
@Transactional(
    propagation = Propagation.REQUIRED,   // 传播机制（下一节详述）
    isolation = Isolation.DEFAULT,        // 隔离级别，沿用数据库默认
    timeout = 30,                         // 超时秒数，超时自动回滚
    readOnly = false,                     // 是否只读（优化提示）
    rollbackFor = Exception.class,        // 哪些异常触发回滚
    noRollbackFor = BusinessException.class // 哪些异常不回滚
)
```

> **经验法则：** 大多数情况下只需要关注 `rollbackFor` 和 `propagation`，其余参数保持默认即可。真正需要调隔离级别的场景极少——多数时候数据库本身的隔离级别已经够用。

## 2. 事务传播机制

### 2.1 什么是"传播"？

当方法 A 有 `@Transactional`，它调用的方法 B 也有 `@Transactional`，那么 B 是加入 A 的事务，还是自己开一个新事务？这就是**事务传播（Propagation）**要回答的问题。

传播机制解决的核心矛盾是：**不同业务方法对事务边界有不同需求，但它们可能互相调用。**

### 2.2 七种传播行为一览

Spring 定义了 7 种传播行为，但实际工作中最常用的只有 3 种：

| 传播行为 | 含义 | 有事务时 | 无事务时 | 典型场景 |
|---------|------|---------|---------|---------|
| **REQUIRED** | 默认值，必须在事务中运行 | 加入当前事务 | 新建事务 | 绝大多数业务方法 |
| **REQUIRES_NEW** | 必须在独立的新事务中运行 | 挂起当前，新建事务 | 新建事务 | 日志记录、审计，不能因主业务回滚而丢失 |
| **NESTED** | 在嵌套事务中运行 | 创建保存点，嵌套事务 | 新建事务 | 子操作可独立回滚，不影响外层 |
| SUPPORTS | 有就加入，没有就算 | 加入当前事务 | 非事务执行 | 查询方法 |
| NOT_SUPPORTED | 不需要事务 | 挂起当前事务 | 非事务执行 | 非关键的异步操作 |
| MANDATORY | 必须在已有事务中调用 | 加入当前事务 | 抛异常 | 强制约束：此方法不允许独立调用 |
| NEVER | 绝对不能在事务中调用 | 抛异常 | 非事务执行 | 某些第三方接口，不支持事务 |

### 2.3 REQUIRED vs REQUIRES_NEW：一个经典面试场景

```java
@Service
public class OrderService {

    @Autowired
    private AuditLogService auditLogService;

    @Transactional  // REQUIRED（默认）
    public void createOrder(Order order) {
        orderDao.insert(order);
        // 写审计日志，即使订单创建失败，日志也要保留
        auditLogService.log("订单创建: " + order.getId());
        // 如果此处抛异常，整个事务回滚
        // 在 REQUIRES_NEW 下，日志不会被回滚
    }
}

@Service
public class AuditLogService {

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void log(String message) {
        auditLogDao.insert(new AuditLog(message));
        // 独立事务：即使外层回滚，这条日志仍然持久化
    }
}
```

执行流程：

```text
OrderService.createOrder()  ← 开启事务 T1
    │
    ├─ orderDao.insert()    ← 在 T1 中执行
    │
    ├─ auditLogService.log()
    │       │
    │       ▼
    │   挂起 T1
    │   开启新事务 T2
    │   auditLogDao.insert()  ← 在 T2 中执行
    │   T2.commit()
    │   恢复 T1
    │
    ├─ (假设此处抛异常)
    │
    T1.rollback()  ← 订单回滚，但审计日志（T2）不受影响
```

### 2.4 NESTED：保存点机制

`NESTED` 与 `REQUIRES_NEW` 的关键区别：

| 维度 | REQUIRES_NEW | NESTED |
|------|-------------|--------|
| 事务关系 | 完全独立的事务 | 嵌套在外层事务中 |
| 外层回滚时 | 内层已提交，不受影响 | 内层一起回滚 |
| 内层回滚时 | 仅内层回滚 | 仅回滚到保存点，外层可继续 |
| 底层机制 | 真正的新物理事务 | JDBC Savepoint |

```java
@Transactional
public void batchProcess(List<Item> items) {
    for (Item item : items) {
        try {
            processItem(item);  // NESTED：单个失败不影响整体
        } catch (Exception e) {
            log.warn("处理失败，跳过: " + item.getId());
        }
    }
}

@Transactional(propagation = Propagation.NESTED)
public void processItem(Item item) {
    // 单个 item 处理失败时，回滚到保存点
    // 不影响 batchProcess 中其他 item 的处理
    itemDao.update(item);
}
```

> **注意：** `NESTED` 依赖 JDBC Savepoint，不是所有驱动都支持。MySQL InnoDB 支持良好。

## 3. 事务失效的五大场景

这是面试和实际开发中的高频问题。每一种失效都有其技术根因，理解代理机制后就能举一反三。

### 3.1 场景总览

| # | 场景 | 根因 | 解决方案 |
|---|------|------|---------|
| 1 | 同类方法调用 | `this.method()` 绕过代理 | 注入自身代理 / 拆分到不同 Bean |
| 2 | 非 public 方法 | CGLIB/JDK 代理无法拦截 private/protected | 改为 public |
| 3 | 异常被吞掉 | catch 了异常但未 rethrow | `rollbackFor=Exception.class` / 重新抛出 |
| 4 | 数据库引擎不支持 | MyISAM 不支持事务 | 使用 InnoDB |
| 5 | 多线程调用 | 事务绑定在 ThreadLocal，新线程拿不到 | 分布式事务 / 异步回调方案 |

### 3.2 场景一：同类方法调用（最常见）

```java
@Service
public class UserService {

    public void register(User user) {
        saveUser(user);          // 直接调用，走 this，不经过代理
        sendWelcomeEmail(user);  // @Transactional 不生效！
    }

    @Transactional
    public void sendWelcomeEmail(User user) {
        emailDao.insert(new Email(user.getEmail(), "Welcome!"));
        // 如果这里抛异常，事务不会回滚
        // 因为根本没进入代理
    }
}
```

**为什么？** `register()` 内部调用 `sendWelcomeEmail()` 时，等价于 `this.sendWelcomeEmail()`。`this` 是原始对象，不是代理对象。AOP 代理根本没有机会拦截这次调用。

**解决方案一：注入自身代理**

```java
@Service
public class UserService {

    @Autowired
    @Lazy  // 避免循环依赖
    private UserService self;  // 注入的是代理对象

    public void register(User user) {
        saveUser(user);
        self.sendWelcomeEmail(user);  // 通过代理调用，事务生效
    }

    @Transactional
    public void sendWelcomeEmail(User user) { ... }
}
```

**解决方案二：从 AopContext 获取代理（需开启 exposeProxy）**

```java
@EnableAspectJAutoProxy(exposeProxy = true)  // 启动类或配置类
public class Application { ... }

@Service
public class UserService {

    public void register(User user) {
        saveUser(user);
        ((UserService) AopContext.currentProxy()).sendWelcomeEmail(user);
    }
}
```

**解决方案三（推荐）：拆分到不同类**

```java
@Service
public class UserService {

    @Autowired
    private EmailService emailService;

    public void register(User user) {
        saveUser(user);
        emailService.sendWelcomeEmail(user);  // 不同 Bean，天然经过代理
    }
}

@Service
public class EmailService {

    @Transactional
    public void sendWelcomeEmail(User user) { ... }
}
```

> **设计启示：** 同类调用失效的本质是"自调用"。这其实也在暗示我们——如果一个类的职责多到需要拆事务边界，也许它本身就该拆分了。

### 3.3 场景二：非 public 方法

```java
@Service
public class PaymentService {

    @Transactional
    protected void processPayment(Payment payment) {  // protected，不生效！
        paymentDao.insert(payment);
    }
}
```

Spring 的 AOP 代理（无论是 JDK 动态代理还是 CGLIB）在设计上只能拦截 `public` 方法。`AnnotationTransactionAttributeSource` 在解析事务属性时，会直接跳过非 public 方法。

**解法：** 改为 `public`。不要试图用反射绕过——这违反了框架的设计约定。

### 3.4 场景三：异常被 catch 吞掉

```java
@Service
public class TransferService {

    @Transactional
    public void transfer(Long from, Long to, BigDecimal amount) {
        accountDao.decrease(from, amount);
        try {
            accountDao.increase(to, amount);
        } catch (Exception e) {
            log.error("转账失败", e);
            // 异常被 catch 了！Spring 看不到异常，会正常 commit
            // 结果：钱扣了，但没到账
        }
    }
}
```

**默认回滚规则：** Spring 只对 `RuntimeException` 和 `Error` 触发回滚。`checked exception`（如 `IOException`）默认不回滚。

**解决方案：**

```java
// 方案 A：指定 rollbackFor，让所有异常都回滚
@Transactional(rollbackFor = Exception.class)
public void transfer(...) { ... }

// 方案 B：catch 之后重新抛出
try {
    accountDao.increase(to, amount);
} catch (Exception e) {
    log.error("转账失败", e);
    throw new TransferException("转账失败", e);  // 包装为 RuntimeException
}
```

> **最佳实践：** 永远加上 `rollbackFor = Exception.class`。除非你明确需要在 checked exception 时提交事务（这种场景极少）。

### 3.5 场景四：数据库引擎不支持

MySQL 的 MyISAM 引擎不支持事务。即使 Spring 开启了事务，底层 `commit()` 和 `rollback()` 也是空操作。

```sql
-- 检查表的引擎
SHOW TABLE STATUS WHERE Name = 'order_table';

-- 转换为 InnoDB
ALTER TABLE order_table ENGINE = InnoDB;
```

这不是 Spring 的问题，是存储引擎的限制。在 MySQL 8.0+ 中，默认引擎已经是 InnoDB，但迁移旧项目时仍需注意。

### 3.6 场景五：多线程调用

```java
@Service
public class ReportService {

    @Transactional
    public void generateReport() {
        // 主线程：在事务中
        reportDao.prepareData();

        // 新起一个线程
        new Thread(() -> {
            // 子线程：不在事务中！
            // Spring 的事务通过 ThreadLocal 绑定到当前线程
            // 子线程拿到的是一个全新的、没有事务的数据库连接
            reportDao.generateCharts();
        }).join();

        reportDao.finalize();
    }
}
```

**根因：** Spring 事务的核心存储是 `TransactionSynchronizationManager`，它内部使用 `ThreadLocal` 保存当前线程的数据库连接和事务状态。新线程 = 新 `ThreadLocal` = 空白的事务上下文。

```text
Thread-1 (主线程)                Thread-2 (子线程)
┌─────────────────┐             ┌─────────────────┐
│ ThreadLocal:    │             │ ThreadLocal:    │
│   conn = 0xABC  │             │   conn = null   │
│   tx = active   │             │   tx = none     │
└─────────────────┘             └─────────────────┘
```

**解决方案：** 如果子线程也需要事务，应该通过异步方法（`@Async`）让 Spring 管理其生命周期，或使用编程式事务在子线程中手动开启。对于跨服务的分布式场景，需要引入分布式事务框架（Seata 等），这将在后续章节讨论。

## 4. 编程式事务

### 4.1 声明式 vs 编程式

| 维度 | 声明式（@Transactional） | 编程式（TransactionTemplate） |
|------|------------------------|---------------------------|
| 代码侵入 | 极低，一个注解 | 较高，需要显式编码 |
| 粒度控制 | 方法级别 | 代码块级别 |
| 灵活性 | 一般 | 高，可精确控制提交/回滚时机 |
| 可读性 | 高，意图清晰 | 较低，业务逻辑和事务管理混杂 |
| 适用场景 | 大多数业务方法 | 特殊场景：部分回滚、条件提交、跨方法事务 |

### 4.2 TransactionTemplate

```java
@Service
public class BatchImportService {

    @Autowired
    private TransactionTemplate txTemplate;

    public ImportResult importData(List<Record> records) {
        return txTemplate.execute(status -> {
            int success = 0;
            int failed = 0;

            for (Record record : records) {
                try {
                    recordDao.insert(record);
                    success++;
                } catch (Exception e) {
                    failed++;
                    // 设置保存点，让单条失败不影响整体
                    status.setRollbackOnly();  // 标记为仅回滚（如果整个方法需要回滚）
                    log.warn("导入失败: {}", record.getId(), e);
                }
            }

            return new ImportResult(success, failed);
        });
    }
}
```

### 4.3 PlatformTransactionManager：更底层的控制

```java
@Service
public class AdvancedTransferService {

    @Autowired
    private PlatformTransactionManager txManager;

    public void complexTransfer(Account from, Account to, BigDecimal amount) {
        TransactionStatus status = txManager.getTransaction(
            new DefaultTransactionDefinition()
        );

        try {
            // 第一阶段：扣款（在同一个事务中）
            accountDao.decrease(from.getId(), amount);

            // 某些业务需要在这里做外部调用、等待确认……
            boolean confirmed = externalService.confirmTransfer(from, to, amount);

            if (confirmed) {
                accountDao.increase(to.getId(), amount);
                txManager.commit(status);
            } else {
                txManager.rollback(status);
            }
        } catch (Exception e) {
            txManager.rollback(status);
            throw new TransferException("转账失败", e);
        }
    }
}
```

### 4.4 什么时候该用编程式？

以下场景建议使用编程式事务：

1. **事务范围不等于方法范围** —— 一个方法中只有部分代码需要事务
2. **条件提交** —— 根据运行时结果决定提交还是回滚
3. **批量操作中需要部分回滚** —— 某条失败不影响其他条目
4. **跨多个方法的统一事务** —— 用 `TransactionTemplate` 把多个调用包进同一个事务

> **原则：** 能用声明式就用声明式。编程式事务是"精确手术刀"，只在声明式无法表达意图时才拿出来。

## 5. 事务与 AOP 的连接

### 5.1 @Transactional 是 AOP 的"教科书案例"

理解 Spring 事务，本质上就是在理解 AOP（面向切面编程）。`@Transactional` 是 Spring AOP 最典型的应用之一：

```text
                    ┌────────────────────────────┐
                    │     @Transactional         │  ← 注解（元数据）
                    └────────────┬───────────────┘
                                 │ 被解析为
                                 ▼
                    ┌────────────────────────────┐
                    │  TransactionInterceptor    │  ← 通知（Advice）
                    │  - 事务开启 / 提交 / 回滚    │
                    └────────────┬───────────────┘
                                 │ 拦截
                                 ▼
                    ┌────────────────────────────┐
                    │   AOP Proxy (JDK/CGLIB)    │  ← 代理对象
                    └────────────┬───────────────┘
                                 │ 调用
                                 ▼
                    ┌────────────────────────────┐
                    │   目标对象 (原始 Bean)       │  ← 业务代码
                    └────────────────────────────┘
```

AOP 的三大要素在事务场景中的映射：

| AOP 概念 | 事务场景的对应 |
|---------|-------------|
| 切面（Aspect） | 事务管理切面 |
| 切入点（Pointcut） | 所有标注了 `@Transactional` 的方法 |
| 通知（Advice） | `TransactionInterceptor`（环绕通知） |

### 5.2 代理模式的本质

Spring AOP 底层使用两种代理方式：

**JDK 动态代理** —— 基于接口

```java
// 目标类实现了接口
public interface OrderService {
    void createOrder(Order order);
}

public class OrderServiceImpl implements OrderService {
    @Transactional
    public void createOrder(Order order) { ... }
}

// Spring 生成的代理（运行时动态生成）
// $Proxy0 implements OrderService
//   → 调用 createOrder() 时先经过 TransactionInterceptor
```

**CGLIB 代理** —— 基于继承

```java
// 目标类没有接口（Spring Boot 2.x+ 默认使用 CGLIB）
public class OrderService {
    @Transactional
    public void createOrder(Order order) { ... }
}

// Spring 生成的代理（运行时动态生成子类）
// OrderService$$EnhancerBySpringCGLIB extends OrderService
//   → 重写 createOrder()，插入事务拦截逻辑
```

| 代理方式 | 条件 | 优点 | 限制 |
|---------|------|------|------|
| JDK 动态代理 | 目标类实现了接口 | 标准 Java，无额外依赖 | 只能代理接口方法 |
| CGLIB | 无需接口 | 可代理类的所有方法 | 不能代理 `final` 类/方法 |

### 5.3 从第六卷看 AOP 的全局图景

事务管理只是 AOP 能力的一个切面。在第六卷中，你会看到 AOP 的更多应用：

```text
Spring AOP 应用全景
├── 事务管理 (@Transactional)       ← 本章
├── 日志记录 (自定义 @Log)
├── 权限校验 (@PreAuthorize)
├── 缓存管理 (@Cacheable)
├── 性能监控 (方法耗时统计)
├── 重试机制 (@Retryable)
└── 自定义切面 (业务横切关注点)
```

理解了 `@Transactional` 的代理原理，你就掌握了理解所有这些切面的钥匙：**注解标记切入点 → 代理拦截调用 → 通知执行横切逻辑 → 调用目标方法。**

## 6. 本章小结

| 主题 | 核心要点 |
|------|---------|
| @Transactional 原理 | AOP 代理 + TransactionInterceptor，事务边界在方法外层 |
| 传播机制 | REQUIRED 是默认，REQUIRES_NEW 独立事务，NESTED 用保存点 |
| 五大失效场景 | 同类调用、非 public、异常被吞、引擎不支持、多线程 |
| 编程式事务 | TransactionTemplate / PlatformTransactionManager，精确控制 |
| 与 AOP 的关系 | 事务是 AOP 的典型应用，代理模式是底层支撑 |

