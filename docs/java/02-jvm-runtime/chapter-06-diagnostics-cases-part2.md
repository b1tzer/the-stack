# 案例集（三）：低内存低 CPU 下的 GC 疑难杂症

> 监控大屏一切正常：堆内存 40%、CPU 35%、无 Full GC。但接口 P99 从 50ms 飙到了 450ms，上游超时率 7%。`jstat -gcutil` 每秒跑一次才揭穿谎言：Young GC 每秒 3 次，单次 150ms，累积停顿超过 400ms/秒——45% 的 CPU 时间花在 GC 线程上。这种"温水煮青蛙"式的性能退化最容易被忽视：没有 OOM、没有 CPU 100%、没有 Full GC，所有常规告警全部沉默。排查这类问题的第一原则：**GC 看的是分配速率和对象寿命，不是堆使用率。**

## 1. 案例 7：支付回调的 Young GC 风暴 —— 日志拼接每秒造 300MB 垃圾

### 1.1 事故背景

2025 年某支付系统，回调接口 QPS 稳定在 300+。上线后 P99 从 50ms 逐步爬升到 450ms，隔几秒就有一个请求超时。监控显示堆内存只有 35%，CPU 约 40%，无 Full GC。运维排查了一圈：数据库慢查询、网络延迟、下游服务——都没问题。最后看了一眼 GC 日志，问题藏在这里。

### 1.2 第一步：看 GC 频率

```bash
jstat -gcutil <pid> 1000
```

```text
  S0     S1     E      O      M     YGC     YGCT    FGC    FGCT     GCT
  0.00  45.23  98.12  32.45  45.23  1234   185.234    0    0.000  185.234
  0.00  52.34  12.45  32.67  45.24  1235   185.378    0    0.000  185.378
  0.00  48.12  97.89  33.01  45.25  1236   185.512    0    0.000  185.512
  0.00  44.56  15.23  33.12  45.26  1237   185.646    0    0.000  185.646
```

Eden 区每秒从 12% 冲到 98% 再清零——每秒一次 Young GC。单次 YGCT 差 = 134ms。**每秒 134ms 的 STW**，意味着每个请求有约 13% 的概率刚好落在 GC 停顿里，延迟从 50ms 暴涨到 200ms+。

### 1.3 第二步：找谁在造垃圾

用 JFR 的分配采样：

```bash
jcmd <pid> JFR.start duration=60s filename=alloc.jfr
```

在 JMC 中打开 `alloc.jfr`，进入 "Allocation" 面板，按 Total Allocated 排序：

```text
Method                                      | Total Allocated | %
com.example.PaymentCallbackService.callback | 8.2 GB          | 34.2%  ← 60 秒内分配了 8.2GB！
java.lang.StringBuilder.toString()          | 5.1 GB          | 21.3%
java.lang.StringBuilder.append()            | 2.8 GB          | 11.7%
```

每秒分配约 136MB 对象。堆只有 4G，Eden 约 1.3G——10 秒就能打满一次。

### 1.4 第三步：定位代码

```java
@Service
public class PaymentCallbackService {

    public CallbackResult callback(PaymentNotifyRequest req) {
        // 构造日志——每次都 new StringBuilder
        StringBuilder logBuilder = new StringBuilder();
        logBuilder.append("支付回调: orderId=").append(req.getOrderId());
        logBuilder.append(", channel=").append(req.getChannel());
        logBuilder.append(", amount=").append(req.getAmount());
        logBuilder.append(", status=").append(req.getStatus());
        logBuilder.append(", extendParams={");

        // 扩展参数逐个拼接
        for (Map.Entry<String, String> entry : req.getExtendParams().entrySet()) {
            logBuilder.append(entry.getKey()).append("=").append(entry.getValue()).append(",");
        }
        logBuilder.append("}");

        logger.info(logBuilder.toString());  // 每个请求生成 2KB 日志字符串

        // 业务处理...
    }
}
```

300 QPS × 2KB = 600KB/s 的日志字符串。加上迭代器、`Map.Entry`、临时 `StringBuilder`——实际分配速率远超这个数字。JFR 显示 60 秒分配了 8.2GB，平均 137MB/s。堆 4G + Eden 1.3G → 约 10 秒触发一次 Young GC → 单次 134ms → P99 被拉高。

### 1.5 修复：三管齐下

```java
@Service
public class PaymentCallbackService {

    public CallbackResult callback(PaymentNotifyRequest req) {
        // 修复 1：参数化日志
        logger.info("支付回调: orderId={}, channel={}, amount={}, status={}, extendParams={}",
            req.getOrderId(), req.getChannel(), req.getAmount(),
            req.getStatus(), req.getExtendParams());

        // 修复 2：限制日志内容长度（避免超长扩展参数）
        // 修复 3：如果当前日志级别不是 INFO，上面那行根本不会拼接字符串
    }
}
```

