# 第 13 章案例集（二）：虚拟线程与综合并发诊断实战

> 迁移到 Java 21 虚拟线程后，压测吞吐从 5000 跌到 800。`jfr print --events jdk.VirtualThreadPinned` 一跑，几千个 pinning 事件全部指向 `HikariCP.getConnection()` —— 老版本的 `synchronized` 把虚拟线程钉在了 carrier 上，8 核机器最多 8 个并发。另一台机器，所有接口全部超时—— `CompletableFuture` + DiscardPolicy 静默丢弃了 `FutureTask`，`allOf().join()` 永远等不到结果。并发问题最怕的不是死锁，是"看起来一切正常，但就是不动了"。

## 1. 案例 4：虚拟线程 pinning —— 同步锁让 5000 QPS 跌到 800

### 1.1 事故背景

2025 年，某视频流媒体处理团队将核心服务从 JDK 17 升级到 JDK 21，并将 `ExecutorService` 替换为 `Executors.newVirtualThreadPerTaskExecutor()`。升级前压测吞吐 5000 QPS，升级后跌到 800。CPU 使用率 40%，但请求延迟暴涨。日志里没有任何异常，监控看起来一切正常——但就是变慢了。

### 1.2 第一步：JFR 揪出看不见的瓶颈

```bash
# 启动 60 秒 JFR 录制，关注虚拟线程事件
jcmd <pid> JFR.start duration=60s filename=vt.jfr

# 用 jfr 命令行工具打印 pinning 事件
jfr print --events jdk.VirtualThreadPinned vt.jfr
```

输出：

```text
jdk.VirtualThreadPinned {
  startTime = 10:23:45.102
  duration = 212 ms
  eventThread = "" (virtual)
  stackTrace = [
    com.zaxxer.hikari.pool.HikariPool.getConnection()      ← 老版本 HikariCP
    com.zaxxer.hikari.HikariDataSource.getConnection()
    com.example.VideoService.processVideo(VideoService.java:56)
    ...
  ]
}
```

几千个 `VirtualThreadPinned` 事件，全部指向 `HikariPool.getConnection()`。

### 1.3 第二步：为什么 pinning 导致吞吐暴跌？

虚拟线程的工作原理：JDK 21 默认 `parallelism = CPU 核数` 个 **carrier 线程**（平台线程），海量虚拟线程在这少数几个 carrier 上被调度。虚拟线程遇到 I/O 阻塞时，JVM 自动将其从 carrier 上**卸载**，carrier 线程去执行其他就绪的虚拟线程。这就是虚拟线程能给高 IO 并发带来质变的原因。

**但是**——当虚拟线程在 `synchronized` 块内阻塞时，JVM 无法卸载它。虚拟线程被"钉住"（pinned）在 carrier 上，carrier 被占死。

```text
8 个 carrier → 每个被 pinned → 实际并发 = 8

5000 QPS × 平均处理 50ms = 250 个并发需求 → 8 个可用 → 排队 242 个
```

这就是吞吐从 5000 跌到 800 的数学解释。

### 1.4 第三步：修复

**方案 A（治本）：升级 HikariCP 到 5.1.0+**

老版本 `HikariPool.getConnection()` 使用了 `synchronized`：

```java
// HikariCP 5.0.x（问题版本）
public synchronized Connection getConnection() throws SQLException {
    return pool.borrowObject();  // ← 这里阻塞时，虚拟线程被 pinned
}
```

升级到 5.1.0+ 后，HikariCP 将 `synchronized` 替换为 `ReentrantLock`：

```java
// HikariCP 5.1.0+（修复版本）
public Connection getConnection() throws SQLException {
    lock.lock();
    try {
        return pool.borrowObject();  // ← ReentrantLock 下阻塞时，虚拟线程可以正常卸载
    } finally {
        lock.unlock();
    }
}
```

`ReentrantLock` 底层使用 `LockSupport.park()`，虚拟线程在 park 时能正常卸载。升级后吞吐恢复到 5200 QPS。

**方案 B（治标）：如果框架无法升级，用 Semaphore 限流**

