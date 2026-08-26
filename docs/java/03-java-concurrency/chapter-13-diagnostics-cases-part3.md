# 第 13 章案例集（三）：静默死锁与无超时雪崩

> 升级到 JDK 21 虚拟线程后，服务运行正常。某天凌晨 3 点，整个服务突然无响应——没有 CPU 飙升、没有 OOM、没有死锁日志。`jstack` 输出的线程栈全是 `WAITING`，`Thread.getAllStackTraces()` 也看不到任何 `BLOCKED`。重启恢复，第二天再次发生。问题藏在一个意想不到的角落：虚拟线程 pinning——当所有 carrier 线程都被钉住时，虚拟线程调度器静默死锁，**没有任何常规监控能发现**。另一台机器，某个第三方服务挂了 10 秒——但整个系统为此停摆了 3 小时。RestTemplate 没有设置 `connectTimeout` 和 `readTimeout`，Tomcat 线程在 `SocketInputStream.socketRead0()` 上永远阻塞——200 个线程全部卡死，服务完全瘫痪。这两种问题有一个共同特点——不是系统"坏了"，而是系统设计时缺失了关键的**超时防御**和**退化感知**。

## 1. 案例 7：虚拟线程静默死锁 —— N 个 carrier 全部 pinning 后调度器失灵

### 1.1 事故背景

2025 年，某团队将核心服务从 JDK 17 升到 JDK 21，将所有 `ExecutorService` 替换为 `Executors.newVirtualThreadPerTaskExecutor()`。服务运行稳定，压测数据也正常。但上线后每隔几小时服务就突然无响应——接口全部超时，`/health` 也挂了。CPU 使用率只有 5%，内存正常，GC 正常。`jstack` 看完没有死锁，日志没有异常。运维重启服务后恢复，但几小时后再次复发。

这个问题在生产中反复出现，直到在 OpenJDK Bug 系统里找到 JDK-8334304，才发现这不是代码 bug——是 JVM 的行为。

### 1.2 第一步：jstack 为什么看不出问题

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

```text
"ForkJoinPool-1-worker-1" #25 daemon prio=5
   java.lang.Thread.State: WAITING (parking)
    at jdk.internal.misc.VirtualThread.parkOnCarrierThread(VirtualThread.java:661)
    at java.lang.VirtualThread.park(VirtualThread.java:593)
    ...
```

所有 carrier 都在 `WAITING`——每个都承载着一个被 `synchronized` pinning 的虚拟线程，这些虚拟线程又在等待另一个尚未被调度的虚拟线程释放某个资源。

### 1.3 第二步：真正的诊断手段 —— JFR

传统 `jstack` 对虚拟线程不可见，需要 JFR：

```bash
jcmd <pid> JFR.start duration=60s filename=vt.jfr
jfr print --events jdk.VirtualThreadPinned vt.jfr
```

输出揭示了真相：

```text
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

几百个 `VirtualThreadPinned` 事件，持续时间从几秒到几十分钟。这些虚拟线程被钉在了 carrier 上——它们的 `synchronized` 块内发生了阻塞操作，JVM 无法卸载它们。

### 1.4 第三步：静默死锁的机制

虚拟线程的调度模型：JDK 21 默认 `parallelism = CPU 核数` 个 carrier 线程。比如 8 核机器有 8 个 carrier。正常情况下，虚拟线程在 I/O 阻塞时被自动从 carrier 上卸载，carrier 去跑其他就绪的虚拟线程。8 个 carrier 可以支撑几万个虚拟线程。

但当虚拟线程在 `synchronized` 块内阻塞时（JDK 21-23），JVM 无法卸载它——虚拟线程被 pinned 在 carrier 上。

正常情况下偶尔 pinning 几十毫秒影响不大。但当以下两个条件同时满足时，静默死锁发生：

1. 所有 carrier 线程上都被 pin 了虚拟线程
2. 这些被 pin 的虚拟线程全部在等待某个尚未调度的虚拟线程释放资源

此时：
- 所有 carrier 被占满，无法调度新的虚拟线程
- 被 pin 的虚拟线程在等某个资源，而释放资源的虚拟线程还没被调度
- 调度器本身不会创建额外的 carrier 线程来打破僵局
- 整个虚拟线程池永久停滞

JDK-8334304 的复现代码清晰地演示了这个问题：当 `pinned VT 数量 > availableProcessors()` 时，调度器不会补偿。OpenJDK 团队的回复是：这不是 bug——是设计如此。虚拟线程调度器不像 `ForkJoinPool` 那样在饱和时动态增加线程。

### 1.5 第四步：为什么会触发

该团队使用了 MySQL Connector/J 8.0.x。这个版本的驱动内部有大量 `synchronized` 方法：

```java
// MySQL Connector/J 8.0.x ConnectionImpl
public synchronized boolean getAutoCommit() throws SQLException {
    // ...
}
```

当高并发 + 数据库偶发慢查询时：
1. 虚拟线程 A 拿到数据库连接，进入 `ConnectionImpl.getAutoCommit()`（`synchronized` 方法），数据库响应慢
2. 虚拟线程 A 被 pinned——它在等待 socket read，但因为 `synchronized`，无法卸载
3. 其他虚拟线程 B/C/D 也需要拿数据库连接，但连接池里的连接被 A 占着
4. 如果此时恰好承载 A 到 H 的 8 个 carrier 都被类似情况 pin 住了，其他所有虚拟线程——包括那些可能释放资源的——永远得不到调度机会

### 1.6 第五步：修复

**方案 A（JDK 24+ 一劳永逸）：升级 JDK**

JDK 24 的 JEP 491 消除了 `synchronized` 的 pinning 问题。升级到 JDK 24+（推荐等 2025 年 9 月的 JDK 25 LTS），此类问题不再存在。

**方案 B（JDK 21-23 的治标）：排查并替换所有 `synchronized` 阻塞点**

用 JFR `VirtualThreadPinned` 事件定位所有 pinning 点，将 `synchronized` 替换为 `ReentrantLock`：

```java
// ❌ 问题：synchronized + 阻塞操作
private final Object lock = new Object();

