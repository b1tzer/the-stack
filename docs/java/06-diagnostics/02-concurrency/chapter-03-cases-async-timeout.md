# 并发案例：异步任务与下游超时

> **案例说明：** 本页日期、业务背景、指标和工具输出均为构造或匿名化教学数据；除引用一手资料外，不应视为可核验的真实事件。排查方法与命令仍需结合目标 JDK、系统和生产变更流程验证。

这组案例关注异步任务静默丢弃、线程池参数失效、虚拟线程调度阻塞和下游超时级联，重点是发现“线程仍在运行但业务已经失去进展”的问题。

## 5. 案例 5：CompletableFuture + DiscardPolicy —— 静默丢弃任务导致永久阻塞 {#case-5}

### 5.1 事故背景

某合同流程引擎服务，上线后偶尔出现"所有接口全部超时，必须重启才能恢复"的问题。监控显示 CPU 和内存都正常，但 `jstack` 显示 200 个 Tomcat 线程全部 `WAITING` 在 `CompletableFuture.join()`。

### 5.2 第一步：线程栈显示了什么

```bash
jstack <pid> > thread.dump
```

200 个线程，栈几乎一模一样：

```txt
"http-nio-8080-exec-1" #42 daemon prio=5
   java.lang.Thread.State: WAITING (parking)
    at sun.misc.Unsafe.park(Native Method)
    at java.util.concurrent.locks.LockSupport.park(LockSupport.java:175)
    at java.util.concurrent.CompletableFuture$Signaller.block(CompletableFuture.java:1707)
    at java.util.concurrent.CompletableFuture.join(CompletableFuture.java:2021)
    at com.example.ContractService.processFlow(ContractService.java:88)
```

全部 WAITING 在 `CompletableFuture.join()`。说明这些 `Future` 的结果永远不会回来。

### 5.3 第二步：看代码

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

### 5.4 第三步：重现事故链

当并发请求足够大（比如 200 个 Tomcat 线程同时调用 `processFlow`），每个请求提交多个 `CompletableFuture` 任务到 `flowExecutor`：

```txt
1. flowExecutor: 20 线程 + 100 队列 = 最多 120 个任务排队
2. 第 121 个任务到来 → DiscardPolicy 静默丢弃
3. 被丢弃任务的 FutureTask 永远无法完成
4. CompletableFuture.allOf().join() 永远等不到结果
5. Tomcat 线程永久阻塞
6. 200 个 Tomcat 线程逐渐耗尽 → 服务假死
```

`DiscardPolicy` 不抛异常、不打日志、不通知调用者。被丢弃的那个 `CompletableFuture` 就像从未来过——但它的 `join()` 还在等。