参数化日志的核心优势：SLF4J 在日志级别不匹配时，**不会执行参数拼接**，也不创建临时 `StringBuilder`。即使用 `logger.info("...{}...{}...", a, b)`，`a` 和 `b` 只传引用，不在调用处创建新字符串。

### 1.6 效果对比

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| 每秒分配速率 | 137 MB/s | 18 MB/s |
| Young GC 频率 | 每秒 1 次 | 每 8 秒 1 次 |
| 单次 YGCT | 134 ms | 18 ms |
| P99 | 450 ms | 62 ms |
| CPU（GC 线程占比） | ~45% | ~5% |

### 1.7 教训

日志拼接是 Java 服务中最容易被忽视的 GC 压力源。两个常见高危模式：
1. `logger.info("xxx " + a + " yyy " + b)` —— 即使日志级别是 WARN，拼接也照样执行
2. `String.format()` 在日志中 —— 内部有 `synchronized`，是性能杀手

**规则：生产环境日志一律用 `{}` 占位符，永远不要在日志参数中拼接字符串。**

## 2. 案例 8：索引热更新的 Survivor 复制风暴 —— 500MB 对象在新生代来回搬家

### 2.1 事故背景

2025 年京东某高并发系统（QPS 40 万），纯内存计算型服务，无数据库、无缓存、无 RPC。每 15 分钟全量替换一次内存中的业务索引（约 500MB 的复杂 Map 结构）。索引替换后，P99 出现周期性毛刺，上游超时率上升 37%。

关键现象：CPU 和系统负载均正常，排除流量激增、外部依赖、锁竞争。GC 日志暴露了真相。

### 2.2 第一步：看 GC 日志中的 Object Copy 阶段

```bash
-XX:+PrintGCDetails -XX:+PrintGCDateStamps -Xloggc:gc.log
```

```text
[10:00:15.234] GC(421) Pause Young (Normal) (G1 Evacuation Pause)
  [Eden: 3072.0M(3072.0M)->0.0B(3072.0M)
   Survivors: 256.0M->256.0M
   Old:    5120.0M->6200.0M]
  [Times: user=1.85 sys=0.12, real=0.42 secs]
  ← real=0.42 秒！正常 Young GC 应该 < 30ms
```

G1 日志中关注的对象复制（Object Copy）耗时异常——**420ms**。

### 2.3 第二步：看 Survivor 区发生了什么

索引热更新的过程：

```text
1. 加载新索引：500MB 的 Map 结构在 Eden 区创建
2. Eden 区满（3GB + 500MB 新索引 > 3GB）→ 触发 Young GC
3. 这些索引对象大部分会存活 → 复制到 Survivor 区
4. Survivor 区只有 256MB → 装不下 500MB → 晋升老年代
5. 但复制过程本身需要 420ms——所有业务线程在等
```

**根因**：500MB 长生命索引对象在 Survivor 区反复复制，Object Copy 阶段耗时被放大到正常值的 10 倍以上。每次索引替换，有 33%~67% 的概率引发一次长暂停 Young GC。

### 2.4 第三步：修复

**方案 A（JVM 参数）：反向调 `MaxTenuringThreshold`**

```bash
# JDK 默认 MaxTenuringThreshold=15
# 对于 500MB 长生命索引对象，15 次 GC 才晋升 = 15 次复制开销
# 调小 → 让它更快晋升老年代 → 减少复制次数

-XX:MaxTenuringThreshold=1            # 1 次 Young GC 后直接晋升老年代
```

效果：索引在第一次 Young GC 后直接进入老年代，后续 Young GC 不再复制这些对象。Object Copy 阶段从 420ms 降到 25ms。

**方案 B（业务层预热）：断流 + Eden 区预热**

这是京东团队最终采用的方案，发表在 2025 年技术博客中：

```java
public void switchIndex(String indexPath) {
    // 1.【断流】灰度分批，摘掉流量
    registry.deregister();

    // 2.【断流】加载新索引
    MyIndex newIndex = loadIndex(indexPath);
    this.index = newIndex;

    // 3.【断流】Eden 区预热——主动构造垃圾对象，耗尽 Eden，触发 YGC
    // 让新索引在接流之前就被晋升到老年代
    for (int i = 0; i < 10000; i++) {
        byte[] waste = new byte[1024 * 1024];  // 每次 1MB，共 10GB 垃圾
    }
    // 此时 Eden 区已被打满多次，新索引已被晋升到老年代

    // 4.【恢复接流】
    registry.register();
}
```

核心思路：在断流期间主动把 Eden 区打满，触发 Young GC，迫使索引在无业务流量时完成晋升。重新接流后，Eden 区里只有朝生夕灭的 query 对象，Young GC 回到毫秒级。

效果：索引切换时的 P99 恢复正常，系统可用率从 95% 提升到 99.995%。

### 2.5 总结

| 场景特征 | 表象 | 根因 | 修复方向 |
|---------|------|------|---------|
| 大规模长生命对象 | 间歇性 Young GC 耗时暴增 | Object Copy 阶段过大 | `MaxTenuringThreshold=1` / 断流预热 |
| 15 分钟周期 + P99 毛刺同步 | 毛刺与索引更新时间吻合 | 索引替换触发的复制风暴 | 灰度分批 + 断流预热 |

