# 虚拟线程迁移：适用边界与结构化并发

> 本页与 [虚拟线程模型与 Pinning（JDK 21）](./chapter-13-virtual-thread.md) 配套，重点说明适用边界、结构化并发、线程池取舍和迁移示例。

## 1. 何时不要用虚拟线程

虚拟线程不是万能替代。以下四种场景下，平台线程仍然是更好的选择。

### 1.1 CPU 密集任务

虚拟线程解决的是"线程数受限"的问题，不是"CPU 算得慢"的问题。一段跑满 CPU 的循环，无论跑在虚拟线程还是平台线程上，占用的 Carrier / OS 时间片是一样的。

```java
// ❌ 用虚拟线程跑图像处理，得不到任何加速
try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Image img : images) {
        pool.submit(() -> resize(img));  // 每个任务持续 CPU 运算
    }
}
// 100 万个 VT 只能在 N_CPU 条 Carrier 上排队，不如直接 ForkJoinPool
```

```java
// ✅ CPU 密集：固定大小的平台线程池
ExecutorService pool = Executors.newFixedThreadPool(
    Runtime.getRuntime().availableProcessors()
);
```

**判断规则**：任务的墙钟时间中 CPU 占比超过 50%，就应该用平台线程池。

### 1.2 需要严格限流的场景

传统线程池天然通过 `maxPoolSize` + `workQueue` 提供背压。虚拟线程模型下"来一个任务起一条 VT"，如果下游是有并发上限的资源（数据库连接池、下游 API 的 QPS 配额），需要**外挂 `Semaphore` 做限流**。

```java
// ❌ 虚拟线程直接调下游，可能瞬间把下游打挂
try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
    for (long i = 0; i < 100_000; i++) {
        pool.submit(() -> downstreamApi.call());   // 10 万并发调用
    }
}
```

```java
// ✅ 用 Semaphore 显式限流
Semaphore rateLimiter = new Semaphore(100);   // 下游允许 100 并发
try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
    for (long i = 0; i < 100_000; i++) {
        pool.submit(() -> {
            rateLimiter.acquire();
            try {
                downstreamApi.call();
            } finally {
                rateLimiter.release();
            }
        });
    }
}
```

### 1.3 `ThreadLocal` 密集使用的路径

虚拟线程完全支持 `ThreadLocal`（在第 3 章讨论过它的存储结构）。但在 VT 场景下要提防一件事：**百万级 VT × 每 VT 若干 TL 值 = 内存爆炸**。

举例：一个请求链路挂了 10 个 TL 值，每个值 1 KB。平台线程模型下同时活跃线程 2 000 条，占 20 MB；虚拟线程模型下同时活跃 200 000 条 VT，占 2 GB。

应对方向：

- 优先使用 `ScopedValue`（JDK 21 预览，JDK 23 二次预览）替代只在方法调用链里用的 `ThreadLocal`
- 拆分 TL：只把真正需要跨方法透传的东西放进 TL，其余通过参数传递
- 关键路径改造完之前，用 `-XX:NativeMemoryTracking` 观察堆外增长

### 1.4 依赖平台线程语义的库

少量库依赖 `Thread` 的平台线程语义，例如：

- 通过 `Thread.currentThread().getContextClassLoader()` 做类隔离的框架
- 依赖 OS 线程亲和性（thread affinity）的高性能库
- 用 `Thread` 的堆栈作为标识做 profiling 的工具

对这些场景，如果切到虚拟线程后行为异常，最保险的做法是：**入口保持平台线程，把 IO 密集部分显式提交到 `newVirtualThreadPerTaskExecutor`**。

## 2. 结构化并发：`StructuredTaskScope`

### 2.1 传统 fire-and-forget 的问题

有了廉价的虚拟线程，人们开始一次派生成百上千的子任务。此时"父子任务生命周期"变成了新问题：

