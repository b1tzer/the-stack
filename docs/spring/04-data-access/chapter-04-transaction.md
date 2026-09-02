# 事务管理

> 方法执行到一半抛异常，数据库里只插入了一半数据——加个 `@Transactional` 就行？没那么简单。默认只回滚 RuntimeException、自调用绕过代理、异常被 catch 吞掉——这些都是「事务失效」的经典场景。本章从 `@Transactional` 的基本用法开始，讲透传播行为、隔离级别、失效场景，以及需要更细粒度控制时的编程式事务。

## 1. @Transactional 基础

### 1.1 基本用法

```java
@Service
public class OrderService {

    @Autowired
    private OrderMapper orderMapper;
    @Autowired
    private StockMapper stockMapper;

    @Transactional(rollbackFor = Exception.class)  // ← 关键！
    public void createOrder(Order order) {
        // 1. 创建订单
        orderMapper.insert(order);

        // 2. 扣减库存
        int rows = stockMapper.deduct(order.getProductId(), order.getQuantity());
        if (rows == 0) {
            throw new BusinessException("库存不足");
        }

        // 3. 如果这里抛异常，上面两步都会回滚
    }
}
```

### 1.2 rollbackFor 的重要性

```java
// ❌ 错误：默认只回滚 RuntimeException 和 Error
@Transactional
public void bad() {
    doSomething();
    throw new Exception("checked exception");  // 不会回滚！
}

// ✅ 正确：指定 rollbackFor = Exception.class
@Transactional(rollbackFor = Exception.class)
public void good() {
    doSomething();
    throw new Exception("checked exception");  // 会回滚
}
```

### 1.3 PlatformTransactionManager 原理

`@Transactional` 的执行流程：

```text
@Transactional 执行流程：
  1. AOP 代理拦截方法调用
  2. TransactionManager.getTransaction() → 获取/创建数据库连接，设置 autoCommit=false
  3. 执行业务方法
  4. 如果正常返回 → TransactionManager.commit()
  5. 如果抛出需要回滚的异常 → TransactionManager.rollback()
  6. 释放数据库连接
```

> **踩坑提醒**：`@Transactional` 默认只回滚 `RuntimeException` 和 `Error`，**不回滚 checked exception**。这是最容易踩的坑。永远写 `@Transactional(rollbackFor = Exception.class)`。

### 1.4 事务是 AOP 的典型应用

`@Transactional` 之所以能"自动"开启、提交、回滚事务，底层靠的是 AOP。AOP 的三大要素在事务场景中有明确对应：

| AOP 概念 | 事务场景的对应 |
| :-- | :-- |
| 切面（Aspect） | 事务管理切面 |
| 切入点（Pointcut） | 标注了 `@Transactional` 的方法 |
| 通知（Advice） | `TransactionInterceptor`（环绕通知） |

事务方法调用经过 `TransactionInterceptor` 的完整链路：

```text
@Transactional 注解
        ↓ 解析为切入点
TransactionInterceptor（环绕通知）
        ↓ 拦截
AOP 代理（JDK / CGLIB）
        ↓ 调用
目标 Bean 的业务方法
```

代理机制（JDK 动态代理 vs CGLIB、为什么自调用会失效）已在 [AOP 章节](../01-core/chapter-05-aop.md) §4 与 §7.3 讲透，这里不再重复。

## 2. 传播行为

### 2.1 什么是传播行为

ServiceA 的事务方法调用 ServiceB 的事务方法，它们用同一个事务还是各管各的？传播行为决定的就是这个问题。

### 2.2 七种传播行为

| 传播行为 | 说明 | 外部有事务 | 外部无事务 |
| :-- | :-- | :-- | :-- |
| `REQUIRED`（默认） | 加入当前事务 | 共用事务 | 创建新事务 |
| `REQUIRES_NEW` | 挂起当前，创建新事务 | 独立事务 | 创建新事务 |
| `NESTED` | 在当前事务中创建保存点 | 嵌套事务 | 创建新事务 |
| `SUPPORTS` | 有则加入，无则非事务 | 共用事务 | 非事务执行 |
| `NOT_SUPPORTED` | 非事务执行，挂起当前 | 非事务执行 | 非事务执行 |
| `MANDATORY` | 必须有事务，否则抛异常 | 共用事务 | 抛异常 |
| `NEVER` | 必须无事务，否则抛异常 | 抛异常 | 非事务执行 |

重点理解前三种：

### 2.3 REQUIRED（默认）

```java
@Service
public class OrderService {

    @Autowired
    private StockService stockService;

    @Transactional(rollbackFor = Exception.class)
    public void createOrder(Order order) {
        orderMapper.insert(order);
        // REQUIRED（默认）：加入当前事务
        // 如果这里抛异常，订单和库存操作一起回滚
        stockService.deduct(order.getProductId(), order.getQuantity());
    }
}
```