## 3. 案例 9：SafePoint 同步延迟 —— GC 只花了 0.14 秒，线程却停了 2.26 秒

### 3.1 事故背景

某离线 HBase 集群，JDK 8 + G1，`-XX:MaxGCPauseMillis=500`。运行一段时间后，垃圾收集停顿经常达到 3 秒以上。GC 日志暴露了一个令人困惑的事实：

```text
[Times: user=0.12 sys=0.02, real=2.26 secs]
```

user=0.12 秒——GC 线程实际干活只花了 120ms。但 real=2.26 秒——业务线程停了 2260ms。中间的 2.14 秒花在哪了？

### 3.2 第一步：开 SafePoint 日志

```bash
-XX:+PrintSafepointStatistics -XX:PrintSafepointStatisticsCount=1
```

输出：

```text
vmop [threads: total initially_running wait_to_block] [time: spin block sync cleanup vmop] page_trap_count
GC(12) [ 482   3    0 ] [ 2255  0   2   0  140  ] 0
```

关键字段 `spin=2255ms`：VM Thread 发起了 GC 请求（vmop=GC），要求所有业务线程进入安全点（SafePoint）。有 3 个线程已经处于 `initially_running` 状态（正在执行代码），但迟迟未抵达 SafePoint。VM Thread 空转（自旋）等待了 2255ms。

**GC 本身不慢，慢的是等线程"靠边停车"。**

### 3.3 第二步：揪出不肯停车的线程

```bash
-XX:+SafepointTimeout -XX:SafepointTimeoutDelay=2000
```

当等待某线程超过 2000ms 时，JVM 打印：

```text
# SafepointSynchronize::begin: Timeout detected:
# Threads which did not reach the safepoint:
# "RpcServer.listener,port=24600" #32 daemon prio=5
   java.lang.Thread.State: RUNNABLE
```

罪魁祸首是 `RpcServer.listener` 线程，处于 `RUNNABLE`——它在跑，但跑在一个没有 SafePoint 检查点的代码路径上。

### 3.4 第三步：为什么会没有 SafePoint？

HotSpot 在方法调用、循环回边、异常跳转等位置插入 SafePoint 检查。但为了性能，JIT 编译器做了一项优化：对于 **"可数循环"**（`for (int i = 0; i < N; i++)`，索引是 `int` 类型），不插入 SafePoint 检查——因为 JIT 认为可数循环执行时间可控。

但如果循环体很大、或者 `N` 非常大、或者循环内做了网络 I/O，这个"优化"就变成了陷阱：

```java
// RpcServer.listener 线程可能在类似这样的循环里：
while (true) {
    Socket socket = serverSocket.accept();      // 阻塞时没问题（进入 native 后可以 SafePoint）
    byte[] buffer = new byte[4096];
    for (int i = 0; i < Integer.MAX_VALUE; i++) {  // 可数循环，无 SafePoint！
        if (socket.getInputStream().read(buffer) > 0) {
            process(buffer);
        }
        // JIT 认为这是可数循环，不插入 SafePoint 检查
        // 但如果 i 从 0 到 MAX_VALUE 需要跑很久的话...
    }
}
```

### 3.5 修复

**JDK 8 的案发现场修复：**

```bash
-XX:+UseCountedLoopSafepoints     # 强制在可数循环中也插入 SafePoint 检查
```

**JDK 11+ 的更好方案：** 升级到 ZGC，ZGC 的并发标记阶段几乎不依赖全局 SafePoint，即使有线程卡住，影响也大幅降低。

**代码层兜底：** 长循环内插入 `Thread.yield()` 或轻量级方法调用（如 `new Object()`），让线程有机会碰到 SafePoint。

### 3.6 效果

`spin` 时间从 2255ms 降到 3ms，GC 停顿从 2.26 秒恢复到正常的 140ms。

### 3.7 延伸：SafePoint 延迟的常见元凶

| 元凶 | 原因 | 修复 |
|------|------|------|
| 可数循环无 SafePoint | JIT 优化：`int` 索引的循环不插检查 | `-XX:+UseCountedLoopSafepoints` |
| 偏向锁批量撤销 | JDK 8 偏向锁撤销触发长 SafePoint 同步 | `-XX:-UseBiasedLocking`（JDK 15+ 默认关闭） |
| jstack 触发 ThreadDump vmop | jstack 本身需要 SafePoint | 低峰期操作，用 `jcmd Thread.dump_to_file` |
| Native 方法长时间不返回 | Native 代码中无法响应 SafePoint | 拆分长 JNI 调用，加超时 |

## 4. 案例 10：Log4j2 + PretenureSizeThreshold 组合技 —— 2MB 的"日志炸弹"直冲老年代

### 4.1 事故背景

