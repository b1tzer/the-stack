# 虚拟线程与结构化并发（JDK 21）

> 如果一条线程可以像一个对象那样廉价，过去十年围绕线程池积累的工程直觉，还剩下多少是对的？

Java 21 把虚拟线程从预览特性升级为 GA。它不是一种新语言语法，也不是异步框架，而是对 `java.lang.Thread` 的一次实现层重写：同样的类、同样的 API、同样的编程风格，但一台 JVM 上并存的线程数从"几千"跳到"百万"。这个改动同时改写了两件事——线程池存在的理由和 Reactor 编程存在的理由。

本章讨论：这次改动改到了哪里，改到了什么程度，改动之外还剩下什么。

## 1. 平台线程走到尽头的原因

### 1.1 一条平台线程的成本清单

在 JDK 21 之前，`new Thread()` 得到的每一条 Java 线程背后都对应一条 OS 线程（HotSpot 的 1:1 模型，见第 2 章）。这条 OS 线程要付出的固定成本：

| 项目 | 典型值 | 说明 |
| :-- | :-- | :-- |
| 栈内存 | 1 MB（`-Xss` 默认） | 预留虚拟地址空间，用到多少提交多少 |
| 内核态数据结构 | 数 KB | `task_struct`、内核栈、调度器条目 |
| 上下文切换 | 1–10 µs / 次 | 保存/恢复寄存器、切换 TLB、可能刷新 L1 |
| 创建/销毁 | 数十 µs | 系统调用 + 内核数据结构分配 |

一台 16 GB 堆外余量的应用，能开出的平台线程数量级在 **5 000–15 000**。真正压死线程数量的通常不是栈占用，而是 **上下文切换的边际收益**：线程数超过 CPU 核数几十倍后，CPU 花在切换本身上的时间就超过了业务代码。

### 1.2 高并发场景下的两难

一个典型的后端接口，处理链路是这样的：

```text
        接收请求
             │
             ▼
     ┌────────────┐    RT 里 95% 时间在这
     │  下游 IO   │    数据库、Redis、下游服务
     └────────────┘
             │
             ▼
        组装返回
```

95% 的时间线程都在 park 等 IO。假设 QPS = 10 000、平均 RT = 200 ms，按小 Little 定律得到平均并发数：

```text
N = QPS × RT = 10 000 × 0.2s = 2 000
```

需要 2 000 条线程同时挂着。平台线程模型下这已经贴着上限；QPS 再翻一倍就必须拒绝请求。

过去应对这个矛盾有两条路：

- **限并发**：Tomcat 的 `maxThreads=200`，多余请求排队 —— 用户在门口等
- **改异步**：Netty、Reactor、`CompletableFuture` 链 —— 一条线程处理成千上万条连接

### 1.3 Reactor 路径的隐藏成本

异步方案不是没有代价。写过 `WebFlux` 或者 Netty 应用的人知道下面这几件事：

```java
// ❌ Reactor 式代码：调用栈被切碎
Mono<Order> loadOrder(String id) {
    return orderRepo.findById(id)
        .flatMap(order -> userRepo.findById(order.userId())
            .flatMap(user -> itemRepo.findAll(order.itemIds())
                .collectList()
                .map(items -> assemble(order, user, items))));
}
```

```java
// ✅ 同步代码：直读直写
Order loadOrder(String id) {
    Order order = orderRepo.findById(id);
    User user = userRepo.findById(order.userId());
    List<Item> items = itemRepo.findAll(order.itemIds());
    return assemble(order, user, items);
}
```

Reactor 版本换来的是吞吐，付出的是：

- **异常栈丢失**：`onError` 拿到的 stack trace 通常停在 Reactor 内部
- **`ThreadLocal` 失效**：跨算子切线程后 MDC、事务、租户上下文全断
- **调试困难**：断点打不到业务逻辑，`step over` 直接跳出方法
- **心智负担**：`flatMap` / `zipWith` / `switchIfEmpty` 的语义精确性要求高

也就是说，Reactor 让 CPU 更闲了，但让人更累了。

### 1.4 虚拟线程要解决的问题