```java
private static final Semaphore DB_SEMAPHORE = new Semaphore(50);

public void processVideo(VideoRequest req) {
    DB_SEMAPHORE.acquire();
    try {
        // 数据库操作（走老版本 HikariCP）
        Video video = videoDao.findById(req.getVideoId());
        // ...
    } finally {
        DB_SEMAPHORE.release();
    }
}
```

用 Semaphore 限制同时进入 `synchronized` 危险区的虚拟线程数量。这样即使有 pinning，最多 pin 住 carrier 里的几条，不会全部报销。

**方案 C（如果你有 JDK 24+）：直接升级**

JDK 24 的 JEP 491 消除了 `synchronized` 的 pinning 问题。在 JDK 24 以上，`synchronized` 块内的阻塞操作不再导致 pinning。如果团队能升到 JDK 24+，这是最干净的方案。JDK 25 LTS 将于 2025 年 9 月发布，届时虚拟线程的 pinning 问题将彻底成为历史。

### 1.5 诊断信号

| 信号 | 工具 | 含义 |
|------|------|------|
| 虚拟线程环境下吞吐不升反降 | 压测对比 | 可能存在 pinning |
| `jfr print --events jdk.VirtualThreadPinned` | JFR | 精确定位 pinning 代码位置 |
| 大量虚拟线程 `WAITING`、carrier 全部 `RUNNABLE` | `jcmd Thread.print` | carrier 被占满 |
| `-Djdk.tracePinnedThreads=full` 输出 | JVM 参数 | JDK 21-23 可用，JDK 24+ 已移除 |

### 1.6 总结

虚拟线程不是"开了就快"的银弹。它的调度优势建立在"非 pinning 的阻塞操作"上。pinning 场景包括：
- `synchronized` 块内的阻塞 I/O（JDK 21-23）
- Native 方法（JNI）内的阻塞
- 某些老版本 JDBC 驱动的内部实现

排查节奏：先看 JFR `VirtualThreadPinned` 事件 → 定位代码位置 → 判断框架是否可升级 → 不可升级则用 Semaphore 限流或把阻塞操作移到平台线程池。

## 2. 案例 5：CompletableFuture + DiscardPolicy —— 静默丢弃任务导致永久阻塞

### 2.1 事故背景

某合同流程引擎服务，上线后偶尔出现"所有接口全部超时，必须重启才能恢复"的问题。监控显示 CPU 和内存都正常，但 `jstack` 显示 200 个 Tomcat 线程全部 `WAITING` 在 `CompletableFuture.join()`。

### 2.2 第一步：线程栈显示了什么

```bash
jstack <pid> > thread.dump
```

200 个线程，栈几乎一模一样：

```text
"http-nio-8080-exec-1" #42 daemon prio=5
   java.lang.Thread.State: WAITING (parking)
    at sun.misc.Unsafe.park(Native Method)
    at java.util.concurrent.locks.LockSupport.park(LockSupport.java:175)
    at java.util.concurrent.CompletableFuture$Signaller.block(CompletableFuture.java:1707)
    at java.util.concurrent.CompletableFuture.join(CompletableFuture.java:2021)
    at com.example.ContractService.processFlow(ContractService.java:88)
```

全部 WAITING 在 `CompletableFuture.join()`。说明这些 `Future` 的结果永远不会回来。

### 2.3 第二步：看代码

```java
@Service
public class ContractService {

    // 线程池：core=20, max=20, queue=100, DiscardPolicy
    private final ExecutorService flowExecutor = new ThreadPoolExecutor(
        20, 20, 60L, TimeUnit.SECONDS,
        new LinkedBlockingQueue<>(100),
        new ThreadPoolExecutor.DiscardPolicy()  // ← 问题在这里
    );

    public FlowResult processFlow(FlowRequest request) {
        List<CompletableFuture<StepResult>> futures = new ArrayList<>();

        for (FlowStep step : request.getSteps()) {
            CompletableFuture<StepResult> future = CompletableFuture.supplyAsync(
                () -> executeStep(step),
                flowExecutor
            );
            futures.add(future);
        }

        // 阻塞等待所有步骤完成
        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();

        // 汇总结果
        return aggregateResults(futures);
    }
}
```