2024 年某线上服务，Full GC 每天 40 次。监控显示堆内存使用率 60%，CPU 40%，不属于典型的"堆打满"场景。但 `jstat -gcutil` 显示老年代在 Full GC 前后几乎不变——说明老年代有大量短命大对象。

### 4.2 第一步：MAT 分析找大对象元凶

```bash
jmap -dump:format=b,file=heap.hprof <pid>
```

MAT 的 Histogram 按 Retained Heap 排序：

```text
char[]                         2,452,345,678 bytes    ← 24 亿字节！
java.lang.String                 612,345,678 bytes
java.lang.StringBuilder          512,234,567 bytes
```

点开 `char[]` 的引用链：

```text
所有 char[] 的 Shallow Heap 都是精确的 2MB+
→ 内容一半是日志文本，一半是 \u0000（空字符填充）
→ 来自 StringBuilder 的预分配机制
```

### 4.3 第二步：查 JVM 参数

```bash
jcmd <pid> VM.flags
```

发现了这颗定时炸弹：

```bash
-XX:PretenureSizeThreshold=2097152    # 大于 2MB 的对象直接进老年代
```

`PretenureSizeThreshold=2MB` 的含义：大于 2MB 的对象不经过 Eden / Survivor，直接分配到老年代。初衷是避免大对象在新生代来回复制。

但日志框架的 `StringBuilder` 在拼接长日志时，内部 `char[]` 会扩容到 2MB 以上——然后被这个参数判定为"大对象"，直接写入老年代。

### 4.4 第三步：链条复盘

```text
1. 业务代码用 StringBuilder 拼接日志（扩展参数多、内容长）
2. StringBuilder 内部 char[] 扩容到 2MB+
3. -XX:PretenureSizeThreshold=2097152 判定为大对象 → 直接分入老年代
4. 老年代充斥着大量「用完即弃」的日志 StringBuilder
5. 老年代迅速碎片化 → Full GC 频繁
6. 但 Full GC 后这些对象被回收 → 堆使用率看起来不高
```

### 4.5 修复

```bash
# 去掉 PretenureSizeThreshold，让 JVM 自己判断
# 或者至少调到 10MB 以上，避免日志 StringBuilder 误入老年代

# ✅ 移除这个参数，或者：
-XX:PretenureSizeThreshold=10485760    # 只有 >10MB 才直接进老年代
```

同时修复日志写法：

```java
// ❌ 原代码：StringBuilder 拼接 + 完整扩展参数 + 全量日志内容
// ✅ 参数化日志 + 截断超长参数
logger.info("回调处理完成: orderId={}, channel={}, params={}",
    req.getOrderId(),
    req.getChannel(),
    truncate(req.getExtendParams(), 200));  // 最多 200 字符
```

### 4.6 效果

Full GC 从每天 40 次降到不到 1 次，老年代使用率稳定在 35%。

### 4.7 总结

`PretenureSizeThreshold` 是一把双刃剑。它在"确实有大对象需要跳过新生代"时有用（如缓存的大 ByteBuffer），但如果设置过低，会误伤大量"恰好超过阈值"的短命对象——把它门直接送进老年代，制造碎片和 Full GC。**除非你精确知道自己的大对象是什么、有多大，否则不要设置这个参数。**

## 5. 四个案例的共同诊断信号

| 信号 | 工具 | 本案例编号 |
|------|------|----------|
| Eden 每秒满 → Young GC 频率 > 1 次/秒 | `jstat -gcutil 1000` | 案例 7 |
| Object Copy 阶段耗时异常 | G1 GC 日志 `real=` | 案例 8 |
| GC 实际耗时（user）远小于停顿耗时（real） | GC 日志对比 user/real | 案例 9 |
| spin 时间 > 100ms | `-XX:+PrintSafepointStatistics` | 案例 9 |
| 大量等大 `char[]` 直接出现在老年代 | MAT Histogram 按 Shallow Heap 排序 | 案例 10 |

## 6. 案例 11：Tomcat LimitLatch —— 一条陈年配置让服务间歇性假死

### 6.1 事故背景

2025 年某团队将一个 Spring Boot 服务部署到生产环境后，出现间歇性请求超时——每次卡 10 秒以上，但日志里没有任何业务异常。更诡异的是，容器的 `livenessProbe` 也间歇性超时，触发 K8s 自动重启。重启后恢复，过一段时间又复发。

该团队排查了一圈：
- GC 日志正常，无 Full GC
- CPU / 内存正常
- 数据库连接池正常
- 下游依赖都健康
- `jstack` 跑了三遍，每次 Tomcat 工作线程（`http-nio-8080-exec-*`）都在 `WAITING` 状态等任务——看起来一切正常

这个问题最讽刺的是：真相在第一次 `jstack` 里就已经出现了，但排查者看了三遍都没注意到。详见萧易客的完整复盘：<https://aops.io/article/tomcat-blocking-on-acceptor.html>。

### 6.2 第一步：第一次 jstack —— 错过了真凶