```java
// ❌ 派生子任务后失控
Future<User> fUser = executor.submit(() -> userApi.get(id));
Future<Order> fOrder = executor.submit(() -> orderApi.get(id));

try {
    User user = fUser.get();
    Order order = fOrder.get();
    return new Profile(user, order);
} catch (ExecutionException e) {
    // 一个失败了，另一个仍在跑！
    // 需要手动 cancel(true)，还要处理各种异常路径
    fUser.cancel(true);
    fOrder.cancel(true);
    throw e;
}
```

传统 `ExecutorService` 的问题：

- 父任务失败/超时时，子任务不会自动取消，容易泄漏
- 子任务的异常传播路径复杂，必须手写 try/finally 骨架
- 从 thread dump 看不出"这几条 VT 属于同一个父任务"

### 2.2 结构化并发的核心约束

**结构化并发（Structured Concurrency）** 用一个语法块把父子任务生命周期绑在一起：**作用域内派生的所有任务必须在作用域退出前完成**。

```java
// ✅ 结构化并发（JDK 21 preview / JDK 25 GA API 略有调整）
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Subtask<User>  user  = scope.fork(() -> userApi.get(id));
    Subtask<Order> order = scope.fork(() -> orderApi.get(id));

    scope.join();              // 等所有子任务结束或被取消
    scope.throwIfFailed();     // 任一失败则抛出

    return new Profile(user.get(), order.get());
}   // 作用域退出：残留子任务自动取消
```

三条硬保证：

| 保证 | 意义 |
| :-- | :-- |
| 作用域内 fork 的子任务，一定在 `try` 退出前结束 | 不会泄漏 |
| 任一子任务失败，`ShutdownOnFailure` 立即取消其余 | 快速失败 |
| Thread dump 能看到父子层级 | 排查友好 |

### 2.3 两种收敛策略

| 策略 | 语义 | 典型场景 |
| :-- | :-- | :-- |
| `ShutdownOnFailure` | 任一子任务失败则取消其余 | 并行下游都必须成功（聚合 A、B、C 三个 API） |
| `ShutdownOnSuccess` | 任一子任务成功则取消其余 | 从多副本读取，取最先返回的 |

```java
// 场景 A：三个下游都要成功
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    var a = scope.fork(this::callA);
    var b = scope.fork(this::callB);
    var c = scope.fork(this::callC);
    scope.join().throwIfFailed();
    return merge(a.get(), b.get(), c.get());
}

// 场景 B：多个副本取最快
try (var scope = new StructuredTaskScope.ShutdownOnSuccess<Result>()) {
    scope.fork(() -> replica1.query());
    scope.fork(() -> replica2.query());
    scope.fork(() -> replica3.query());
    return scope.join().result();
}
```

### 2.4 超时与取消

`StructuredTaskScope` 天然支持超时和外部取消：

```java
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    var user  = scope.fork(() -> userApi.get(id));
    var order = scope.fork(() -> orderApi.get(id));

    scope.joinUntil(Instant.now().plusSeconds(2));   // 全局超时
    scope.throwIfFailed();

    return new Profile(user.get(), order.get());
} catch (TimeoutException e) {
    // 超时时作用域自动关闭，两个子任务收到中断
    throw new ServiceUnavailableException(e);
}
```

比起手工写 `Future.get(timeout, unit)` 加上一堆 cancel，代码短得多且更难写错。

### 2.5 API 稳定性提示

`StructuredTaskScope` 在 JDK 21 是 preview（第一轮），JDK 22–24 经过多轮 preview，**JDK 25 正式 GA，API 名称有小幅调整**（例如 `ShutdownOnFailure` 变为 `Joiner.awaitAllSuccessfulOrThrow()` 风格）。生产使用时以目标 JDK 版本的 JEP 为准。

## 3. 虚拟线程时代重新评估线程池

用一张表总结虚拟线程 GA 之后传统线程池经验哪些还成立、哪些需要重估：