public Connection getConnection() throws SQLException {
    synchronized (lock) {
        return pool.borrowObject();  // 阻塞时 pinning
    }
}

// ✅ 修复：ReentrantLock + 阻塞操作
private final ReentrantLock lock = new ReentrantLock();

public Connection getConnection() throws SQLException {
    lock.lock();
    try {
        return pool.borrowObject();  // ReentrantLock 下阻塞时，虚拟线程可正常卸载
    } finally {
        lock.unlock();
    }
}
```

**方案 C（框架兼容限制）：用 Semaphore 控制并发度**

如果无法替换框架中的 `synchronized`（比如老版本 MySQL 驱动），用 `Semaphore` 限流，保证进入危险区的虚拟线程数量远小于 carrier 数：

```java
private static final Semaphore DB_SEMAPHORE = new Semaphore(4); // 小于 carrier 数 8

public void doDatabaseWork() {
    DB_SEMAPHORE.acquire();
    try {
        // 走老版本 MySQL Connector/J，内部有 synchronized
        jdbcTemplate.query(...);
    } finally {
        DB_SEMAPHORE.release();
    }
}
```

原理：最多 4 个虚拟线程同时进入数据库操作。即使这 4 个都被 pin 住，还有 4 个 carrier 空闲，调度器不会死锁。

**方案 D（运营排查期）：临时增加 carrier 数**

```bash
# 启动参数：让 carrier 数比并发 pinning 数多
-Djdk.virtualThreadScheduler.parallelism=32
```

这只是拖延，不是解决。真正的问题是 pinning 本身——但作为紧急止血手段有效。

### 1.7 总结

| 信号 | 含义 | 工具 |
|------|------|------|
| 虚拟线程服务突然无响应，CPU 低 | 所有 carrier 可能被 pin 住 | JFR `VirtualThreadPinned` 事件 |
| `jstack` 看不出问题 | `jstack` 不输出虚拟线程 | `jcmd Thread.dump_to_file -format=json` |
| `VirtualThreadPinned` 持续时间 > 1s | 严重 pinning——排查 `synchronized` + 阻塞操作 | JFR |
| carrier 数 = pinning VT 数 | 可能已死锁——增加 carrier 或减少并发度 | `-Djdk.virtualThreadScheduler.parallelism` 或 Semaphore |

**教训：** 虚拟线程的 pinning 和死锁在常规监控中完全不可见。`jstack` 不输出虚拟线程，`Thread.getAllStackTraces()` 也不包含它们。唯一的诊断窗口是 JFR 的 `jdk.VirtualThreadPinned` 事件。迁移到虚拟线程前，必须确保第三方库（JDBC 驱动、HTTP 客户端、消息队列客户端）不依赖 `synchronized` + 阻塞操作的组合。JDK 24+ 已从根本上解决此问题，但大量生产环境仍运行在 JDK 21 LTS 上。

## 2. 案例 8：RestTemplate 无超时 —— 一个下游挂了 10 秒，整个系统瘫痪 3 小时

### 2.1 事故背景

2025 年某支付系统，订单创建接口内部调用风控服务做风险校验。某天下午，风控服务因数据库故障响应变慢，10 秒后才开始出现超时报错。但这 10 秒的变慢造成了比风控服务本身故障更大的灾难——订单服务的 Tomcat 线程池被全部卡死在等风控服务返回，整个支付系统停止响应，持续了 3 小时直到手动重启。

故障链路：风控服务慢 10 秒 → 支付服务的 Tomcat 线程全部卡在 `SocketInputStream.socketRead0()` → 所有接口不可用 → 用户疯狂刷新 → 更多线程卡死 → 死循环。

### 2.2 第一步：jstack 看到什么

```bash
jstack <pid> > thread.dump
grep "java.lang.Thread.State" thread.dump | sort | uniq -c | sort -rn
```

```text
200 RUNNABLE       ← 全部 RUNNABLE？但 CPU 却是 8%？
```

不寻常：200 个线程全是 `RUNNABLE`，但 CPU 只有 8%。查看具体栈：

```text
"http-nio-8080-exec-1" #42 daemon prio=5
   java.lang.Thread.State: RUNNABLE
    at java.net.SocketInputStream.socketRead0(Native Method)    ← Native 方法
    at java.net.SocketInputStream.socketRead(SocketInputStream.java:115)
    at java.net.SocketInputStream.read(SocketInputStream.java:169)
    at org.apache.http.impl.io.SessionInputBufferImpl.streamRead(...)
    at org.apache.http.impl.io.SessionInputBufferImpl.fillBuffer(...)
    at org.apache.http.impl.io.SessionInputBufferImpl.readLine(...)
    at org.apache.http.impl.conn.DefaultHttpResponseParser.parseHead(...)
    at org.apache.http.impl.conn.DefaultHttpResponseParser.parseHead(...)
    at org.apache.http.impl.io.AbstractMessageParser.parse(...)
    at org.apache.http.impl.DefaultBHttpClientConnection.receiveResponseHeader(...)
    at org.apache.http.impl.conn.CPoolProxy.receiveResponseHeader(...)
    at org.apache.http.protocol.HttpRequestExecutor.doReceiveResponse(...)
    at org.apache.http.protocol.HttpRequestExecutor.execute(...)
    at org.springframework.http.client.HttpComponentsClientHttpRequest.executeInternal(...)
    at com.example.payment.service.RiskService.check(RiskService.java:42)  ← 这里
    ...

