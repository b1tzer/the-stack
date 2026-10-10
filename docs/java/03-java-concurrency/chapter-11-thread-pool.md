# 线程池：任务调度的核心引擎

> `ThreadPoolExecutor` 的七个参数如何互相牵制？`Executors` 提供的四个工厂方法隐含了哪些默认容量？队列满了、线程也满了，任务到底会去哪？

线程池会直接影响容量、延迟和故障隔离。参数与任务形态不匹配时，可能造成任务积压、资源耗尽或拒绝。本章从“为什么使用线程池”讲到“如何按负载选择参数”，重点给出条件和验证方法。

## 1. 无限制创建线程为什么行不通

### 1.1 每来一个请求 `new Thread`：三笔账

```java
// ❌ 每个请求现场造线程
new Thread(() -> handle(request)).start();
```

低并发下这段代码正确，高并发下会因为三笔账全部失败：

- **栈内存**：常见配置下每条平台线程预留约 1 MB 栈（`-Xss`），10 000 条线程按该参数粗算约 10 GB 虚拟地址；实际提交量依平台和参数而变
- **内核调度**：`task_struct` + 内核栈 + 调度器条目，每条几 KB，且都在内核态
- **上下文切换**：线程数一旦远大于 CPU 核数，切换成本会吃掉大部分 CPU 时间

线程数是"资源的一种"，不该由请求量随手挥霍。真正压死系统的往往不是单条线程的开销，而是**吞吐坍塌的正反馈**：

```txt
线程数增加 → 每个线程分到的 CPU 时间片变短 →
CPU 更多时间用于切换 → 请求 RT 变长 →
上游超时重试 → 更多请求进来 → 需要更多线程
```

一旦进入这个循环，靠加机器已经追不上。

### 1.2 线程池要解决的问题

线程池给出三样能力：

- **复用**：一条线程执行完一个任务，回到池里等下一个，不销毁
- **限流**：线程数是有上限的，系统资源被封在这个上限里
- **可观测**：入队、拒绝、活跃线程数都有 API 能看到

```java
ExecutorService pool = new ThreadPoolExecutor(
    10, 20, 60, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(500),
    new NamedThreadFactory("order"),
    new ThreadPoolExecutor.CallerRunsPolicy()
);
pool.submit(() -> handle(request));
```

一行 `submit` 背后，线程池已经决定了：新任务应该由核心线程执行、还是入队、还是新起一条非核心线程、还是走拒绝策略。§3.1 会把这个决策过程剖开来看。

## 2. `ThreadPoolExecutor` 的七个参数

### 2.1 参数清单

```java
public ThreadPoolExecutor(
    int corePoolSize,                    // 核心线程数
    int maximumPoolSize,                 // 最大线程数
    long keepAliveTime, TimeUnit unit,   // 非核心线程空闲存活
    BlockingQueue<Runnable> workQueue,   // 等待队列
    ThreadFactory threadFactory,         // 线程创建工厂
    RejectedExecutionHandler handler     // 拒绝策略
)
```

| 参数 | 含义 |
| :-- | :-- |
| `corePoolSize` | 核心线程数。默认即使空闲也不会回收，除非显式 `allowCoreThreadTimeOut(true)` |
| `maximumPoolSize` | 线程数上限。核心线程 + 非核心线程之和不超过此值 |
| `keepAliveTime` / `unit` | 非核心线程空闲多久后被回收 |
| `workQueue` | 核心线程都在忙时，新任务进的等待队列 |
| `threadFactory` | 创建线程的工厂：命名、守护线程标志、`UncaughtExceptionHandler` 都在这里定 |
| `handler` | 队列满且线程数已达上限时的处理器 |

七个字段中，只有五个是真正的独立开关（`unit` 只是给 `keepAliveTime` 加单位；`threadFactory` 影响可观测性但不影响调度）。真正决定线程池行为的核心是 **`corePoolSize` / `maximumPoolSize` / `workQueue` / `handler`** 这四项——它们互相牵制，改任何一个都会连带影响另外三个。

### 2.2 四项主开关的耦合关系

![任务进入线程池后依次判断核心线程、工作队列和最大线程数的流程](/java/pool-execute-flow.svg)