```bash
jstack -l <pid> > thread.dump
```

排查者的注意力全部集中在 Tomcat 工作线程上：

```text
"http-nio-8080-exec-1" #42 daemon prio=5
   java.lang.Thread.State: WAITING (parking)
    at sun.misc.Unsafe.park(Native Method)
    at java.util.concurrent.locks.LockSupport.park(LockSupport.java:175)
    at java.util.concurrent.LinkedBlockingQueue.take(LinkedBlockingQueue.java:442)
    at org.apache.tomcat.util.threads.TaskQueue.take(TaskQueue.java:98)
    ...
```

"http-nio-8080-exec-2" 到 "http-nio-8080-exec-200"——全部 `WAITING`。排查者得出结论：工作线程都在等活干，不是线程池的问题。方向转向了 GC、网络、数据库——全都没有问题。排查陷入僵局。

### 6.3 第二步：开启 Tomcat DEBUG 日志 —— 发现盲点

排查者决定扩大范围，开启 Tomcat 的内部 DEBUG 日志，追踪每个请求从到达 Tomcat 到完成的全过程时序：

```yaml
logging:
  level:
    org.apache.tomcat: DEBUG
    org.apache.catalina: DEBUG
```

日志中出现了反复出现的一条记录：

```text
o.apache.tomcat.util.threads.LimitLatch : Counting up[http-nio-8080-Acceptor-0] latch=10
o.apache.tomcat.util.threads.LimitLatch : Counting up[http-nio-8080-Acceptor-0] latch=10
o.apache.tomcat.util.threads.LimitLatch : Counting up[http-nio-8080-Acceptor-0] latch=10
```

`latch=10` —— 当前连接数持续等于最大值 10。这个类名 `LimitLatch` 触发了排查者的记忆：**Tomcat 用 `LimitLatch`（基于 AQS 的共享锁）来限制最大连接数。** 当连接数达到上限时，Acceptor 线程被阻塞，无法 `accept()` 新的 TCP 连接。

他立刻回去翻之前的 `jstack` 输出——Acceptor 线程一直都在那里，但被忽略了：

```text
"http-nio-8080-Acceptor-0" #19 daemon prio=5
   java.lang.Thread.State: WAITING (parking)
    at sun.misc.Unsafe.park(Native Method)
    at java.util.concurrent.locks.LockSupport.park(LockSupport.java:175)
    at java.util.concurrent.locks.AbstractQueuedSynchronizer.doAcquireSharedInterruptibly(...)
    at java.util.concurrent.locks.AbstractQueuedSynchronizer.acquireSharedInterruptibly(...)
    at org.apache.tomcat.util.threads.LimitLatch.countUpOrAwait(LimitLatch.java:115)
    at org.apache.tomcat.util.net.AbstractEndpoint.countUpOrAwaitConnection(...)
    at org.apache.tomcat.util.net.NioEndpoint$Acceptor.run(NioEndpoint.java:787)
```

Acceptor 线程处于 `WAITING`，卡在 `LimitLatch.countUpOrAwait()`。这意味着：当前 TCP 连接数已达到 `maxConnections` 上限，Acceptor 被 AQS 共享锁阻塞，不再从内核的 `backlog` 队列中取新连接。

### 6.4 第三步：验证连接数上限

用 `ss` 命令查看 TCP 连接队列状态：

```bash
ss -tnp | grep :8080
```

输出显示与 8080 端口的 `ESTABLISHED` 连接恰好 10 个。`Recv-Q` 列的值持续 > 0——说明内核的 `backlog` 队列中有连接在排队，等待 `accept()` 取走。

### 6.5 第四步：翻出罪魁祸首

在 `application.yml` 的一个不起眼的角落里：

```yaml
server:
  tomcat:
    max-connections: 10   # ← 谁加的？为什么是 10？
```

Tomcat NIO 模式下 `max-connections` 默认值是 10000。这里被改成了 10。而前方的 Nginx 配置了 `worker_processes 16`——16 个 worker 每个维护一个到后端的 keep-alive 长连接，理论上 16 个连接就超过了 Tomcat 的上限 10。

但正常运行时为什么没有立即出问题？因为 keep-alive 连接不是始终占满的——有些连接处于空闲状态，Tomcat 的连接计数在请求处理间隙会短暂回落。所以不是所有请求都超时，而是间歇性的：当第 11 个 Nginx worker 恰好发起请求时，Acceptor 被阻塞，新连接只能在 `backlog` 队列里等，等的时间就是某个现有连接释放的间隔——最多可以长达 keep-alive timeout（默认 20 秒）。

这就是"间歇性假死"的完整成因。

### 6.6 Tomcat 线程模型补充说明

理解这个问题需要知道 Tomcat 的一条连接是怎么被交给 worker 线程处理的：

```text
客户端 → OS TCP backlog 队列 → Acceptor 线程 accept() → 连接计数 +1
  → Poller 线程注册到 Selector → Poller 检测到可读事件
  → 交给 Worker 线程池处理（http-nio-8080-exec-*）
  → 处理完毕 → 连接计数 -1
```