### 2.4 第三步：重现事故链

当并发请求足够大（比如 200 个 Tomcat 线程同时调用 `processFlow`），每个请求提交多个 `CompletableFuture` 任务到 `flowExecutor`：

```text
1. flowExecutor: 20 线程 + 100 队列 = 最多 120 个任务排队
2. 第 121 个任务到来 → DiscardPolicy 静默丢弃
3. 被丢弃任务的 FutureTask 永远无法完成
4. CompletableFuture.allOf().join() 永远等不到结果
5. Tomcat 线程永久阻塞
6. 200 个 Tomcat 线程逐渐耗尽 → 服务假死
```

`DiscardPolicy` 不抛异常、不打日志、不通知调用者。被丢弃的那个 `CompletableFuture` 就像从未来过——但它的 `join()` 还在等。

### 2.5 第四步：修复

**方案 A：改拒绝策略 + 超时**

```java
private final ExecutorService flowExecutor = new ThreadPoolExecutor(
    20, 30, 60L, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(100),
    new ThreadPoolExecutor.AbortPolicy()  // 直接抛异常，不静默
);

public FlowResult processFlow(FlowRequest request) {
    List<CompletableFuture<StepResult>> futures = new ArrayList<>();

    try {
        for (FlowStep step : request.getSteps()) {
            CompletableFuture<StepResult> future = CompletableFuture.supplyAsync(
                () -> executeStep(step),
                flowExecutor
            ).orTimeout(30, TimeUnit.SECONDS);  // 关键：30 秒超时
            futures.add(future);
        }

        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
            .get(60, TimeUnit.SECONDS);  // 总超时 60 秒
    } catch (TimeoutException | ExecutionException e) {
        log.error("流程执行异常", e);
        futures.forEach(f -> f.cancel(true));
        throw new FlowException("流程执行超时或失败", e);
    }

    return aggregateResults(futures);
}
```

关键改动：
1. `DiscardPolicy` → `AbortPolicy` — 拒绝就抛异常，调用者感知到
2. `CompletableFuture.orTimeout(30, TimeUnit.SECONDS)` — 每个 Future 单独超时
3. `get(60, TimeUnit.SECONDS)` — 总超时兜底

**方案 B：使用 `StructuredTaskScope`（JDK 21+ 预览 / JDK 25 LTS 稳定）**

```java
public FlowResult processFlow(FlowRequest request) throws InterruptedException {
    try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
        List<Supplier<StepResult>> tasks = new ArrayList<>();
        for (FlowStep step : request.getSteps()) {
            tasks.add(scope.fork(() -> executeStep(step)));
        }

        scope.join();             // 等待所有子任务完成
        scope.throwIfFailed();    // 任何子任务失败则抛出

        return aggregateResults(tasks.stream().map(Supplier::get).toList());
    }
}
```

`StructuredTaskScope` 的优势（详见第 12 章）：父任务不会被抛弃不管，一个子任务失败时其他子任务自动取消，整个作用域的边界清晰。

### 2.6 总结：DiscardPolicy 两条禁用场景

| 场景 | 为什么禁用 |
|------|----------|
| 提交的是 `Future` / `CompletableFuture` | 丢弃后调用方永久阻塞在 `get()`/`join()` |
| 任务有副作用（如发 MQ、写库） | 丢弃等于数据丢失且无感知 |
| 可以用 DiscardOldest 替代 | 至少丢的是老任务，且你可以打日志 |

**黄金法则：如果任务的结果需要被等待，永远不要用 DiscardPolicy。**

## 3. 案例 6：线程池 core = max + 无界队列 —— maxPoolSize 永远不触发

### 3.1 事故背景

2025 年某定时任务服务，凌晨并发处理上千个文件。线程池参数：

```java
new ThreadPoolExecutor(
    5,                                          // corePoolSize
    10,                                         // maxPoolSize
    60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(),                 // ← 无界队列！
    new ThreadPoolExecutor.AbortPolicy()
);
```