### 5.5 第四步：修复

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
            ).orTimeout(30, TimeUnit.SECONDS);
            futures.add(future);
        }

        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
            .get(60, TimeUnit.SECONDS);
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

        scope.join();
        scope.throwIfFailed();

        return aggregateResults(tasks.stream().map(Supplier::get).toList());
    }
}
```

`StructuredTaskScope` 的优势（详见第 12 章）：父任务不会被抛弃不管，一个子任务失败时其他子任务自动取消，整个作用域的边界清晰。

### 5.6 总结：DiscardPolicy 两条禁用场景

| 场景 | 为什么禁用 |
| :-- | :-- |
| 提交的是 `Future` / `CompletableFuture` | 丢弃后调用方永久阻塞在 `get()`/`join()` |
| 任务有副作用（如发 MQ、写库） | 丢弃等于数据丢失且无感知 |
| 可以用 DiscardOldest 替代 | 至少丢的是老任务，且你可以打日志 |

**黄金法则：如果任务的结果需要被等待，永远不要用 DiscardPolicy。**

## 6. 案例 6：线程池 core = max + 无界队列 —— maxPoolSize 永远不触发 {#case-6}

### 6.1 事故背景

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

```txt
"pool-1-thread-1" WAITING on LinkedBlockingQueue.take()
"pool-1-thread-2" WAITING on LinkedBlockingQueue.take()
"pool-1-thread-3" WAITING on LinkedBlockingQueue.take()
"pool-1-thread-4" WAITING on LinkedBlockingQueue.take()
"pool-1-thread-5" WAITING on LinkedBlockingQueue.take()
```

只有 5 个线程在跑——`maxPoolSize=10` 从未被触发。

### 6.2 根因：ThreadPoolExecutor 的任务提交流程

JDK 的 `ThreadPoolExecutor.execute()` 源码逻辑：

```java
public void execute(Runnable command) {
    int c = ctl.get();
    if (workerCountOf(c) < corePoolSize) {               // 1. 核心线程未满？
        if (addWorker(command, true)) return;
    }
    if (isRunning(c) && workQueue.offer(command)) {      // 2. 核心线程满了 → 入队
        return;                                           // 入队成功，不创建新线程！
    }
    if (!addWorker(command, false)) {                    // 3. 队列满了 → 创建非核心线程
        reject(command);                                 // 4. 线程也满了 → 拒绝
    }
}
```

关键在第 2 步：**只要队列没满，就不会走到第 3 步创建非核心线程。** `LinkedBlockingQueue` 无界（默认 `Integer.MAX_VALUE`），队列永远不会满。因此 `maxPoolSize=10` 永远不触发。

### 6.3 修复

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

### 6.4 参数配置速查

| 业务类型 | corePoolSize | maxPoolSize | 队列容量 | 说明 |
| :-- | :-- | :-- | :-- | :-- |
| CPU 密集型 | CPU 核数 | CPU 核数 | 小（128~512） | 线程数 ≈ CPU 核数 |
| IO 密集型 | CPU 核数 | CPU × 2 | 大（1024~4096） | 线程可在等待 IO 时出让 CPU |
| 混合型 | CPU 核数 | CPU × 1.5 | 中等（512~1024） | 按实际压测调整 |

### 6.5 为什么还有人用无界队列？

因为 JDK 的 `Executors.newFixedThreadPool(10)` 内部用的是 `new LinkedBlockingQueue<>()`（无界）。很多开发者直接调这个工厂方法，不知道它默认无界。阿里巴巴 Java 开发手册第 7 条明确禁止 `Executors` 工厂方法：

> 【强制】线程池不允许使用 Executors 去创建，而是通过 ThreadPoolExecutor 的方式，这样的处理方式让写的同学更加明确线程池的运行规则，规避资源耗尽的风险。

### 6.6 总结

| 症状 | 根因 | 修复 |
| :-- | :-- | :-- |
| maxPoolSize 不触发 | 无界队列永不满 | 换有界队列 |
| CPU 低、任务堆积 | 核心线程少、任务全在队列里 | 合理设 core 和 max |
| 觉得队里越大越好 | 误解队列作用 | 队列是缓冲，不是仓库 |

**黄金法则：生产环境的线程池绝不用无界队列。** 队列容量和拒绝策略是线程池安全的两条安全带——不要自作聪明把它们拆掉。

## 7. 案例 7：虚拟线程静默死锁 —— N 个 carrier 全部 pinning 后调度器失灵

### 7.1 事故背景

2025 年，某团队将核心服务从 JDK 17 升到 JDK 21，将所有 `ExecutorService` 替换为 `Executors.newVirtualThreadPerTaskExecutor()`。服务运行稳定，压测数据也正常。但上线后每隔几小时服务就突然无响应——接口全部超时，`/health` 也挂了。CPU 使用率只有 5%，内存正常，GC 正常。`jstack` 看完没有死锁，日志没有异常。运维重启服务后恢复，但几小时后再次复发。

这个问题在生产中反复出现，直到在 OpenJDK Bug 系统里找到 JDK-8334304，才发现这不是代码 bug——是 JVM 的行为。

### 7.2 第一步：jstack 为什么看不出问题

```bash
jstack <pid> > thread.dump
grep "BLOCKED" thread.dump && echo "有阻塞" || echo "无阻塞"
# 输出：无阻塞
```

```bash
grep -c "java.lang.Thread.State" thread.dump
# 输出：15

