# 异步编程：从 `Future` 到 `CompletableFuture`

> 有了线程池，也有了 `Future`，为什么 Java 8 还要再加一个 `CompletableFuture`？异步链条上，任务到底跑在哪条线程上？异常又是从哪一段冒出来的？

`Future` 让 Java 在 2004 年拿到了"未来取值"的能力，`CompletableFuture` 在 2014 年补齐了"未来编排"的能力。这中间隔的十年，是异步编程从"能做"到"好用"的十年。这一章聚焦这两者的语义边界、线程归属和最容易踩的坑；响应式和 Actor 只以速览形式出现，主体分别归第四卷网络与通信、第七卷性能与架构。

## 1. `Future` 的三个致命局限

### 1.1 有结果，但只能靠阻塞取

`Future` 是 Java 5 引入的第一代异步结果承载：

```java
ExecutorService pool = Executors.newFixedThreadPool(4);
Future<String> f = pool.submit(() -> queryDB());

String r = f.get();     // 主线程在这里被阻塞
```

`submit` 返回得很快，但 `get()` 必须阻塞——线程要么盯着结果原地等，要么就得自己写 `isDone()` 轮询。"异步执行 + 同步等待"这条路走下去，异步只是名义上的异步。

### 1.2 没有回调通道

`Future` 上没有一个能挂"结果就绪后自动做点什么"的钩子。想让下一步逻辑在结果就绪时被"推"到手上，只有两条歪路：

- 循环 `isDone()` + `sleep`——把 CPU 烧完
- 起一条新线程调 `get()`——把线程池耗完

不能被通知，就没法把多个异步操作拼成一条流水线。

### 1.3 组合的成本是嵌套

想表达"A 完成后基于 A 的结果做 B、再基于 B 做 C"，用 `Future` 只能这样写：

```java
Future<String> a = pool.submit(() -> queryA());
Future<String> b = pool.submit(() -> {
    String aResult = a.get();            // 在池内线程上阻塞
    return queryB(aResult);
});
Future<String> c = pool.submit(() -> {
    String bResult = b.get();            // 又阻塞一次
    return queryC(bResult);
});
```

问题成堆：**池内线程被 `get()` 卡住**（可能死锁）、**代码嵌套逐层加深**、**异常传播需要手工写 `try/catch/ExecutionException` 每一层**。

三个短板加起来的结论：`Future` 只解决了"能拿到异步返回值"，没解决"用得起来"。`CompletableFuture` 就是补这三个洞。

## 2. `CompletableFuture` 的两组 API

### 2.1 API 全景：只有两条主线

`CompletableFuture` 方法数看着吓人，但都是围绕两件事：**单个 Future 上做转换** 和 **多个 Future 之间做合并**。抓住这两条主线，其余方法都是变体。

### 2.2 转换：单输入 → 单输出

| 方法 | 输入 | 输出 | 语义 |
| :-- | :-- | :-- | :-- |
| `thenApply(fn)` | `T → R` | `CF<R>` | 同步转换 |
| `thenCompose(fn)` | `T → CF<R>` | `CF<R>` | 扁平化异步（避免 `CF<CF<R>>`） |
| `thenAccept(cons)` | `T → void` | `CF<Void>` | 消费结果 |
| `thenRun(runnable)` | 忽略结果 | `CF<Void>` | 只关心"完成了" |

关键区别：`thenApply` 用于"结果 → 新值"，`thenCompose` 用于"结果 → 新的异步任务"。对应函数式语言里的 `map` 和 `flatMap`。混用会得到嵌套的 `CompletableFuture<CompletableFuture<R>>`——一层多余。

```java
// ❌ 用 thenApply 处理返回 CF 的函数，得到嵌套
CompletableFuture<CompletableFuture<Order>> bad =
    findUser(id).thenApply(user -> findOrder(user));    // findOrder 返回 CF

// ✅ 用 thenCompose 扁平化
CompletableFuture<Order> good =
    findUser(id).thenCompose(user -> findOrder(user));
```

### 2.3 合并：多个输入 → 单输出

| 方法 | 输入 | 语义 |
| :-- | :-- | :-- |
| `thenCombine(other, bi)` | 两个 CF | 都完成后合并两个结果 |
| `allOf(cf...)` | N 个 CF | 全部完成后触发（返回 `CF<Void>`） |
| `anyOf(cf...)` | N 个 CF | 任一完成后触发（返回 `CF<Object>`） |

`allOf` 返回 `Void`——想拿到各个 CF 的结果，还得在完成后手动 `join` 每一个。这是初学者最容易忽视的一处：