**这个流程决定了一件反直觉的事：只有队列先"装不下"，才可能创建非核心线程**。也就是说，把 `workQueue` 换成无界队列，等于让 `maximumPoolSize` 形同虚设——见 §5.2。

## 3. 任务流转的完整状态机

### 3.1 `execute()` 的四步决策

`ThreadPoolExecutor.execute` 的核心逻辑（简化）：

```java
public void execute(Runnable command) {
    int c = ctl.get();

    // 第 1 步：线程数 < corePoolSize，直接建核心线程
    if (workerCountOf(c) < corePoolSize) {
        if (addWorker(command, true)) return;
        c = ctl.get();
    }

    // 第 2 步：核心线程满，尝试入队
    if (isRunning(c) && workQueue.offer(command)) {
        int recheck = ctl.get();
        // 入队后要重新校验，避免入队瞬间线程池被关闭
        if (!isRunning(recheck) && remove(command))
            reject(command);
        else if (workerCountOf(recheck) == 0)
            addWorker(null, false);   // 兜底：一条工作线程都没了要重建
    }

    // 第 3 步：队列满，尝试建非核心线程
    else if (!addWorker(command, false))
        reject(command);              // 第 4 步：线程也满了，走拒绝
}
```

四条路径映射到 §2.2 的图。这里有一个容易漏掉的细节：**入队之后要 double-check**。因为提交和 `shutdown` 是并发的，入队瞬间线程池可能刚好被关。`workerCountOf(recheck) == 0` 那一段则是防御另一种边缘情况——所有 Worker 都异常终止后，队列里还有任务，得补一条兜底 Worker 来消费它。

### 3.2 Worker 的生命周期

`Worker` 就是"承担任务执行"的那条线程。它的循环骨架是：

![核心线程、队列和非核心线程的创建顺序](/java/pool-worker-create.svg)

`allowCoreThreadTimeOut(true)` 会让核心线程也走带超时的 `poll`——适合"深夜没流量"的应用，代价是流量突增时需要重新预热线程。

### 3.3 一份合规的手写线程池

```java
ThreadPoolExecutor pool = new ThreadPoolExecutor(
    5, 20,                             // core / max
    60, TimeUnit.SECONDS,              // 非核心存活
    new ArrayBlockingQueue<>(500),     // 有界队列（关键！）
    new NamedThreadFactory("order"),   // 自定义命名（关键！）
    new ThreadPoolExecutor.CallerRunsPolicy()   // 明确拒绝策略
);
```

有界队列 + 明确拒绝策略 + 可辨识的线程名——这三条是 §5 反复强调的红线。

## 4. 四种拒绝策略

`RejectedExecutionHandler` 只有一个方法：`rejectedExecution(Runnable r, ThreadPoolExecutor e)`。JDK 内置四种实现，行为差异明显。

### 4.1 四种策略的行为

| 策略 | 行为 | 用途 |
| :-- | :-- | :-- |
| `AbortPolicy`（默认） | 抛 `RejectedExecutionException` | 必须让上游感知过载 |
| `CallerRunsPolicy` | 由提交任务的调用线程自己执行 | 天然反压，绝不能丢的场景 |
| `DiscardPolicy` | 静默丢弃当前任务，不抛异常 | 可容忍丢失（如埋点日志） |
| `DiscardOldestPolicy` | 丢弃队首最老的任务，再重试提交当前任务 | 新任务比旧任务更重要 |

关键源码：

```java
// CallerRunsPolicy
public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
    if (!e.isShutdown()) r.run();     // 注意是 run()，不是 start()
}

// DiscardOldestPolicy
public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
    if (!e.isShutdown()) {
        e.getQueue().poll();          // 丢队首
        e.execute(r);                 // 重试提交
    }
}
```

### 4.2 `CallerRunsPolicy` 的反压效应

`CallerRunsPolicy` 是这四种里最有意思的一种——它把过载压力**反推给上游**：

![队列已满时线程池按拒绝策略处理新任务的流程](/java/pool-reject-flow.svg)