# 15 个线程？一个服务应该有几百个线程才对！
```

传统的 `jstack` 不显示虚拟线程——虚拟线程是 JVM 内部管理的对象，不在操作系统线程表里。`jstack` 只输出 platform 线程，所以输出里只有 15 条 carrier 线程（ForkJoinPool 的 worker）+ 一些 JVM 内部线程。所有 carrier 线程的状态都是：

```txt
"ForkJoinPool-1-worker-1" #25 daemon prio=5
   java.lang.Thread.State: WAITING (parking)
    at jdk.internal.misc.VirtualThread.parkOnCarrierThread(VirtualThread.java:661)
    at java.lang.VirtualThread.park(VirtualThread.java:593)
    ...
```

所有 carrier 都在 `WAITING`——每个都承载着一个被 `synchronized` pinning 的虚拟线程，这些虚拟线程又在等待另一个尚未被调度的虚拟线程释放某个资源。

### 7.3 第二步：真正的诊断手段 —— JFR

传统 `jstack` 对虚拟线程不可见，需要 JFR：

```bash
jcmd <pid> JFR.start duration=60s filename=vt.jfr
jfr print --events jdk.VirtualThreadPinned vt.jfr
```

输出揭示了真相：

```txt
jdk.VirtualThreadPinned {
  startTime = 03:14:22.103
  duration = 1,283,492 ms          ← 钉住了 21 分钟！
  eventThread = "" (virtual)
  stackTrace = [
    com.mysql.cj.jdbc.ConnectionImpl.getAutoCommit()
    com.zaxxer.hikari.pool.ProxyConnection.getAutoCommit()
    ...
  ]
}
```

几百个 `VirtualThreadPinned` 事件，持续时间从几秒到几十分钟。这些虚拟线程被钉在了 carrier 上。

### 7.4 第三步：静默死锁的机制

虚拟线程的调度模型：JDK 21 默认 `parallelism = CPU 核数` 个 carrier 线程。正常情况下，虚拟线程在 I/O 阻塞时被自动从 carrier 上卸载，carrier 去跑其他就绪的虚拟线程。

但当虚拟线程在 `synchronized` 块内阻塞时（JDK 21-23），JVM 无法卸载它——虚拟线程被 pinned 在 carrier 上。当以下两个条件同时满足时，静默死锁发生：

1. 所有 carrier 线程上都被 pin 了虚拟线程
2. 这些被 pin 的虚拟线程全部在等待某个尚未调度的虚拟线程释放资源

此时：

- 所有 carrier 被占满，无法调度新的虚拟线程
- 被 pin 的虚拟线程在等某个资源，而释放资源的虚拟线程还没被调度
- 调度器本身不会创建额外的 carrier 线程来打破僵局
- 整个虚拟线程池永久停滞

JDK-8334304 的复现代码清晰地演示了这个问题：当 `pinned VT 数量 > availableProcessors()` 时，调度器不会补偿。

### 7.5 第四步：为什么会触发

该团队使用了 MySQL Connector/J 8.0.x。这个版本的驱动内部有大量 `synchronized` 方法：

```java
// MySQL Connector/J 8.0.x ConnectionImpl
public synchronized boolean getAutoCommit() throws SQLException { ... }
```

当高并发 + 数据库偶发慢查询时，虚拟线程被 pin 在 carrier 上等待 socket read——但因为 `synchronized`，无法卸载。如果 8 个 carrier 都被类似情况 pin 住，其他所有虚拟线程永远得不到调度。

### 7.6 第五步：修复

**方案 A（JDK 24+ 一劳永逸）：升级 JDK。** JDK 24 的 JEP 491 消除了 `synchronized` 的 pinning 问题。

**方案 B（JDK 21-23 的治标）：** 排查并替换所有 `synchronized` 阻塞点为 `ReentrantLock`。

**方案 C（框架兼容限制）：用 Semaphore 控制并发度。** 保证进入危险区的虚拟线程数量远小于 carrier 数：

```java
private static final Semaphore DB_SEMAPHORE = new Semaphore(4); // 小于 carrier 数 8
```

**方案 D（运营排查期）：** 临时增加 carrier 数 `-Djdk.virtualThreadScheduler.parallelism=32`。

### 7.7 总结

| 信号 | 含义 | 工具 |
| :-- | :-- | :-- |
| 虚拟线程服务突然无响应，CPU 低 | 所有 carrier 可能被 pin 住 | JFR `VirtualThreadPinned` 事件 |
| `jstack` 看不出问题 | `jstack` 不输出虚拟线程 | `jcmd Thread.dump_to_file -format=json` |
| `VirtualThreadPinned` 持续时间 > 1s | 严重 pinning | JFR |
| carrier 数 = pinning VT 数 | 可能已死锁 | `-Djdk.virtualThreadScheduler.parallelism` 或 Semaphore |

**教训：** 常规 CPU 和线程监控可能看不到虚拟线程的调度问题。`Thread.dump_to_file` 用于查看当前虚拟线程状态，JFR 的 `jdk.VirtualThreadPinned` 事件用于记录 pinning 发生及持续时间，两者用途不同。迁移到虚拟线程前，还必须确保第三方库不依赖 `synchronized` 与阻塞操作的组合。

## 8. 案例 8：RestTemplate 无超时 —— 一个下游挂了 10 秒，整个系统瘫痪 3 小时

### 8.1 事故背景

2025 年某支付系统，订单创建接口内部调用风控服务做风险校验。某天下午，风控服务因数据库故障响应变慢，10 秒后才开始出现超时报错。但这 10 秒的变慢造成了比风控服务本身故障更大的灾难——订单服务的 Tomcat 线程池被全部卡死在等风控服务返回，整个支付系统停止响应，持续了 3 小时直到手动重启。

故障链路：风控服务慢 10 秒 → 支付服务的 Tomcat 线程全部卡在 `SocketInputStream.socketRead0()` → 所有接口不可用 → 用户疯狂刷新 → 更多线程卡死。

### 8.2 第一步：jstack 看到什么

```bash
jstack <pid> > thread.dump
grep "java.lang.Thread.State" thread.dump | sort | uniq -c | sort -rn
```

```txt
200 RUNNABLE       ← 全部 RUNNABLE？但 CPU 却是 8%？
```

不寻常：200 个线程全是 `RUNNABLE`，但 CPU 只有 8%。查看具体栈：

```txt
"http-nio-8080-exec-1" #42 daemon prio=5
   java.lang.Thread.State: RUNNABLE
    at java.net.SocketInputStream.socketRead0(Native Method)    ← Native 方法
    at java.net.SocketInputStream.socketRead(SocketInputStream.java:115)
    ...
    at com.example.payment.service.RiskService.check(RiskService.java:42)