```java
CompletableFuture<User>  fu = findUser(id);
CompletableFuture<Order> fo = findOrder(id);
CompletableFuture<Cart>  fc = findCart(id);

// ❌ allOf 只告诉你"全部完成"，不给你结果
CompletableFuture<Void> all = CompletableFuture.allOf(fu, fo, fc);
all.join();     // 拿不到 user / order / cart

// ✅ 完成后自己 join 每个
CompletableFuture<Profile> profile = all.thenApply(v ->
    new Profile(fu.join(), fo.join(), fc.join())    // 此时都已完成，join 立即返回
);
```

### 2.4 一条真实的异步流水线

用户查询 → 订单列表 → 每单查物流 → 汇总：

```java
CompletableFuture<String> pipeline =
    findUser(id)                                    // 第 1 步
        .thenCompose(u -> findOrders(u))            // 第 2 步：等第 1 步
        .thenCompose(orders -> {                    // 第 3 步：并行查物流
            List<CompletableFuture<String>> fs = orders.stream()
                .map(o -> findTracking(o))
                .toList();
            return CompletableFuture
                .allOf(fs.toArray(new CompletableFuture[0]))
                .thenApply(v -> fs.stream()
                    .map(CompletableFuture::join)
                    .collect(Collectors.joining(", ")));
        });

String result = pipeline.join();
```

三步的时间线：

```text
时间 →
[findUser 100ms] → [findOrders 150ms] → [findTracking 并行 80ms]
                                          ├─ ORD-001 80ms
                                          └─ ORD-002 80ms
总耗时 ≈ 330ms（串行需要 100 + 150 + 80 × 2 = 410ms）
```

`thenCompose` 用于串行依赖，`allOf + join` 用于扇出并行——两者组合就能表达大部分业务流水线。

## 3. 执行线程之谜

`thenApply`、`thenApplyAsync`、传 Executor 与不传 Executor——**到底跑在哪条线程上**是 `CompletableFuture` 最让人迷惑的一处。

### 3.1 三种触发方式

| 写法 | 执行线程 |
| :-- | :-- |
| `thenApply(fn)` | 谁完成上一个 CF，谁执行 `fn`（可能是提交线程，也可能是上一个 stage 的线程） |
| `thenApplyAsync(fn)` | 提交到 `ForkJoinPool.commonPool` |
| `thenApplyAsync(fn, executor)` | 提交到指定的 `executor` |

**同步版本 `thenApply` 的"急切执行"**：如果上一个 CF 在调用 `thenApply` 时已经完成，回调**立即在当前线程运行**——不再是异步。这是很多"看起来应该异步、实际在业务线程上跑了阻塞任务"的根源。

### 3.2 `commonPool` 的默认坑

`supplyAsync(fn)` / `thenApplyAsync(fn)` 不传 executor 时，默认走 `ForkJoinPool.commonPool()`（第 10 章 §10.7.2 讨论过）。这个池全局共享，线程数 = `CPU 核数 - 1`。

```java
// ❌ 阻塞 IO 塞进 commonPool：一整个 JVM 的 CompletableFuture / parallelStream 陪葬
CompletableFuture.supplyAsync(() -> httpClient.get(url));

// ✅ 阻塞任务用独立线程池
ExecutorService ioPool = new ThreadPoolExecutor(
    20, 40, 60, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(200),
    new NamedThreadFactory("io"),
    new ThreadPoolExecutor.CallerRunsPolicy());

CompletableFuture.supplyAsync(() -> httpClient.get(url), ioPool);
```

一条生产规则：**除非任务是纯 CPU 计算且短，否则永远显式传 Executor**。这条规则在 §11.5 会再出现一次。

### 3.3 `Async` 变体的选型

看到方法名带 `Async` 后缀就要问自己两个问题：

- **上一个 stage 的执行线程是否适合承担这一步？** 不适合就用 `Async` 换线程
- **需要指定线程池吗？** 需要就传 executor，不传的默认落在 `commonPool`

```java
// 假设 dbPool 用于数据库、cpuPool 用于计算
CompletableFuture
    .supplyAsync(() -> queryDB(id), dbPool)                // 明确用 dbPool
    .thenApplyAsync(this::heavyCompute, cpuPool)           // 换到 cpuPool 计算
    .thenAccept(this::logResult);                          // 同步：谁完成 heavyCompute 就谁记日志
```

这种"每一步都在合适的池上"的写法，是 `CompletableFuture` 在生产环境里的默认姿势。

## 4. 异常传播的三条路径

### 4.1 传播规则

**异常沿着链条向后透传**：链条中任何一步失败，后续所有 stage 都会跳过正常回调，一路走到最近的一个能"截住"异常的方法。截住的方法有三个：`exceptionally` / `handle` / `whenComplete`。