Acceptor 线程**只负责 `accept()` 新连接**。它不处理请求，不解包 HTTP，不执行业务逻辑。它只做一件事：收到新连接，转交给 Poller，然后立刻去接下一个。如果 Acceptor 被 `LimitLatch` 卡住——整个服务就停止接收新连接，但已经在处理中的请求完全不受影响。

这解释了为什么 `http-nio-8080-exec-*` 线程在 `jstack` 里全是 `WAITING`——它们确实在等活干，因为根本没有新连接进来。

### 6.7 第五步：修复

最简单的修复就是删掉那条配置：

```yaml
# 删除 server.tomcat.max-connections: 10
# Tomcat NIO 模式下默认 10000，足够绝大多数场景使用
```

或者，如果确实有连接数管控需求，至少要知道基准：

```yaml
server:
  tomcat:
    max-connections: 10000     # 连接数上限（默认 10000）
    accept-count: 200           # backlog 队列长度（默认 100）
    max-threads: 200            # worker 线程数（默认 200）
```

三个参数的关系：

```text
操作系统 TCP backlog（由 acceptCount 控制）
  └→ Acceptor 线程 accept() 后进入 maxConnections 计数的连接池
       └→ Poller 检测到可读数据后交给 maxThreads 个 worker 线程处理
```

**黄金比例：`maxConnections` ≥ `maxThreads` + `acceptCount`**。如果 maxConnections 设得太小，连接在内核 backlog 还没满时就被 LimitLatch 拦截，新连接直接卡在 Acceptor 上无人处理。

### 6.8 总结

| 信号 | 含义 | 工具 |
|------|------|------|
| 工作线程全部 `WAITING`，CPU 低 | 没有新请求进来——问题可能在 Acceptor | `jstack` |
| Acceptor 线程停在 `LimitLatch.countUpOrAwait` | maxConnections 已打满 | `jstack` |
| `ss -tnp` 显示连接数恰好 = 某整数 | 确认上限值 | `ss` |
| `Recv-Q` > 0 | 有连接在等待被 accept | `ss` |

**教训：** `jstack` 不是跑一遍就够的。排查者第一反应是看 worker 线程有没有卡在业务代码里，发现没有就转向 GC / 数据库 / 网络——全程忽略了 Acceptor 线程。线程名上的 `Acceptor` 字眼本身就暗示了它的角色，但排查时被选择性跳过。排障没有捷径：每条线程都要读，每个你不认识的类名都要追。

此外：任何环境里的任何配置，你都必须知道它是怎么来的、为什么是这个值。`max-connections=10` 可能是一次压测时的临时调整、某个"最佳实践"博客里的推荐值、或者某个前辈留下的"为了防止连接数打满"的保护措施——但无论哪种，在大批量 Nginx worker 的长连接面前都是灾难。

## 7. 案例 12：Netty 直接内存泄漏 —— 堆正常但容器被 OOMKilled

### 7.1 事故背景

2025 年某 API 网关服务（基于 Spring Cloud Gateway + Netty），部署在 Kubernetes 上，4C8G，`-Xmx4g`。上线一段时间后，Pod 开始出现规律性 OOMKilled——每 2~3 小时重启一次，但监控显示 JVM 堆使用率从未超过 45%，GC 次数和耗时均在正常范围。没有 `OutOfMemoryError` 日志，没有 heap dump 文件，Pod 直接消失。

类似事件在开发者社区并不罕见。亚马逊 Corretto 的 GitHub Issue #225 记录了一个几乎完全一致的故障：Spring Boot 3.1.3 + Corretto 17.0.6，RSS 持续增长直到触发容器 OOM，但堆使用率正常——最终定位到内存分配器的碎片化问题。Michal Drozd 的博客 "Java OOMKilled With Stable Heap" 也详细分析了这类故障的排查方法论：堆外内存（Direct Memory）、线程栈、glibc arena 三者构成了堆之外的"隐形内存消耗"，在容器环境下尤其致命。

### 7.2 第一步：确认是 K8s OOMKilled，不是 JVM OOM

```bash
kubectl describe pod <pod-name>
```

```text
State:          Terminated
  Reason:       OOMKilled
  Exit Code:    137
```

Exit Code 137 = `128 + 9`（SIGKILL）。这是 Linux OOM Killer 直接杀进程——不是因为 JVM 抛了 `OutOfMemoryError`，而是容器总 RSS 超过 `resources.limits.memory`。

用 `kubectl top pod` 看 RSS：

```text
NAME                          CPU(cores)   MEMORY(bytes)
gateway-pod-xxx               450m         7850Mi   ← 接近 8G limit
```

### 7.3 第二步：确认堆内存正常

```bash
jstat -gcutil <pid> 1000 5
```