| 维度 | 平台线程池的经验 | 虚拟线程时代的调整 |
| :-- | :-- | :-- |
| IO 密集处理 | `poolSize = 2 × N_CPU`，队列 + 拒绝策略 | 直接 `newVirtualThreadPerTaskExecutor`，无参数 |
| CPU 密集计算 | `poolSize = N_CPU + 1` | **保持不变** |
| 定时调度 | `ScheduledThreadPoolExecutor` | **保持不变**（VT 无 scheduled 变体） |
| 天然限流 | 依赖 `maxPoolSize` + `BoundedQueue` | 显式 `Semaphore` 或专用限流器 |
| 上下文传递 | `TransmittableThreadLocal` | `ScopedValue`（preview） |
| 请求超时 | `Future.get(timeout)` | `StructuredTaskScope.joinUntil` |
| 命名与排查 | `ThreadFactory` + 命名规范 | `Thread.ofVirtual().name(prefix, seq)` |

**判断决策**：

![vt-decision-tree](/java/vt-decision-tree.svg)

## 4. 一段完整示例：从传统 API 迁移到虚拟线程

假设一个订单详情接口：聚合 `UserService`、`OrderService`、`InventoryService` 三处数据，任一失败即失败，总超时 500 ms。

```java
// 迁移前：CompletableFuture 版本
public Profile loadProfile(String id) {
    CompletableFuture<User>      fUser  = CompletableFuture.supplyAsync(() -> userApi.get(id), pool);
    CompletableFuture<Order>     fOrder = CompletableFuture.supplyAsync(() -> orderApi.get(id), pool);
    CompletableFuture<Inventory> fInv   = CompletableFuture.supplyAsync(() -> invApi.get(id),   pool);

    try {
        return CompletableFuture.allOf(fUser, fOrder, fInv)
            .orTimeout(500, TimeUnit.MILLISECONDS)
            .thenApply(v -> new Profile(fUser.join(), fOrder.join(), fInv.join()))
            .join();
    } catch (CompletionException e) {
        // 已有子任务不会自动取消，需要额外处理
        fUser.cancel(true); fOrder.cancel(true); fInv.cancel(true);
        throw unwrap(e);
    }
}
```

```java
// 迁移后：虚拟线程 + 结构化并发
public Profile loadProfile(String id) throws Exception {
    try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
        Subtask<User>      user  = scope.fork(() -> userApi.get(id));
        Subtask<Order>     order = scope.fork(() -> orderApi.get(id));
        Subtask<Inventory> inv   = scope.fork(() -> invApi.get(id));

        scope.joinUntil(Instant.now().plusMillis(500));
        scope.throwIfFailed();

        return new Profile(user.get(), order.get(), inv.get());
    }
}
```

代码行数减半，异常传播路径清晰，超时语义直观，子任务的生命周期由作用域托管。这就是虚拟线程与结构化并发组合带来的最直接收益。

## 5. 本页小结

| 问题 | 根源 | 解决方案 |
| :-- | :-- | :-- |
| 平台线程数量受硬限制 | OS 1:1 模型 + 上下文切换成本 | 虚拟线程的 M:N 调度 |
| Reactor 代码断裂、调试困难 | 异步链式编程范式 | 同步风格的虚拟线程 |
| `synchronized` 阻塞 IO 让 Carrier 被钉死 | JDK 21–23 的实现限制 | 迁移到 `ReentrantLock` 或升级 JDK 24+ |
| CPU 密集任务用虚拟线程无收益 | Carrier 数量仍受 CPU 核数限制 | CPU 密集仍用平台线程池 |
| 无天然背压导致下游被打挂 | `newVirtualThreadPerTaskExecutor` 无并发上限 | 外挂 `Semaphore` 或专用限流器 |
| 子任务派生后失控、异常传播复杂 | 平面式的 `Future` 组合 | `StructuredTaskScope` 结构化并发 |