### 4.2 三个方法的差异

| 方法 | 能感知异常 | 能替换结果 | 触发时机 |
| :-- | :-- | :-- | :-- |
| `exceptionally(fn)` | ✅ | ✅ 异常时给出替代值 | 只在上游异常时执行 |
| `handle(bi)` | ✅ | ✅ 正常和异常都能替换 | 无论上游正常还是异常都执行 |
| `whenComplete(bi)` | ✅ | ❌ 只做副作用，不改变结果 | 正常和异常都执行 |

```java
future
    .thenApply(this::riskyStep)
    // 只关心异常：给个默认值
    .exceptionally(ex -> {
        log.warn("failed, use default", ex);
        return "default";
    });

future
    .thenApply(this::riskyStep)
    // 统一处理正常/异常：能改结果
    .handle((result, ex) -> {
        if (ex != null) return "fallback";
        return result.toUpperCase();
    });

future
    .thenApply(this::riskyStep)
    // 打日志 / 释放资源，不改变结果
    .whenComplete((result, ex) -> {
        if (ex != null) log.error("failed", ex);
        span.finish();
    });
```

### 4.3 异常在链条中的形状

异常传播路径上，异常会被包装成 `CompletionException`（`get()` 时是 `ExecutionException`）：

```text
supplyAsync ──▶ thenApply ──▶ thenApply ──▶ ...
     │                                       │
     │       抛 IOException                  │
     └──────────┬──────────────────────────┘
                │
                ▼
        包装成 CompletionException
                │
                ▼
        跳过后续 thenApply，直到 exceptionally / handle
```

因此从 `exceptionally` 拿到的 `ex` 通常是 `CompletionException`，真正的业务异常在 `ex.getCause()` 里。写异常处理时如果不 unwrap，日志和监控上会全部显示成 `CompletionException`，看不到真正的原因。

### 4.4 超时保护（JDK 9+）

JDK 9 起 `CompletableFuture` 支持异步超时，不再需要外挂 `ScheduledExecutorService`：

```java
future
    .orTimeout(3, TimeUnit.SECONDS)                       // 超时抛 TimeoutException
    .completeOnTimeout("fallback", 3, TimeUnit.SECONDS);  // 超时返回默认值
```

`orTimeout` 会把超时以异常方式注入链条，走 `exceptionally/handle`；`completeOnTimeout` 直接给出替代值，链条继续。生产上一般组合使用：先 `orTimeout` 触发超时，再 `exceptionally` 决定降级方案。

## 5. 常见反模式

线上 `CompletableFuture` 的 bug 高度集中在这五种模式上。

### 5.1 链尾忘记 `.join()`

```java
// ❌ 链末端没人消费，任务被 GC 掉
CompletableFuture.supplyAsync(() -> queryDB(id))
    .thenAccept(this::process);
// 方法返回，没有引用了

// ✅ 保留返回值或显式等待
CompletableFuture<Void> f = CompletableFuture
    .supplyAsync(() -> queryDB(id))
    .thenAccept(this::process);
f.join();
```

`CompletableFuture` 本身不保证任务一定被执行到底——只要没人引用它，也没人等它，JVM 完全可以回收。生产上表现是"任务提交了，日志里也没报错，就是从没执行过"。

### 5.2 在回调里做阻塞 IO

```java
// ❌ commonPool 里塞阻塞 IO
CompletableFuture.supplyAsync(this::queryDB)
    .thenApply(user -> httpClient.get(user.avatarUrl()))  // 阻塞！还在 commonPool 上
    .thenAccept(this::save);
```

`thenApply` 的回调很可能在 `commonPool` 上执行（详见 §11.3.1）。阻塞 IO 占死 commonPool 后，同 JVM 内的 `parallelStream`、其他 `CompletableFuture` 全部卡住。**含阻塞的 stage 必须用 `xxxAsync(fn, executor)` 换到专用池**。

### 5.3 未指定 Executor

跨业务共享 `commonPool` 会把彼此的问题传染开来。生产规则：**所有异步 stage 都显式传 executor**。规则本身简单，难在团队养成习惯——一个人图省事写了 `supplyAsync(fn)`，就能拖垮整个 JVM 里的其他 stage。

### 5.4 混用 `get()` 与 `join()`

两者行为几乎一样，但异常类型不同：

| 方法 | 检查异常 | 未检查异常包装 |
| :-- | :-- | :-- |
| `get()` | `throws InterruptedException, ExecutionException` | 业务异常包在 `ExecutionException.getCause()` 里 |
| `join()` | 不抛检查异常 | 业务异常包在 `CompletionException.getCause()` 里 |