这在"绝不能丢任务、也不允许无界排队"的场景里非常有用。代价是调用线程会被临界任务卡住一段时间——如果调用线程本身是 Tomcat 的请求处理线程，这段时间它无法响应新请求。

### 4.3 自定义拒绝策略：加计数

生产上通常在 JDK 四种之上再包一层做**过载计数**：

```java
public class CountingCallerRunsPolicy implements RejectedExecutionHandler {
    private final Counter counter;    // 接监控系统

    @Override
    public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
        counter.increment();          // 每次过载记一次
        if (!e.isShutdown()) r.run();
    }
}
```

没有过载计数时，"线程池够不够用"只能靠经验推断；接入监控后，`rejected 数 > 0` 直接触发告警。

## 5. `Executors` 工厂方法的陷阱

`Executors.newFixedThreadPool` / `newCachedThreadPool` / `newSingleThreadExecutor` / `newScheduledThreadPool` 都是一行代码就能造出线程池。它们适合示例、小型工具和容量已知且可接受默认策略的场景；服务端高负载路径应根据积压和隔离目标显式配置容量。

### 5.1 一览表

| 工厂方法 | 内部参数 | 主要风险 |
| :-- | :-- | :-- |
| `newFixedThreadPool(n)` | core=max=n，`LinkedBlockingQueue`（无界） | 任务积压持续增长，极端情况下可能耗尽堆内存 |
| `newSingleThreadExecutor()` | core=max=1，`LinkedBlockingQueue`（无界） | 单 worker 跟不上时，任务可能持续积压 |
| `newCachedThreadPool()` | core=0, max=`Integer.MAX_VALUE`, `SynchronousQueue` | 高并发下可能创建大量线程并耗尽原生资源 |
| `newScheduledThreadPool(n)` | core=n, max=`Integer.MAX_VALUE`, `DelayedWorkQueue`（无界） | 定时任务失败或积压时缺少容量边界 |

### 5.2 `LinkedBlockingQueue` 默认无界为什么可能失控 {#unbounded-work-queue}

看看 `newFixedThreadPool` 的实现：

```java
public static ExecutorService newFixedThreadPool(int n) {
    return new ThreadPoolExecutor(n, n, 0L, TimeUnit.MILLISECONDS,
                                  new LinkedBlockingQueue<Runnable>());
}
```

`LinkedBlockingQueue()` 无参构造的容量是 `Integer.MAX_VALUE`——20 亿级容量，等于**不设上限**。

代入 §2.2 的流程图：核心线程满 → 入队 → 队列未满时走不到“创建非核心线程”这一步。`maximumPoolSize` 因为等于 `corePoolSize` 本来也不会生效；当提交速率持续高于处理速率时，任务会在队列和堆中持续累积，最终可能造成 GC 压力、延迟超限或 `OutOfMemoryError`。

### 5.3 `newCachedThreadPool` 的另一头出口

```java
public static ExecutorService newCachedThreadPool() {
    return new ThreadPoolExecutor(0, Integer.MAX_VALUE,
                                  60L, TimeUnit.SECONDS,
                                  new SynchronousQueue<Runnable>());
}
```

`SynchronousQueue` 是零容量的“传递型”队列——**入队必须有一个消费者同时等待才成功**。§2.2 的流程图代入：没有空闲 worker 时，核心线程 0，`workQueue.offer` 失败，于是走到“创建非核心线程”，而这一步的上限是 `Integer.MAX_VALUE`。

如果空闲 worker 不足，任务到来就可能创建新的线程；当并发同时达到 10 000 且没有 worker 可复用时，就可能创建 10 000 条线程，按每条 1 MB 栈估算约为 10 GB 虚拟地址空间。最终可能触发 `OutOfMemoryError: unable to create native thread`，但是否发生取决于平台、线程栈配置和并发峰值。

### 5.4 手写线程池的默认姿势

```java
// ❌ 默认队列容量与拒绝策略不适合这里的服务目标
ExecutorService pool = Executors.newFixedThreadPool(10);

// ✅ 按本场景显式配置容量、线程名和拒绝策略
ThreadPoolExecutor pool = new ThreadPoolExecutor(
    10, 20, 60, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(500),         // 有界队列
    new NamedThreadFactory("order"),        // 可辨识线程名
    new ThreadPoolExecutor.CallerRunsPolicy()  // 明确拒绝策略
);
```