```

`RUNNABLE` 但 CPU 低的原因是：`socketRead0` 是 Native 方法，线程实际在操作系统层面处于非忙等状态——它在等 TCP 数据到达。

### 8.3 第二步：看代码

```java
@Configuration
public class RestTemplateConfig {
    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();  // ← 默认构造，没有任何超时配置！
    }
}

@Service
public class RiskService {
    @Autowired
    private RestTemplate restTemplate;

    public RiskResult check(OrderRequest request) {
        String url = "http://risk-service/api/check";
        return restTemplate.postForObject(url, request, RiskResult.class);
    }
}
```

`new RestTemplate()` 底层使用 `SimpleClientHttpRequestFactory`，基于 `java.net.HttpURLConnection`。**`HttpURLConnection` 的默认超时是 `0`——表示无限等待。**

### 8.4 第三步：事故链

```txt
13:00  风控服务数据库故障，响应时间从 50ms → 10s
13:02  支付服务 QPS 300，200 个 Tomcat 线程全部被卡在 socketRead0()
13:04  用户看到"支付失败"，疯狂刷新
13:05  上游网关层超时，发起重试——增加 2~3 倍请求量
13:05  K8s 开始滚动重启
13:10  重启完成，新 Pod 启动——但风控服务还没恢复，新 Pod 又卡死
14:30  运维人员手动切断风控服务调用，启用降级，系统恢复
```

**3 小时停摆。** 如果 `RestTemplate` 设置了 3 秒 `readTimeout`，10 秒后所有请求快速失败并释放线程，系统在 10 秒后恢复正常。

### 8.5 第四步：修复

```java
@Configuration
public class RestTemplateConfig {

