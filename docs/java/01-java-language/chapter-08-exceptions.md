# 异常与资源管理：把失败变成明确边界

> 下单过程中数据库提交失败，但通知已经发出；文件读取抛出异常，句柄却一直未关闭；日志里只有 `SQLException`，看不到哪笔订单失败。这三类问题的共同原因不是“没有 try”，而是失败边界、异常上下文和资源生命周期没有一起设计。

本页面向已经会写 Java 方法和类的读者，目标是能判断异常类型、设计可恢复的错误边界，并保证连接、流和锁在成功与失败路径上都正确关闭。适用版本为 Java 21；异常模型自 Java 7 起的关键能力一直保持稳定。

## 1. 先识别 Throwable 的语义

### 1.1 Error、Exception 与 RuntimeException

Java 的异常类型都继承自 `Throwable`，它有两个直接子类 `Error` 和 `Exception`，`RuntimeException` 又继承自 `Exception`：

```txt
java.lang.Throwable
├── java.lang.Error
└── java.lang.Exception
    └── java.lang.RuntimeException
```

`Exception` 除 `RuntimeException` 以外的直接子类（如 `IOException`、`SQLException`）就是受检异常；它们是一组各不相同的类型，不画成树的单个节点。

从编译器是否要求显式处理的角度，可以把异常分成两类。受检异常是除 `RuntimeException` 及其子类、`Error` 及其子类以外的异常，方法需要捕获或在 `throws` 中声明；非受检异常是 `RuntimeException` 及其子类和 `Error` 及其子类，编译器不要求显式处理。受检与非受检描述的是语言层面的处理要求，不等同于可恢复与不可恢复。

| 类型 | 代表含义 | 应用代码通常如何处理 |
| :-- | :-- | :-- |
| `Error` | JVM 或运行环境层面的严重问题，如 `OutOfMemoryError` | 不包装成普通业务失败继续运行 |
| 受检异常 `Exception` | 调用者可能需要知道并处理的外部失败 | 明确传播、转换或处理，并保留原因 |
| 非受检异常 `RuntimeException` | 参数、状态或程序契约错误 | 先修正代码或状态；调用方是否显式捕获取决于边界 |

`RuntimeException` 不是“可以随便抛”的同义词。它只是不要求方法签名声明 `throws`。抛出前仍要判断：这个失败是否可能被调用者合理恢复，调用者能否得到足够上下文，以及继续执行是否安全。

### 1.2 受检与非受检不是二选一

更实用的判断顺序是：

1. 调用者能否针对该失败采取不同行动？如果能，就把失败信息完整传给调用者。
2. 失败是否属于当前方法承诺维持的契约？违反契约通常是 `IllegalArgumentException`、`IllegalStateException` 等非受检异常。
3. 失败是否来自 I/O、配置、网络或外部系统，且替换实现后仍会发生？可以定义领域异常或转换为稳定的开放异常类型。
4. 到达应用边界后，调用者是否还需要恢复？多数 Web、消息和定时任务边界应把内部失败转换为状态码、错误码或失败结果。

如果上层不应该依赖底层库的异常类型，可以在合适的边界进行转换，并通过 cause 保留原始异常；若底层异常本身就是公开 API 契约的一部分，则不必为包装而额外定义异常类。异常穿越层次时应增加业务上下文，同时用 cause 保留原始堆栈。

## 2. 构造可恢复的异常

### 2.1 保留原因并补充上下文

```java
public final class OrderNotFoundException extends RuntimeException {
    private final long orderId;

    public OrderNotFoundException(long orderId) {
        super("order not found: " + orderId);
        this.orderId = orderId;
    }

    public OrderNotFoundException(long orderId, Throwable cause) {
        super("failed to load order: " + orderId, cause);
        this.orderId = orderId;
    }

    public long orderId() {
        return orderId;
    }
}

// Spring Data 的 findById 返回 Optional，记录不存在时返回 Optional.empty()，
// 查询失败（如数据库连接失败）才抛异常。下面把「缺值」转为领域异常。
return orderRepository.findById(orderId)
        .orElseThrow(() -> new OrderNotFoundException(orderId));
```

消息回答“发生了什么”，字段回答“影响哪个对象”，cause 回答“底层为什么失败”。不要把密码、令牌或完整请求体拼进异常消息；这些信息可能进入日志和监控。

### 2.2 按调用者能采取的行动划分异常

异常类型应当对应调用者需要采取的处理动作，而不是追求越稳定越好。底层 `SQLException` 包含驱动和 SQL 细节，不应迫使所有业务方法都理解它。数据库访问层可以转换成领域异常，同时保留原始 cause：

```java
public final class OrderCommitException extends RuntimeException {
    public OrderCommitException(SQLException cause) {
        super("failed to commit order transaction", cause);
    }
}

try {
    connection.commit();
} catch (SQLException ex) {
    throw new OrderCommitException(ex);
}
```

不要创建庞大而模糊的 `MyAppException`，再靠消息字符串区分失败。异常类型应该对应调用者会采取的不同动作；只有展示文本不同、处理方式相同的情况才共用一个类型。