本场景的默认建议是：**明确队列容量、线程名和积压时的处理策略**。其中队列是否必须有界、拒绝策略选哪一种，取决于任务是可丢弃、可重试还是必须处理，不能用一条规则覆盖所有业务。

## 6. `ScheduledThreadPoolExecutor`：定时任务的底座

定时任务不是普通线程池——需要"到时间才能取"的队列。JDK 用 `DelayedWorkQueue`（一个基于最小堆的优先队列）做底座：

```java
ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(4);

// 单次延迟执行
scheduler.schedule(task, 5, TimeUnit.SECONDS);

// 固定频率：每 5 秒执行一次（不管上次是否完成）
scheduler.scheduleAtFixedRate(task, 0, 5, TimeUnit.SECONDS);

// 固定延迟：上次结束后再等 5 秒执行下一次
scheduler.scheduleWithFixedDelay(task, 0, 5, TimeUnit.SECONDS);
```

### 6.1 `AtFixedRate` vs `WithFixedDelay`

区别很多人会混：

| 语义 | `scheduleAtFixedRate` | `scheduleWithFixedDelay` |
| :-- | :-- | :-- |
| 下次触发时间 | 上次触发时间 + period | 上次结束时间 + delay |
| 上次执行超时 | 后续执行可能顺延；同一任务不会并发执行 | 下一次在上次结束后再等待 delay |
| 适用 | 心跳、汇报之类"频率恒定"的任务 | 需要保证间隔的任务 |

### 6.2 一个任务异常就"消失"

`ScheduledExecutorService` 有个坑：**定时任务里抛出的未捕获异常，会让这个任务被静默取消，之后不再触发**。

```java
// ❌ 任务里的异常没兜住，后续再也不会跑
scheduler.scheduleAtFixedRate(() -> {
    doWork();          // 一旦抛异常，任务默默退出
}, 0, 5, TimeUnit.SECONDS);

// ✅ 兜底 catch
scheduler.scheduleAtFixedRate(() -> {
    try {
        doWork();
    } catch (Exception t) {
        log.error("scheduled task failed", t);
    }
}, 0, 5, TimeUnit.SECONDS);
```

线上"定时任务运行了一段时间突然不跑了"，绝大多数是这个原因。

## 7. `ForkJoinPool` 与工作窃取 {#fork-join-pool}

`ThreadPoolExecutor` 处理"独立任务"；`ForkJoinPool` 处理"能被拆分的任务"——分治并行。

### 7.1 工作窃取：每个线程一个双端队列

```txt
Worker A 队列:  [T1, T2, T3]     ← A 从队头取（LIFO，缓存友好）
Worker B 队列:  [ ]              ← B 空了！
                                     ↓ 从别人的队尾偷
Worker A 队列:  [T1, T2]         ← A 继续从队头取
Worker B 队列:  [T3]             ← B 拿到 T3 后从自己队头取
```

**A 从队头（LIFO）取自己的任务，B 从 A 的队尾偷**——两端操作错开，减少 CAS 争抢。加上“最新任务留给自己”的偏好，工作窃取通常适合 CPU 密集分治场景；实际并行效率仍受任务粒度、负载均衡和同步开销影响。

### 7.2 `commonPool`：`parallelStream` 和 `CompletableFuture` 的默认执行器

`ForkJoinPool.commonPool()` 是 JVM 全局单例，默认并行度是 `max(1, 可用处理器数 - 1)`；可用 `java.util.concurrent.ForkJoinPool.common.parallelism` 覆盖。以下代码默认会使用它：

```java
list.parallelStream().map(...).collect(...);

CompletableFuture.supplyAsync(() -> heavyWork());    // 不传 executor
```

问题在于全局共享：某处的阻塞任务可能长时间占住公共池，让其他同池使用者明显变慢。

```java
// ❌ 阻塞 IO 塞进 commonPool，同池任务会互相拖慢
CompletableFuture.supplyAsync(() -> httpClient.get(url));

// ✅ 阻塞任务用自建线程池
ExecutorService ioPool = ...;
CompletableFuture.supplyAsync(() -> httpClient.get(url), ioPool);
```