Stream 里用 `.map(CompletableFuture::join)` 是标准写法（不能用 `.map(CompletableFuture::get)`——检查异常无法穿过 lambda）。异常处理时要记住 `join()` 拿到的是 `CompletionException`，`get()` 拿到的是 `ExecutionException`——两者都需要 `.getCause()`。

### 5.5 `allOf` 后忘记 `join` 各个 CF

```java
// ❌ allOf 完成不代表你已经把结果拿在手上
CompletableFuture.allOf(fu, fo, fc).thenApply(v -> new Profile(...));
// 传参的时候 fu/fo/fc 用了吗？没有——拿到的 Profile 是空的
```

`allOf` 的语义是"全部完成"，不是"结果汇集"。汇集必须自己在 `thenApply` 里 `join` 每个 CF（此时都已完成，`join` 立即返回，不再阻塞）。这一步漏掉是 `CompletableFuture` 上最容易写错的一处。

## 6. 其他并发范式：只点名思想

`CompletableFuture` 解决的是"单值异步 + 编排"。生产上还有两类相邻范式，它们的主体归其他卷：

### 6.1 响应式编程（详见第四卷）

- **模型**：`Publisher` / `Subscriber` / `Subscription` / `Processor`（JDK 9 的 `java.util.concurrent.Flow`；主流实现 Reactor、RxJava）
- **核心能力**：数据**流**（而非单值），**背压**（`onBackpressureBuffer` / `Drop` / `Latest` / `Error`），**冷流 / 热流**
- **和 `CompletableFuture` 的关系**：`CompletableFuture` = 单值 + 一次；响应式流 = 多值 + 持续
- **完整机制**：Publisher/Subscriber 协议、`request(n)` 拉取语义、`Scheduler` 与非阻塞 IO 的绑定，全部在第四卷 Netty / NIO 章节展开

一句话结论：**业务里只是"异步取一次结果 + 编排"，不必上响应式**；真的需要流处理、背压、事件驱动的场景，第四卷会给完整答案。

### 6.2 Actor 模型（详见第七卷）

- **核心思想**：不共享状态，只传消息。每个 Actor 有独立邮箱，串行处理消息，天然无锁
- **能力项**：监督策略（`Resume` / `Restart` / `Stop` / `Escalate`）、位置透明（本地和远程 Actor 用同一 API 调用）、事件溯源
- **代表**：Akka（Scala 主导，Java API 完整）
- **主要场景**：分布式系统、聊天/游戏这类"多个独立实体"的天然模型、事件驱动架构

Actor 与前述所有模型的分野在**编程思维**：从"共享内存 + 加锁"切换到"消息传递 + 无共享"。这个思维底座与分布式系统的一致性、CAP 直接相关，因此完整讨论放在第七卷。

### 6.3 四种模型的选型速览

| 模型 | 适合场景 | 本卷 / 卷号 |
| :-- | :-- | :-- |
| 线程 + 锁 | CPU 密集、简单并发 | 本卷 §6 / §8 |
| `CompletableFuture` | 单值异步 + 编排、微服务扇出 | 本章 |
| 响应式流 | 高并发 IO、流处理、背压 | 第四卷 |
| 虚拟线程 | 大量阻塞 IO、同步风格代码 | 本卷第 12 章 |
| Actor | 分布式系统、事件驱动、高容错 | 第七卷 |

选型的一条起手线：**能用同步风格 + 虚拟线程解决的场景，就不要引入响应式或 Actor**（第 12 章给了理由）。剩下真正需要流处理和分布式容错的场景，再各自展开。

## 7. 本章小结

| 问题 | 根源 | 解决方案 |
| :-- | :-- | :-- |
| `Future.get()` 阻塞 | `Future` 只提供拉取通道 | `CompletableFuture` 提供回调 |
| 异步任务无法组合 | 缺少链式 API | `thenApply` / `thenCompose` / `thenCombine` |
| 得到 `CF<CF<R>>` 嵌套 | `thenApply` 用错 | 改 `thenCompose` |
| `allOf` 后拿不到各自结果 | `allOf` 返回 `Void` | 手动 `join` 每个 CF |
| 阻塞 IO 拖垮 `commonPool` | 默认走 `ForkJoinPool.commonPool` | 显式传 executor |
| 链尾任务从未执行 | 链末端没人 `join` | 保留引用或显式等待 |
| 异常总是显示成 `CompletionException` | 未 unwrap `getCause()` | 处理异常时取 `ex.getCause()` |
| 异步超时 | JDK 9 之前没原生 API | `orTimeout` / `completeOnTimeout` |