"http-nio-8080-exec-2" #43 daemon prio=5
   java.lang.Thread.State: RUNNABLE
    at java.net.SocketInputStream.socketRead0(Native Method)
    ... 同上 ...

... 200 个线程，全部一样
```

`RUNNABLE` 但 CPU 低的原因是：`socketRead0` 是 Native 方法，线程实际在操作系统层面处于 **非忙等**状态——它在等 TCP 数据到达。JVM 视角看是 `RUNNABLE`（线程没有被 Java 级别的锁阻塞），但 OS 视角线程在 `recvfrom()` 系统调用上挂着。

### 2.3 第二步：看代码

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

`new RestTemplate()` 底层使用 `SimpleClientHttpRequestFactory`，基于 `java.net.HttpURLConnection`。**`HttpURLConnection` 的默认超时是 `0`——表示无限等待。** 没有 `connectTimeout`，没有 `readTimeout`。当风控服务变慢时，HTTP 请求永远等下去，Tomcat 线程永不释放。

### 2.4 第三步：事故链

```text
13:00  风控服务数据库故障，响应时间从 50ms → 10s
13:02  支付服务 QPS 300，每秒有 300 个线程开始等待风控响应
13:02  200 个 Tomcat 线程全部被卡在 socketRead0()——支付服务瘫痪
13:04  用户看到"支付失败"，疯狂刷新——更多请求堆积在 TCP backlog 队列
13:05  上游网关层超时，发起重试——增加 2~3 倍请求量
13:05  存活探针 (livenessProbe) 也超时，K8s 开始滚动重启
13:10  重启完成，新 Pod 启动——但风控服务还没恢复，新 Pod 又卡死
13:10  重启→卡死→重启→卡死——无限循环
14:30  运维人员手动切断风控服务调用，启用降级，系统恢复
```

**3 小时停摆。**

如果 `RestTemplate` 设置了 3 秒 `readTimeout`，故障窗口只有风控服务故障的 10 秒——10 秒后所有请求快速失败并释放线程，系统在 10 秒后恢复正常。没有超时 = 一次下游故障 = 整个系统永久的线程窒息。

### 2.5 第四步：修复

```java
@Configuration
public class RestTemplateConfig {