一条经验规则是：**默认的 `commonPool` 适合可拆分的 CPU 密集任务；可能长时间阻塞的任务应使用专门配置的线程池**。是否必须隔离，还要结合线程池参数、阻塞时长和任务隔离需求判断。[第 12 章](./chapter-12-async-model.md)会围绕 `CompletableFuture` 把这条规则再展开一遍。

### 7.3 `ThreadPoolExecutor` vs `ForkJoinPool`

| 维度 | `ThreadPoolExecutor` | `ForkJoinPool` |
| :-- | :-- | :-- |
| 任务模型 | 相互独立 | 分治（`fork` + `join`） |
| 队列 | 全局共享一个 `workQueue` | 每个 Worker 一个双端队列 |
| 工作窃取 | 无 | 有 |
| 适用负载 | IO 密集 / 通用异步 | CPU 密集 / 递归分治 |

## 8. 参数配置方法论

### 8.1 从任务性质起手

参数不能拍脑袋。核心是判断任务是 CPU 密集还是 IO 密集：

| 任务类型 | 参考公式（`corePoolSize`） | 8 核示例 |
| :-- | :-- | :-- |
| CPU 密集（加密、压缩、复杂计算） | `N_CPU + 1` | 9 |
| IO 密集（DB / RPC / HTTP） | `N_CPU × 2` 起，实际按 IO 比例调 | 16 起 |
| 混合任务 | 按启发式估算：`N_CPU × (1 + W/C)` | 见下 |

该公式来自基于 CPU 数和等待/计算比例的容量估算，不是 Little 定律本身。Little 定律的表达是 `L = λW`，用于关联平均在系统中的任务数、到达率和平均停留时间。

```txt
线程数 = CPU 核数 × (1 + 等待时间 / 计算时间)

例：8 核，任务里 60% 时间在等 IO，40% 在算
线程数 = 8 × (1 + 0.6 / 0.4) = 8 × 2.5 = 20
```

这个公式给的是**起点**，不是终点。真实业务需要靠压测把线程数、队列大小、拒绝策略这三者一起调到最佳组合。

### 8.2 线程命名：排查线上问题的生命线 {#thread-naming}

线上出问题，第一件事是抓线程栈。默认线程名 `pool-1-thread-3` 会让你完全分不清哪个业务在跑：

```java
public class NamedThreadFactory implements ThreadFactory {
    private final String prefix;
    private final AtomicInteger seq = new AtomicInteger(1);

    public NamedThreadFactory(String prefix) { this.prefix = prefix; }

    @Override
    public Thread newThread(Runnable r) {
        Thread t = new Thread(r, prefix + "-" + seq.getAndIncrement());
        t.setUncaughtExceptionHandler((th, ex) ->
            log.error("thread {} died with", th.getName(), ex));
        return t;
    }
}
```

用 `order-pool-3` / `payment-pool-1` 这种命名，Thread Dump 一眼就能看出哪个业务的哪个池。

### 8.3 生产监控的四个指标

线程池提供了可选的观测 API；是否接入监控取决于服务等级和故障风险，但生产服务通常应至少观察队列、活跃线程和拒绝事件：

| 指标 | API | 告警阈值参考 |
| :-- | :-- | :-- |
| 活跃线程数 | `getActiveCount()` | 示例：持续达到 `maximumPoolSize` 的 80% |
| 队列长度 | `getQueue().size()` | 示例：持续超过队列容量的 70% |
| 已完成任务 | `getCompletedTaskCount()` | 观察增长速率，突降=卡顿 |
| 拒绝数 | 自定义 `RejectedExecutionHandler` 计数 | 示例：出现拒绝即告警；阈值按业务容忍度调整 |

### 8.4 业务线程池要相互隔离 {#thread-pool-isolation}

整个应用共用一个线程池会放大故障隔离风险，但并非性质上的绝对反模式。任务同质、规模可控且队列有界时可以共享；不同业务的任务时长、阻塞行为或服务等级差异明显时，应分别配置线程池或至少按资源域隔离。