```text
  S0     S1     E      O      M     YGC     YGCT    FGC    FGCT     GCT
  0.00  42.15  56.23  38.12  72.11  1234   23.456    2    1.234   24.690
  0.00  38.45  78.34  39.01  72.12  1235   23.489    2    1.234   24.723
  0.00  35.12  22.45  40.23  72.13  1236   23.523    2    1.234   24.757
  0.00  44.23  91.34  41.12  72.13  1237   23.556    2    1.234   24.790
```

老年代仅 40%，Full GC 两小时才 2 次。堆确实没有问题。但 `jmap -histo` 也看不出异常——前几名依然是正常的 `char[]`、`String`、`HashMap$Node`。这让人迷惑：RSS 接近 8G，堆只用了不到 2G，剩下的 6G 去哪了？

### 7.4 第三步：开启 NMT 追踪堆外内存

问题的关键是启用 Native Memory Tracking：

```bash
# 重启时加上 NMT 参数（需要重启，NMT 不能动态开启）
-XX:NativeMemoryTracking=detail
```

等待一段时间后，用 `jcmd` 查看 Native Memory 分布：

```bash
jcmd <pid> VM.native_memory summary
```

输出：

```text
Native Memory Tracking:

Total: reserved=7245MB, committed=6812MB

-    Java Heap (reserved=4096MB, committed=1834MB)  ← 堆不到 2G
          (mmap: reserved=4096MB, committed=1834MB)

-        Thread (reserved=412MB, committed=412MB)    ← 线程栈正常
          (thread #103)

-          Code (reserved=256MB, committed=128MB)    ← JIT 编译缓存正常

-            GC (reserved=384MB, committed=384MB)    ← GC 辅助结构

-     Metaspace (reserved=128MB, committed=120MB)    ← 元空间正常

-       NIO/Direct (reserved=1842MB, committed=1842MB)  ← 这里！！1.8G 直接内存！
```

`NIO/Direct` 占用了 1.8GB——几乎等于堆的大小。这是 Netty 的 `DirectByteBuffer`。加上堆的 1.8G（committed）、线程栈 400M、Metaspace 120M、Code Cache 128M、GC 辅助结构 384M——总计约 6.6G，再加上 glibc `malloc` 的 arena 碎片（每个 arena 预分配 64MB，在 8G 容器中默认 8 个 arena = 512MB），总 RSS 轻松超过 8G limit。

### 7.5 第四步：定位泄漏的 ByteBuf

开启 Netty 资源泄漏检测：

```bash
-Dio.netty.leakDetectionLevel=paranoid
```

注意：`paranoid` 级别会 100% 追踪每个 ByteBuf 的生命周期，性能开销约 20%~30%，仅在排查阶段使用，排查完立即关闭或降为 `simple`。

几分钟后，日志中出现：

```text
LEAK: ByteBuf.release() was not called before it's garbage-collected.
See https://netty.io/wiki/reference-counted-objects.html for more information.
Recent access records:
#1:
  io.netty.handler.codec.http.HttpObjectDecoder.decode(HttpObjectDecoder.java:234)
  io.netty.handler.codec.http.HttpObjectDecoder.decode(HttpObjectDecoder.java:145)
  io.netty.handler.codec.ByteToMessageDecoder.callDecode(ByteToMessageDecoder.java:480)
  ...
#2:
  com.example.gateway.filter.ResponseModifyFilter.filter(ResponseModifyFilter.java:67)
  ...
Created at:
  io.netty.buffer.PooledByteBufAllocator.newDirectBuffer(PooledByteBufAllocator.java:402)
  io.netty.buffer.AbstractByteBufAllocator.directBuffer(AbstractByteBufAllocator.java:187)
  ...
```

泄漏定位在 `ResponseModifyFilter.filter()`——一个自定义的响应修改过滤器。

### 7.6 第五步：看代码

```java
@Component
public class ResponseModifyFilter implements GlobalFilter {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpResponseDecorator decoratedResponse =
            new ServerHttpResponseDecorator(exchange.getResponse()) {
                @Override
                public Mono<Void> writeWith(Publisher<? extends DataBuffer> body) {
                    return super.writeWith(Flux.from(body).map(dataBuffer -> {
                        // 读取响应体内容
                        byte[] content = new byte[dataBuffer.readableByteCount()];
                        dataBuffer.read(content);
                        String bodyStr = new String(content, StandardCharsets.UTF_8);

                        // 修改响应体
                        String modified = modifyBody(bodyStr);

                        // 构造新的 DataBuffer 返回
                        // ⚠️ 问题：原 dataBuffer 没有 release()！
                        return exchange.getResponse().bufferFactory()
                            .wrap(modified.getBytes(StandardCharsets.UTF_8));
                    }));
                }
            };
        return chain.filter(exchange.mutate().response(decoratedResponse).build());
    }
}
```

在 Netty 中，`DataBuffer` 底层是 Netty 的 `ByteBuf`，属于引用计数对象。当 `writeWith()` 的回调返回新的 `DataBuffer` 后，Netty 会自动 release 新返回的那个 buffer——**但原始的 `dataBuffer`（从上游传下来的）的 release 责任在回调代码中**。如果回调只消费了它的内容但没有调用 `release()`，`dataBuffer` 对应的堆外内存块就永远不会被释放。