虚拟线程给出的答案是：**同步代码风格 + 异步执行效率**。让开发者继续用 `Thread` / `ExecutorService` / try-catch / `ThreadLocal`，同时把 IO 阻塞时的"线程占坑"问题在 JVM 层面消掉。

## 2. 虚拟线程：M:N 调度与 continuation

### 2.1 虚拟线程与平台线程的对照

![vt-mapping](/java/vt-mapping.svg)

- **虚拟线程（Virtual Thread, VT）**：`java.lang.Thread` 的子类实例，栈保存在堆上，个数可达百万级
- **载体线程（Carrier Thread）**：真正的平台线程，是 VT 运行时实际占用的 CPU 执行流；VT 只在 Carrier 上"临时挂载"
- **调度器（Scheduler）**：默认是一个专用的 `ForkJoinPool`，决定哪个 VT 挂到哪个 Carrier 上运行

关键设计：**当 VT 阻塞在 JDK 阻塞点（如 `Socket.read`、`Thread.sleep`、`LockSupport.park`）时，JVM 会把 VT 从 Carrier 上卸载，Carrier 立即去执行别的 VT**。等阻塞条件满足，VT 被重新挂到某条 Carrier 上继续跑。

### 2.2 continuation：可挂起可恢复的执行片段

虚拟线程的挂起/恢复能力，来自一个更底层的机制——`Continuation`（`jdk.internal.vm.Continuation`）。

一段执行流有两种状态：

- **running**：栈帧在某条 Carrier 的调用栈上
- **frozen**：栈帧被复制到堆上，等待被"解冻"

`Continuation.yield(scope)` 触发从 running 到 frozen 的转换：JVM 把当前 Carrier 上属于这个 VT 的所有栈帧、局部变量、返回地址复制到堆上的一段内存里，然后 Carrier 上的 `run()` 方法返回，Carrier 继续挑下一个 VT。

`Continuation.run()` 触发从 frozen 到 running：JVM 把堆上保存的栈帧复制回 Carrier 的调用栈顶，代码从 yield 点继续执行。

对读者的意义是：**虚拟线程不是操作系统线程，也不是协程库，而是"栈可搬家的 Java 线程"**。Java 语言不需要 `async` / `await` 关键字，因为搬家的动作发生在 JDK 内部的 IO 调用里，业务代码看不见。

### 2.3 调度器与 Carrier 池

默认 Carrier 池的属性可以用系统属性调整：

```bash
# Carrier 数量，默认等于 CPU 核数
-Djdk.virtualThreadScheduler.parallelism=16

# 最大并行度上限
-Djdk.virtualThreadScheduler.maxPoolSize=256

# 最小活跃 Carrier 数（发生 pinning 时新增）
-Djdk.virtualThreadScheduler.minRunnable=1
```

生产环境几乎不需要动这些参数——默认值已经是"CPU 核数"，这也是**平台线程池 IO 密集配置的经验值 `2 × N_CPU` 都被虚拟线程重新定义**的原因：CPU 核数由 Carrier 决定，与 VT 数量无关。

### 2.4 创建虚拟线程的四种方式

| 方式 | 场景 | 特点 |
| :-- | :-- | :-- |
| `Thread.startVirtualThread(runnable)` | 一次性异步任务 | 最简洁，立即启动 |
| `Thread.ofVirtual().name(...).start(runnable)` | 需要命名、异常处理器 | 通过 builder 配置 |
| `Executors.newVirtualThreadPerTaskExecutor()` | 替换现有 `ExecutorService` | 兼容既有代码 |
| `StructuredTaskScope`（§12.5） | 有生命周期约束的子任务组 | 结构化并发入口 |

```java
// 场景 1：一次性任务
Thread.startVirtualThread(() -> log.info("hello vt"));

// 场景 2：需要配置
Thread vt = Thread.ofVirtual()
    .name("order-worker-", 0)          // "order-worker-0"
    .uncaughtExceptionHandler((t, e) -> log.error("vt failed", e))
    .start(() -> processOrder(id));

// 场景 3：替换线程池
try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Request req : requests) {
        pool.submit(() -> handle(req));
    }
}   // try-with-resources 自动等待所有任务完成
```

**注意 `newVirtualThreadPerTaskExecutor` 的语义**：它不是"共享一批固定 Carrier 的池"，而是"每提交一个任务就新起一条虚拟线程"。它更接近 `newCachedThreadPool`，但没有创建上限——因为 VT 本身就是廉价的。