### 2.4 REQUIRES_NEW

```java
@Service
public class LogService {

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void saveLog(String content) {
        logMapper.insert(new Log(content));
    }
}

@Service
public class OrderService {

    @Autowired
    private LogService logService;

    @Transactional(rollbackFor = Exception.class)
    public void createOrder(Order order) {
        orderMapper.insert(order);

        // REQUIRES_NEW：独立事务
        // 即使订单创建失败，日志也已经写入（不回滚）
        logService.saveLog("创建订单: " + order.getOrderNo());
    }
}
```

### 2.5 NESTED

```java
@Service
public class PaymentService {

    @Transactional(propagation = Propagation.NESTED)
    public void processPayment(Order order) {
        paymentMapper.insert(new Payment(order));
        // 如果抛异常，只回滚到保存点
    }
}

@Service
public class OrderService {

    @Autowired
    private PaymentService paymentService;

    @Transactional(rollbackFor = Exception.class)
    public void createOrder(Order order) {
        orderMapper.insert(order);
        stockService.deduct(order.getProductId(), order.getQuantity());

        // NESTED：嵌套事务（保存点）
        // 如果支付失败，只回滚支付操作，订单和库存不回滚
        try {
            paymentService.processPayment(order);
        } catch (Exception e) {
            log.warn("支付失败，订单保留: {}", order.getOrderNo());
        }
    }
}
```

嵌套事务保存点原理：

```text
NESTED 事务流程：
  BEGIN TRANSACTION (外层)
    INSERT INTO orders ...
    SAVEPOINT sp1                    ← 创建保存点
      INSERT INTO payments ...
      如果失败 → ROLLBACK TO sp1    ← 只回滚到保存点
    RELEASE SAVEPOINT sp1            ← 释放保存点
  COMMIT (外层事务提交)
```

> **踩坑提醒**：`NESTED` 的保存点依赖 JDBC 的 `savepoint` 支持。MySQL InnoDB 支持，但有些数据库驱动不支持。`NESTED` 和 `REQUIRES_NEW` 的区别：`REQUIRES_NEW` 是完全独立的事务（不受外层回滚影响），`NESTED` 仍然属于外层事务（外层回滚时嵌套也回滚）。

---

## 3. 隔离级别与并发问题

### 3.1 四种并发问题

| 问题 | 描述 | 示例 |
| :-- | :-- | :-- |
| **脏读** | 读到未提交的数据 | 事务 A 修改了数据但未提交，事务 B 读到了修改后的值，A 回滚了 |
| **不可重复读** | 同一事务两次读同一行，结果不同 | 事务 A 读了数据，事务 B 修改并提交，A 再读发现变了 |
| **幻读** | 同一事务两次查询，行数不同 | 事务 A 查询有 5 条，事务 B 插入 1 条提交，A 再查有 6 条 |
| **第一类丢失更新** | 回滚覆盖了其他事务的修改 | 事务 A 回滚把事务 B 已提交的修改覆盖了 |

### 3.2 四种隔离级别

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | MySQL 默认 | Oracle 默认 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `READ_UNCOMMITTED` | ❌ 可能 | ❌ 可能 | ❌ 可能 | 否 | 否 |
| `READ_COMMITTED` | ✅ 解决 | ❌ 可能 | ❌ 可能 | 否 | **是** |
| `REPEATABLE_READ` | ✅ 解决 | ✅ 解决 | ⚠️ 部分 | **是** | 否 |
| `SERIALIZABLE` | ✅ 解决 | ✅ 解决 | ✅ 解决 | 否（性能差） | 否 |

```java
// 设置隔离级别
@Transactional(isolation = Isolation.REPEATABLE_READ)
public void transfer(Long fromId, Long toId, BigDecimal amount) {
    Account from = accountMapper.selectForUpdate(fromId);  // 悲观锁
    Account to = accountMapper.selectForUpdate(toId);

    if (from.getBalance().compareTo(amount) < 0) {
        throw new BusinessException("余额不足");
    }

    accountMapper.deduct(fromId, amount);
    accountMapper.add(toId, amount);
}
```

> **踩坑提醒**：MySQL 的 `REPEATABLE_READ` 通过 MVCC + Gap Lock 已经**基本解决**了幻读问题（但不是完全）。`SERIALIZABLE` 隔离级别会把所有 SELECT 都变成 `SELECT ... LOCK IN SHARE MODE`，性能急剧下降，生产环境慎用。

---

## 4. @Transactional 失效场景

### 4.1 六大失效场景