```java
// ❌ 共池
ExecutorService shared = new ThreadPoolExecutor(50, 50, ...);
shared.submit(() -> order.process());
shared.submit(() -> payment.process());
shared.submit(() -> email.send());
```

一旦邮件服务变慢，队列被邮件任务塞满，订单和支付一起被拒绝。

```java
// ✅ 每业务独立池
ExecutorService orderPool   = new ThreadPoolExecutor(20, 20, ...);
ExecutorService paymentPool = new ThreadPoolExecutor(15, 15, ...);
ExecutorService emailPool   = new ThreadPoolExecutor(10, 10, ...);
```

Hystrix / Resilience4j 的舱壁隔离（bulkhead）本质就是这一条。

### 8.5 优雅关闭

```java
// 第一步：温和关闭
executor.shutdown();       // 拒收新任务，已提交的继续跑完

// 第二步：等待一段时间
try {
    if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
        // 第三步：超时后强制关闭
        executor.shutdownNow();    // 中断正在跑的任务
        if (!executor.awaitTermination(10, TimeUnit.SECONDS)) {
            log.error("thread pool not terminated");
        }
    }
} catch (InterruptedException e) {
    executor.shutdownNow();
    Thread.currentThread().interrupt();
}
```

`shutdown()` 与 `shutdownNow()` 的区别：

| 方法 | 对新任务 | 对队列任务 | 对运行中任务 |
| :-- | :-- | :-- | :-- |
| `shutdown()` | 拒绝 | 继续执行 | 继续执行 |
| `shutdownNow()` | 拒绝 | 抛弃并返回 | 发送 `Thread.interrupt()` |

Spring 环境中用 `@PreDestroy` 触发这套流程，避免 JVM 退出时任务被硬中断。

### 8.6 `submit` 的异常静默陷阱 {#submit-exception}

```java
// ❌ 用 submit 但不调用 future.get()，任务抛的异常悄无声息
pool.submit(() -> throwSomething());

// ✅ 要么用 execute，要么处理 Future
pool.execute(() -> throwSomething());   // 异常走 UncaughtExceptionHandler

Future<?> f = pool.submit(() -> throwSomething());
try { f.get(); } catch (ExecutionException e) { /* 才能拿到异常 */ }
```

`submit` 把任务包装成 `FutureTask`，异常保存在 `Future` 中。若调用方既不查询结果，也没有覆盖 `afterExecute` 或其他监控路径，该异常就不会进入业务错误处理，造成“任务执行了但结果和失败原因无人观察”。

## 9. 本章小结

| 问题 | 根源 | 解决方案 |
| :-- | :-- | :-- |
| 无限制 `new Thread` | 栈内存 + 上下文切换失控 | 用线程池限制并发数 |
| 核心线程满了不建非核心线程 | 队列未满 | 按背压需求选择有界或无界队列 |
| `newFixedThreadPool` 任务积压 | `LinkedBlockingQueue()` 默认无界 | 显式设置队列上限与积压策略 |
| `newCachedThreadPool` 线程爆炸 | `max=Integer.MAX_VALUE` | 手写并明确 max |
| 定时任务突然不跑 | 任务异常导致后续执行被取消 | 捕获并处理可预期的 `Exception`；`Error` 按故障策略记录和上报 |
| `parallelStream` / `commonPool` 上的 `CompletableFuture` 明显变慢 | 阻塞任务塞进 `commonPool` | 阻塞任务用独立线程池 |
| 线上无法定位是哪个业务的线程 | 默认线程名无区分 | 自定义 `ThreadFactory` 命名 |
| `submit` 的任务异常无人观察 | 异常被保存在 `Future` 里 | 用 `execute`、查询 `Future`，或在执行器层统一采集 |

## 10. 下一步

线程池决定任务在哪里执行，[异步编程](./chapter-12-async-model.md)决定任务如何组合。阻塞任务较多时继续阅读[虚拟线程模型与 Pinning](./chapter-13-virtual-thread.md)；线程池耗尽、拒绝和任务堆积从[并发性能优化](../06-diagnostics/02-concurrency/chapter-02-concurrency-optimization.md)进入。