    @Bean
    public RestTemplate restTemplate() {
        // ✅ 方式一：Apache HttpClient 5（推荐）
        RequestConfig requestConfig = RequestConfig.custom()
            .setConnectTimeout(Duration.ofSeconds(2))     // 建立连接超时
            .setConnectionRequestTimeout(Duration.ofSeconds(1))  // 从连接池获取连接超时
            .setResponseTimeout(Duration.ofSeconds(5))    // 等待响应超时
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
|---------|-------------|------------------|--------|
| `connectTimeout` | TCP 三次握手 | `0`（无限） | 2s |
| `connectionRequestTimeout` | 从连接池租连接 | `-1`（无限） | 1s |
| `responseTimeout` (`readTimeout`) | 等待响应数据 | `0`（无限） | 3~5s |

**不设超时 = 把服务的生死交给了下游。** 下游慢了，你就死了。

### 2.6 第五步：超时之外 —— 熔断和隔离

超时是第一条防线。但即使设置了 3 秒超时，如果风控服务一直不可用，每次请求都要等 3 秒才失败——高并发下仍然会有大量线程被临时阻塞。需要补充熔断：

```java
@Service
public class RiskService {

    private final RestTemplate restTemplate;

    // Resilience4j 熔断器
    private final CircuitBreaker circuitBreaker = CircuitBreaker.ofDefaults("riskService");

    public RiskResult check(OrderRequest request) {
        return circuitBreaker.executeSupplier(() ->
            restTemplate.postForObject("http://risk-service/api/check", request, RiskResult.class)
        );
    }

    // 降级方法供熔断器调用
    public RiskResult fallback(OrderRequest request, Throwable t) {
        log.warn("风控服务熔断降级，订单 {} 跳过风控检查", request.getOrderId());
        return RiskResult.pass();  // 降级策略：熔断期间默认通过风控
    }
}
```

熔断器的作用：当风控服务连续失败 N 次，熔断器跳闸（OPEN），后续请求直接走降级，不再等待 3 秒超时。风控服务恢复后，熔断器自动闭合（CLOSED）。这是防止下游故障级联放大成系统整体雪崩的关键机制。

### 2.7 总结：三条防线的体系

```text
第一道防线：超时
  每次调用都有截止时间，过期不候

第二道防线：熔断
  连续失败后直接降级，避免持续消耗资源

第三道防线：隔离
  为不同下游分配独立线程池，一个下游的故障不拖累其他下���
```

```java
// 完整方案：超时 + 熔断 + 线程池隔离
@Configuration
public class HttpClientConfig {

    @Bean("riskRestTemplate")
    public RestTemplate riskRestTemplate() {
        // 超时
        RequestConfig config = RequestConfig.custom()
            .setConnectTimeout(Duration.ofSeconds(2))
            .setResponseTimeout(Duration.ofSeconds(3))
            .build();
        // 隔离：独立连接池
        PoolingHttpClientConnectionManager pool = new PoolingHttpClientConnectionManager();
        pool.setMaxTotal(20);   // 最多 20 个连接给风控服务
        pool.setDefaultMaxPerRoute(20);

        CloseableHttpClient client = HttpClientBuilder.create()
            .setDefaultRequestConfig(config)
            .setConnectionManager(pool)
            .build();
        return new RestTemplate(new HttpComponentsClientHttpRequestFactory(client));
    }
}
```

### 2.8 总结

| 信号 | 含义 | 工具 |
|------|------|------|
| 大量线程 `RUNNABLE` 在 `socketRead0`，CPU 低 | IO 阻塞——等下游响应 | `jstack` |
| `HttpURLConnection` 没有超时 | 会永久等待 | 源码审查 |
| 下游故障 10 秒 → 上游瘫痪 3 小时 | 无超时 + 无熔断的级联放大 | 事故复盘 |
| 重启→卡死→重启循环 | 重启不能解决问题，因为代码未变 | 降级优先于重启 |

**教训：** 任何跨网络的调用，必须设置超时。没有例外。`connectTimeout`、`readTimeout`、`connectionRequestTimeout` 三个参数缺一不可。超时值的选择原则：宁可快失败也不慢等待。失败可以重试，但等待会耗尽线程。

此外：默认 `RestTemplate()` 的底层 `SimpleClientHttpRequestFactory` 没有连接池，每个请求新建一个 TCP 连接——在大并发下不仅慢，还导致 TIME_WAIT 连接堆积。生产环境必须使用 `HttpComponentsClientHttpRequestFactory`（Apache HttpClient 5）或 `Netty4ClientHttpRequestFactory`（WebClient），并显式配置超时。

> **上一篇：** [第 13 章案例集（二）：虚拟线程与综合并发诊断实战](./chapter-13-diagnostics-cases-part2)
>
> **回到第 13 章正文：** [并发问题诊断与性能优化](./chapter-13-diagnostics)