```java
@Service
public class UserService {

    // ❌ 场景1：方法不是 public
    @Transactional(rollbackFor = Exception.class)
    private void notPublic() {  // private/protected/package-private 都不行
        // AOP 代理无法拦截非 public 方法
    }

    // ❌ 场景2：自调用（this 调用绕过了代理）
    public void createUser() {
        this.doCreate();  // ← 直接调用，不走代理！事务不生效
    }

    @Transactional(rollbackFor = Exception.class)
    public void doCreate() {
        // ...
    }

    // ❌ 场景3：异常被 catch 吞掉
    @Transactional(rollbackFor = Exception.class)
    public void createWithCatch() {
        try {
            doInsert();
            int result = 1 / 0;  // ArithmeticException
        } catch (Exception e) {
            log.error("出错了", e);  // 异常被 catch，Spring 不知道要回滚
        }
    }

    // ❌ 场景4：rollbackFor 未指定，抛的是 checked exception
    @Transactional  // 默认只回滚 RuntimeException
    public void createWithChecked() throws IOException {
        doInsert();
        throw new IOException("IO 错误");  // checked exception，不回滚
    }

    // ❌ 场景5：数据库引擎不支持事务（MySQL MyISAM）
    // MyISAM 不支持事务，表必须是 InnoDB

    // ❌ 场景6：propagation = Propagation.NOT_SUPPORTED
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void noTransaction() {
        // 以非事务方式运行，不会回滚
    }
}
```

### 4.2 解决自调用问题

```java
@Service
public class UserService {

    // 方案1：注入自身代理
    @Autowired
    @Lazy  // 避免循环依赖
    private UserService self;

    public void createUser() {
        self.doCreate();  // 通过代理调用，事务生效
    }

    @Transactional(rollbackFor = Exception.class)
    public void doCreate() { ... }

    // 方案2：从 ApplicationContext 获取代理
    @Autowired
    private ApplicationContext context;

    public void createUser2() {
        UserService proxy = context.getBean(UserService.class);
        proxy.doCreate();
    }

    // 方案3：使用 AopContext（需要开启 exposeProxy）
    public void createUser3() {
        ((UserService) AopContext.currentProxy()).doCreate();
    }
}
```

> **踩坑提醒**：自调用是 `@Transactional` 失效最常见的原因。理解原理：Spring AOP 基于代理，`this.method()` 调用的是原始对象而非代理对象，AOP 增强不生效。最干净的方案是把需要事务的方法拆到另一个 Service 中。

---

## 5. 编程式事务

有些场景需要更细粒度的事务控制——比如一个方法中部分操作需要独立事务。

### 5.1 TransactionTemplate

```java
@Service
public class OrderService {

    @Autowired
    private TransactionTemplate transactionTemplate;

    public void createOrderWithLog(Order order) {
        // 1. 在事务中创建订单
        Long orderId = transactionTemplate.execute(status -> {
            orderMapper.insert(order);
            stockService.deduct(order.getProductId(), order.getQuantity());
            return order.getId();
        });

        // 2. 非事务操作（或独立事务）
        // 日志写入失败不影响订单
        try {
            transactionTemplate.executeWithoutResult(status -> {
                logService.saveLog("订单创建成功: " + orderId);
            });
        } catch (Exception e) {
            log.warn("日志写入失败，不影响订单", e);
        }

        // 3. 带回滚标记的编程式事务
        transactionTemplate.executeWithoutResult(status -> {
            try {
                paymentService.process(order);
            } catch (PaymentException e) {
                status.setRollbackOnly();  // 手动标记回滚
                throw e;
            }
        });
    }
}
```

### 5.2 声明式 vs 编程式

| 维度 | @Transactional | TransactionTemplate |
| :-- | :-- | :-- |
| 代码侵入 | 无（声明式） | 有（代码中显式调用） |
| 粒度 | 方法级别 | 代码块级别 |
| 灵活性 | 低（整个方法一个事务） | 高（可以有多个事务块） |
| 可读性 | 好 | 差（嵌套 lambda） |
| 推荐场景 | 大多数场景 | 需要细粒度控制时 |

> **踩坑提醒**：`transactionTemplate.execute()` 的返回值就是事务方法的返回值。如果 lambda 中抛出 `RuntimeException`，事务自动回滚。如果抛出 checked exception，需要用 `try-catch` 并调用 `status.setRollbackOnly()` 手动回滚。

---

## 6. 最佳实践

1. **始终指定 `rollbackFor = Exception.class`**——避免非 RuntimeException 不回滚的坑
2. **事务方法尽量短小**——长事务占用数据库连接，影响并发性能
3. **只读查询加 `readOnly = true`**——Hibernate 会跳过脏检查，提升性能
4. **避免在事务中调用外部 API**——网络超时会导致事务长时间持有连接
5. **`REQUIRES_NEW` 谨慎使用**——会挂起当前事务，可能导致死锁
6. **理解传播行为的含义**——不要所有方法都加 `@Transactional`，只读操作不需要事务