某天凌晨，监控告警：任务积压 5 万条，机器 CPU 却只有 3%。`jstack` 显示：

```text
"pool-1-thread-1" WAITING on LinkedBlockingQueue.take()
"pool-1-thread-2" WAITING on LinkedBlockingQueue.take()
"pool-1-thread-3" WAITING on LinkedBlockingQueue.take()
"pool-1-thread-4" WAITING on LinkedBlockingQueue.take()
"pool-1-thread-5" WAITING on LinkedBlockingQueue.take()
```

只有 5 个线程在跑——`maxPoolSize=10` 从未被触发。

### 3.2 根因：ThreadPoolExecutor 的任务提交流程

JDK 的 `ThreadPoolExecutor.execute()` 源码逻辑（`ThreadPoolExecutor.java:1361`）：

```java
public void execute(Runnable command) {
    int c = ctl.get();
    if (workerCountOf(c) < corePoolSize) {               // 1. 核心线程未满？
        if (addWorker(command, true)) return;             //    创建核心线程
    }
    if (isRunning(c) && workQueue.offer(command)) {      // 2. 核心线程满了 → 入队
        // 入队成功，不创建新线程！
        return;
    }
    if (!addWorker(command, false)) {                    // 3. 队列满了 → 创建非核心线程
        reject(command);                                 // 4. 线程也满了 → 拒绝
    }
}
```

关键在第 2 步：**只要队列没满，就不会走到第 3 步创建非核心线程。** `LinkedBlockingQueue` 无界（默认 `Integer.MAX_VALUE`），队列永远不会满。因此 `maxPoolSize=10` 永远不触发。线程池始终只有 5 个核心线程在工作，5 万任务全堆在队列里。

### 3.3 修复

```java
new ThreadPoolExecutor(
    5,
    10,
    60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(500),        // ✅ 有界队列 500
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

关键：**队列必须有界。** 用 `LinkedBlockingQueue<>(500)` 或 `ArrayBlockingQueue<>(500)`。队列满后线程池才会扩容到 maxPoolSize。

### 3.4 参数配置速查

| 业务类型 | corePoolSize | maxPoolSize | 队列容量 | 说明 |
|---------|-------------|-------------|---------|------|
| CPU 密集型 | CPU 核数 | CPU 核数 | 小（128~512） | 线程数 ≈ CPU 核数 |
| IO 密集型 | CPU 核数 | CPU × 2 | 大（1024~4096） | 线程可在等待 IO 时出让 CPU |
| 混合型 | CPU 核数 | CPU × 1.5 | 中等（512~1024） | 按实际压测调整 |

### 3.5 为什么还有人用无界队列？

因为 JDK 的 `Executors.newFixedThreadPool(10)` 内部用的是 `new LinkedBlockingQueue<>()`（无界）。很多开发者直接调这个工厂方法，不知道它默认无界。阿里巴巴 Java 开发手册 1.6.0 第 7 条明确禁止 `Executors` 工厂方法：

> 【强制】线程池不允许使用 Executors 去创建，而是通过 ThreadPoolExecutor 的方式，这样的处理方式让写的同学更加明确线程池的运行规则，规避资源耗尽的风险。

### 3.6 总结

| 症状 | 根因 | 修复 |
|------|------|------|
| maxPoolSize 不触发 | 无界队列永不满 | 换有界队列 |
| CPU 低、任务堆积 | 核心线程少、任务全在队列里 | 合理设 core 和 max |
| 觉得队里越大越好 | 误解队列作用 | 队列是缓冲，不是仓库 |

**黄金法则：生产环境的线程池绝不用无界队列。** 队列容量和拒绝策略是线程池安全的两条安全带——不要自作聪明把它们拆掉。

> **上一篇：** [第 13 章案例集（一）：死锁、线程池与并发集合实战](./chapter-13-diagnostics-cases-part1)
>
> **下一篇：** [第 13 章案例集（三）：静默死锁与无超时雪崩](./chapter-13-diagnostics-cases-part3)
>
> **回到第 13 章正文：** [并发问题诊断与性能优化](./chapter-13-diagnostics)