    @Bean
    public RestTemplate restTemplate() {
        RequestConfig requestConfig = RequestConfig.custom()
            .setConnectTimeout(Duration.ofSeconds(2))
            .setConnectionRequestTimeout(Duration.ofSeconds(1))
            .setResponseTimeout(Duration.ofSeconds(5))
            .build();

        CloseableHttpClient httpClient = HttpClientBuilder.create()
            .setDefaultRequestConfig(requestConfig)
            .build();

        return new RestTemplate(new HttpComponentsClientHttpRequestFactory(httpClient));
    }
}
```

三种超时的区别：

| 超时类型 | 对应 TCP 阶段 | 默认值（未设置时） | 推荐值 |
| :-- | :-- | :-- | :-- |
| `connectTimeout` | TCP 三次握手 | `0`（无限） | 2s |
| `connectionRequestTimeout` | 从连接池租连接 | `-1`（无限） | 1s |
| `responseTimeout` (`readTimeout`) | 等待响应数据 | `0`（无限） | 3~5s |

**不设超时 = 把服务的生死交给了下游。**

### 8.6 第五步：超时之外 —— 熔断和隔离

```java
@Service
public class RiskService {
    private final RestTemplate restTemplate;
    private final CircuitBreaker circuitBreaker = CircuitBreaker.ofDefaults("riskService");

    public RiskResult check(OrderRequest request) {
        return circuitBreaker.executeSupplier(() ->
            restTemplate.postForObject("http://risk-service/api/check", request, RiskResult.class)
        );
    }

    public RiskResult fallback(OrderRequest request, Throwable t) {
        log.warn("风控服务熔断降级，订单 {} 跳过风控检查", request.getOrderId());
        return RiskResult.pass();
    }
}
```

### 8.7 总结：三条防线的体系

```txt
第一道防线：超时 —— 每次调用都有截止时间，过期不候
第二道防线：熔断 —— 连续失败后直接降级，避免持续消耗资源
第三道防线：隔离 —— 为不同下游分配独立线程池
```

### 8.8 总结

| 信号 | 含义 | 工具 |
| :-- | :-- | :-- |
| 大量线程 `RUNNABLE` 在 `socketRead0`，CPU 低 | IO 阻塞——等下游响应 | `jstack` |
| `HttpURLConnection` 没有超时 | 会永久等待 | 源码审查 |
| 下游故障 10 秒 → 上游瘫痪 3 小时 | 无超时 + 无熔断的级联放大 | 事故复盘 |
| 重启→卡死→重启循环 | 重启不能解决问题，因为代码未变 | 降级优先于重启 |

**教训：** 任何跨网络的调用，必须设置超时。没有例外。`connectTimeout`、`readTimeout`、`connectionRequestTimeout` 三个参数缺一不可。超时值的选择原则：宁可快失败也不慢等待。失败可以重试，但等待会耗尽线程。

> **回到诊断入口：** [并发问题诊断与性能优化](./chapter-01-concurrency-diagnostics.md)