这就是 Netty 引用计数模型的核心陷阱：**消费方必须负责释放**。而且 `dataBuffer.read(content)` 只是把数据拷贝到字节数组——并不隐含 release。`release()` 必须显式调用。

每次请求的响应体大约 1~5KB，请求 QPS 约 3000，每小时约 1000 万次请求——每个都泄漏 1~5KB 的 Direct Buffer → 每小时泄漏约 10~50GB 的堆外内存——虽然 `DirectByteBuffer` 的 Cleaner 在 GC 时会回收一部分，但在高吞吐下包装清理跟不上分配速度，净泄漏速率仍然可观。

### 7.7 第六步：修复

```java
@Override
public Mono<Void> writeWith(Publisher<? extends DataBuffer> body) {
    return super.writeWith(Flux.from(body).map(dataBuffer -> {
        try {
            byte[] content = new byte[dataBuffer.readableByteCount()];
            dataBuffer.read(content);
            String bodyStr = new String(content, StandardCharsets.UTF_8);
            String modified = modifyBody(bodyStr);
            return exchange.getResponse().bufferFactory()
                .wrap(modified.getBytes(StandardCharsets.UTF_8));
        } finally {
            // ✅ 关键：释放原始 buffer
            DataBufferUtils.release(dataBuffer);
        }
    }));
}
```

`DataBufferUtils.release()` 是 Spring 提供的便捷方法，内部调用 Netty 的 `ReferenceCountUtil.release()`。`try-finally` 保证即使 `modifyBody()` 抛异常，buffer 也能被释放。

### 7.8 防止再次发生的防御措施

```bash
# 1. 显式限制直接内存上限（容器 8G，堆 4G，给直接内存 1G）
-XX:MaxDirectMemorySize=1g

# 2. 容器环境确保 JVM 感知 cgroup 限制
-XX:+UseContainerSupport
-XX:MaxRAMPercentage=60.0

# 3. 保留泄漏检测（simple 级别，性能开销 < 1%）
-Dio.netty.leakDetectionLevel=simple

# 4. 开启 NMT 用于事后分析
-XX:NativeMemoryTracking=summary
```

容器内存分配建议：

| 组件 | 占比 | 8G 容器 |
|------|------|---------|
| Java Heap | 50~60% | 4G |
| Direct Memory | 10~15% | 1G |
| Thread Stacks | 10~15% | 800M |
| Metaspace / Code Cache / GC | 15~20% | 1G |
| 系统预留 | ~10% | 1G |

### 7.9 排查堆外内存问题的工具链

| 层级 | 工具 | 适用场景 |
|------|------|---------|
| 进程级 | `kubectl describe pod` / `dmesg` | 确认 OOMKilled，排除 JVM OOM |
| 堆级 | `jstat -gcutil` / `jmap -histo` | 确认堆内存正常（从而推断问题在堆外） |
| 堆外总览 | `jcmd VM.native_memory summary` | 按区域看内存分布，定位到 Direct / Thread / Metaspace |
| 直接内存 | `-Dio.netty.leakDetectionLevel=paranoid` | 定位 Netty ByteBuf 泄漏的代码位置 |
| 容器级 | `kubectl top pod` / Prometheus `container_memory_rss` | 实时监控 RSS 趋势 |

### 7.10 总结

| 信号 | 含义 | 工具 |
|------|------|------|
| Pod OOMKilled、堆正常 | 问题不在堆——在堆外内存 | `kubectl describe pod` + `jstat` |
| NMT 中 `NIO/Direct` 持续增长 | 直接内存泄漏 | `jcmd VM.native_memory summary` |
| `LEAK: ByteBuf.release() was not called` | Netty 引用计数泄漏 | `-Dio.netty.leakDetectionLevel=paranoid` |
| RSS - Heap >> 1G | 堆外内存占据大头，需逐区域排查 | `kubectl top pod` - `jstat` 堆使用量 |

**教训：** 堆内存只是 Java 进程总内存的一部分。在容器环境下，K8s 的 `limits.memory` 限制的是整个进程的 RSS——包括堆、直接内存、线程栈、元空间、Code Cache、glibc arena 碎片、JNI 本地内存等。只看 JVM 堆是远远不够的。Michal Drozd 在博客中总结了一个经验法则：**永远给容器预留 40%~50% 的内存给堆外区域**。只设 `-Xmx` 不设 `-XX:MaxDirectMemorySize`，等于把直接内存的上限交给了物理内存——而在容器里，"物理内存"就是 limit 值，超了就杀。

> **上一篇：** [第六章案例集（一）：CPU 飙升、内存泄漏与 GC 调优实战](./chapter-06-diagnostics-cases-part1)
>
> **回到[第六章](./chapter-06-diagnostics)正文：** [线上排查与诊断](./chapter-06-diagnostics)