## 3. pinning：`synchronized` 造成的钉住问题

### 3.1 什么是 pinning

虚拟线程遇到阻塞点时，JVM 应当把它从 Carrier 卸载下来，让 Carrier 空出手服务别的 VT。但在两种情况下卸载会失败——这条 VT 被"钉"在了 Carrier 上，直到阻塞返回。这种现象叫 **pinning**。

被钉住时的现场：

```text
虚拟线程 VT1 持有 monitor lock，进入 synchronized 块 → 挂载在 Carrier C1
                                    │
                                    │  发起 HTTP 请求，等待响应
                                    ▼
    正常情况：VT1 应该被卸载，C1 去跑其他 VT
    pinning：VT1 卡在 C1 上，C1 无法离开
    后果：VT1、C1 一起等 HTTP 响应；期间其他 VT 少一条可用 Carrier
```

如果 Carrier 池只有 8 条，且业务大量使用 `synchronized` 包裹阻塞 IO，8 条 Carrier 全部被钉死之后，虚拟线程的调度就彻底退化为传统线程池——**看上去有百万虚拟线程，实际吞吐还不如一个配置合理的固定线程池**。

### 3.2 造成 pinning 的两类场景

| 场景 | 原因 | JDK 21 表现 | JDK 24 表现 |
| :-- | :-- | :-- | :-- |
| `synchronized` 块内执行阻塞 IO | monitor 与 Carrier 强绑定，无法搬走栈帧 | 钉住 | 已修复（JEP 491） |
| 本地方法（JNI）内阻塞 | JVM 无法感知 native 栈帧 | 钉住 | 仍钉住 |

JDK 21–23 里 `synchronized` 是 pinning 的最大来源。JDK 24（2025-03）通过 JEP 491 让 `synchronized` 也能挂起虚拟线程，问题才被彻底解决。但生产环境很多团队仍停留在 JDK 21 LTS，因此这个问题短期内仍需处理。

### 3.3 迁移建议：从 synchronized 到 ReentrantLock

```java
// ❌ JDK 21 下会 pinning
public class OrderService {
    private final Object lock = new Object();

    public void update(String id) {
        synchronized (lock) {
            httpClient.send(request);   // 阻塞 IO，VT 被钉在 Carrier 上
            db.write(id);
        }
    }
}
```

```java
// ✅ 用 ReentrantLock 替换：VT 会正常卸载
public class OrderService {
    private final ReentrantLock lock = new ReentrantLock();

    public void update(String id) {
        lock.lock();
        try {
            httpClient.send(request);   // VT 阻塞时被卸载，Carrier 空闲
            db.write(id);
        } finally {
            lock.unlock();
        }
    }
}
```

`ReentrantLock` 底层通过 `LockSupport.park` 挂起，而 `park` 是 JVM 感知的 yield 点，所以不会 pinning。**如果无法确保运行在 JDK 24+，虚拟线程场景下 `synchronized` + 阻塞 IO 的组合应当被视为反模式**。

### 3.4 pinning 的检测手段

生产环境常用三条路径：

```bash
# 1. 启动参数：VT 一旦 pinning 就打印栈
-Djdk.tracePinnedThreads=short   # 只打印栈顶
-Djdk.tracePinnedThreads=full    # 打印完整栈

# 2. JFR 事件
jcmd <pid> JFR.start settings=profile
# 事件名: jdk.VirtualThreadPinned

# 3. 线程快照
jcmd <pid> Thread.dump_to_file -format=json /tmp/vt-dump.json
# 输出中 state=RUNNABLE 且 carrier != null 的 VT 值得关注
```

`jdk.tracePinnedThreads=short` 的输出片段示例：

```text
Thread[#42,ForkJoinPool-1-worker-3,5,CarrierThreads]
    java.base/java.net.Socket.connect(Socket.java:...)
    <monitors:>
    - java.lang.Object@0x00000007c0a01234
```

`<monitors:>` 后列出的 monitor 就是钉住的元凶。

## 4. 何时不要用虚拟线程

虚拟线程不是万能替代。以下四种场景下，平台线程仍然是更好的选择。