### 2.3 在正确的层捕获

- 只捕获当前层能处理或能补充上下文的异常。
- 不要用 `catch (Exception e) {}` 消除编译错误。
- 捕获后继续执行前，必须确认当前对象、事务和资源仍处于一致状态。
- 不要记录后原样抛出，导致同一异常被多层重复记录。通常只在应用边界记录一次。
- `InterruptedException` 表示取消或关闭信号。能向上传播时，继续抛出该异常；不能传播时，恢复线程的中断状态，并按取消语义退出或结束当前任务，不能只打印后继续等待。

## 3. 用 try-with-resources 管理资源

### 3.1 让资源生命周期跟随作用域

对于由当前方法负责关闭、并实现了 `AutoCloseable` 的资源，例如输入流、读取器、JDBC 连接或通道，应优先放进 try-with-resources：

```java
try (InputStream input = Files.newInputStream(path);
     Reader reader = new InputStreamReader(input, StandardCharsets.UTF_8)) {
    return parse(reader);
} catch (IOException ex) {
    throw new UncheckedIOException("无法读取 " + path, ex);
}
```

资源按声明的逆序关闭。无论正常返回、抛异常还是提前退出，关闭都会执行。

`Lock`、`ReentrantLock` 没有实现 `AutoCloseable`，需要显式释放，应在成功获取锁后进入 try，在 finally 中解锁：

```java
lock.lock();
try {
    updateSharedState();
} finally {
    lock.unlock();
}
```

先获取锁再进入 try，获取锁失败时就不会错误执行 `unlock()`。对于其他没有实现 `AutoCloseable` 的资源，同样退回 `try/finally`，并确保初始化失败时不会关闭尚未创建的对象。

### 3.2 理解关闭阶段的第二个异常

如果 try 块已经抛出异常，而资源 `close()` 又失败，原异常仍然是主异常，`close()` 异常会作为 suppressed exception 附加。如果 try 块正常结束，但 `close()` 失败，关闭异常本身会被抛出。读取 `Throwable.getSuppressed()` 或完整堆栈可以同时看到两者。

这不会让第二个异常消失，也不代表可以忽略关闭失败。对事务连接尤其要区分：

- 提交失败时，客户端有时无法确定事务是否真的提交成功，可能服务端已提交但确认消息丢失，不能简单判定事务一定回滚。
- 归还连接时再次失败可能说明连接状态已经不可信。
- 已经由 Spring 等框架管理的连接不应在业务代码中重复提交或回滚。

JDBC 的事务边界见[JDBC 与 Connection 管理事务](../05-java-data-access/chapter-02-jdbc.md#jdbc-connection-transactions)。

## 4. 在系统边界完成错误处理

### 4.1 库、任务和用户边界

| 边界 | 应完成什么 |
| :-- | :-- |
| 内部方法 | 传播足以让上层决策的失败，或处理本地可恢复状态 |
| 数据访问层 | 包装驱动异常，保留 cause，明确事务是否仍可用 |
| HTTP、消息、定时任务入口 | 转换为稳定响应或失败记录，决定重试、丢弃或人工介入 |
| 日志与指标 | 记录一次，带关联 ID、失败类型和影响对象，不记录敏感数据 |

重试不是默认动作。只有失败具有瞬时性、操作幂等或有明确恢复点时才重试，并设置次数、退避和总时间预算。数据库提交失败后的自动重试可能造成重复写入，必须先建立幂等边界。

### 4.2 区分程序错误与可恢复失败

参数错误、错误的类型转换和违反内部不变量，通常说明代码或调用方式有问题，继续执行会放大风险。连接超时、临时不可用或可解释的业务拒绝，则可能由调用者采用降级、重试或反馈用户。

不要把所有 `Exception` 都归为“系统异常”，也不要为了让接口返回 200 而吞掉异常。调用者需要知道失败是否发生，以及结果是否可信。

## 5. 常见失败模式

| 失败模式 | 后果 | 修改方向 |
| :-- | :-- | :-- |
| 空 `catch` 或只打印 | 上层认为操作成功 | 处理、转换或继续传播 |
| 捕获过宽后继续运行 | 对象和事务处于未知状态 | 只在状态仍一致时恢复 |
| 异常消息包含敏感数据 | 日志泄漏 | 使用稳定错误码和安全上下文 |
| finally 中再次覆盖主异常 | 根因丢失 | 使用 try-with-resources 或保留 cause |
| 捕获 `InterruptedException` 后继续等待 | 取消机制失效 | 恢复中断并退出阻塞 |
| 对非幂等操作自动重试 | 重复提交 | 先建立幂等键或确认结果 |

## 6. 下一步

下一步进入[标准集合](./chapter-09-collections.md)，重点检查 `equals`/`hashCode` 契约和容器选择；函数式处理中的缺值与失败组合由[Stream 与 Optional](./chapter-10-stream-optional.md)承接，生产问题再进入[诊断总览](../06-diagnostics/index.md)。

> **官方参考：** [Java SE 21 `Throwable`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Throwable.html)、[`AutoCloseable`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/AutoCloseable.html)。