### 4.1 CPU 密集任务

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

### 4.2 需要严格限流的场景

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

### 4.3 `ThreadLocal` 密集使用的路径

虚拟线程完全支持 `ThreadLocal`（在第 3 章讨论过它的存储结构）。但在 VT 场景下要提防一件事：**百万级 VT × 每 VT 若干 TL 值 = 内存爆炸**。

举例：一个请求链路挂了 10 个 TL 值，每个值 1 KB。平台线程模型下同时活跃线程 2 000 条，占 20 MB；虚拟线程模型下同时活跃 200 000 条 VT，占 2 GB。

应对方向：

- 优先使用 `ScopedValue`（JDK 21 预览，JDK 23 二次预览）替代只在方法调用链里用的 `ThreadLocal`
- 拆分 TL：只把真正需要跨方法透传的东西放进 TL，其余通过参数传递
- 关键路径改造完之前，用 `-XX:NativeMemoryTracking` 观察堆外增长

### 4.4 依赖平台线程语义的库

少量库依赖 `Thread` 的平台线程语义，例如：

- 通过 `Thread.currentThread().getContextClassLoader()` 做类隔离的框架
- 依赖 OS 线程亲和性（thread affinity）的高性能库
- 用 `Thread` 的堆栈作为标识做 profiling 的工具

对这些场景，如果切到虚拟线程后行为异常，最保险的做法是：**入口保持平台线程，把 IO 密集部分显式提交到 `newVirtualThreadPerTaskExecutor`**。

## 5. 结构化并发：`StructuredTaskScope`

### 5.1 传统 fire-and-forget 的问题

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

### 5.2 结构化并发的核心约束

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

### 5.3 两种收敛策略

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

### 5.4 超时与取消

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

### 5.5 API 稳定性提示

`StructuredTaskScope` 在 JDK 21 是 preview（第一轮），JDK 22–24 经过多轮 preview，**JDK 25 正式 GA，API 名称有小幅调整**（例如 `ShutdownOnFailure` 变为 `Joiner.awaitAllSuccessfulOrThrow()` 风格）。生产使用时以目标 JDK 版本的 JEP 为准。

## 6. 虚拟线程时代重新评估线程池

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

## 7. 一段完整示例：从传统 API 迁移到虚拟线程

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

## 8. 本章小结

| 问题 | 根源 | 解决方案 |
| :-- | :-- | :-- |
| 平台线程数量受硬限制 | OS 1:1 模型 + 上下文切换成本 | 虚拟线程的 M:N 调度 |
| Reactor 代码断裂、调试困难 | 异步链式编程范式 | 同步风格的虚拟线程 |
| `synchronized` 阻塞 IO 让 Carrier 被钉死 | JDK 21–23 的实现限制 | 迁移到 `ReentrantLock` 或升级 JDK 24+ |
| CPU 密集任务用虚拟线程无收益 | Carrier 数量仍受 CPU 核数限制 | CPU 密集仍用平台线程池 |
| 无天然背压导致下游被打挂 | `newVirtualThreadPerTaskExecutor` 无并发上限 | 外挂 `Semaphore` 或专用限流器 |
| 子任务派生后失控、异常传播复杂 | 平面式的 `Future` 组合 | `StructuredTaskScope` 结构化并发 |

> **纵横联系**
>
> - **向前依赖**：第 2 章的 1:1 线程模型是本章 M:N 调度的对照起点；第 8 章 `LockSupport.park` 是 VT 卸载的技术底座；第 3 章 `ThreadLocal` 的存储结构解释了 VT 场景下"每 VT 独立 TLM"的内存代价。
> - **向后使用**：第 13 章诊断章会介绍 VT 特有的排查工具（`-Djdk.tracePinnedThreads`、`jcmd Thread.dump_to_file` 的 JSON 输出、JFR 的 `VirtualThreadPinned` 事件）。
> - **跨卷关系**：第四卷网络与通信中 Netty / Reactor 的设计前提在虚拟线程时代被重新讨论；第六卷 Spring MVC 从 6.1、Tomcat 从 10.1 起支持将 VT 作为请求处理线程；第七卷高并发架构中"接入层线程模型选型"直接引用本章结论。
