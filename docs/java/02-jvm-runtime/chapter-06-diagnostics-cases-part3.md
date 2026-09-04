# 案例集（三）：低内存低 CPU 下的 GC 疑难杂症

> 监控大屏一切正常：堆内存 40%、CPU 35%、无 Full GC。但接口 P99 从 50ms 飙到了 450ms，上游超时率 7%。`jstat -gcutil` 每秒跑一次才揭穿谎言：Young GC 每秒 3 次，单次 150ms，累积停顿超过 400ms/秒——45% 的 CPU 时间花在 GC 线程上。这种"温水煮青蛙"式的性能退化最容易被忽视：没有 OOM、没有 CPU 100%、没有 Full GC，所有常规告警全部沉默。排查这类问题的第一原则：**GC 看的是分配速率和对象寿命，不是堆使用率。**

## 1. 案例 7：支付回调的 Young GC 风暴 —— 日志拼接每秒造 300MB 垃圾

### 1.1 事故背景

2025 年某支付系统，回调接口 QPS 稳定在 300+。上线后 P99 从 50ms 逐步爬升到 450ms，隔几秒就有一个请求超时。监控显示堆内存只有 35%，CPU 约 40%，无 Full GC。运维排查了一圈：数据库慢查询、网络延迟、下游服务——都没问题。最后看了一眼 GC 日志，问题藏在这里。

### 1.2 第一步：看 GC 频率

```bash
jstat -gcutil <pid> 1000
```

```txt
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

```txt
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
| :-- | :-- | :-- |
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

```txt
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

```txt
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
| :-- | :-- | :-- | :-- |
| 大规模长生命对象 | 间歇性 Young GC 耗时暴增 | Object Copy 阶段过大 | `MaxTenuringThreshold=1` / 断流预热 |
| 15 分钟周期 + P99 毛刺同步 | 毛刺与索引更新时间吻合 | 索引替换触发的复制风暴 | 灰度分批 + 断流预热 |

## 3. 案例 9：SafePoint 同步延迟 —— GC 只花了 0.14 秒，线程却停了 2.26 秒

### 3.1 事故背景

某离线 HBase 集群，JDK 8 + G1，`-XX:MaxGCPauseMillis=500`。运行一段时间后，垃圾收集停顿经常达到 3 秒以上。GC 日志暴露了一个令人困惑的事实：

```txt
[Times: user=0.12 sys=0.02, real=2.26 secs]
```

user=0.12 秒——GC 线程实际干活只花了 120ms。但 real=2.26 秒——业务线程停了 2260ms。中间的 2.14 秒花在哪了？

### 3.2 第一步：开 SafePoint 日志

```bash
-XX:+PrintSafepointStatistics -XX:PrintSafepointStatisticsCount=1
```

输出：

```txt
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

```txt
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
| :-- | :-- | :-- |
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

```txt
char[]                         2,452,345,678 bytes    ← 24 亿字节！
java.lang.String                 612,345,678 bytes
java.lang.StringBuilder          512,234,567 bytes
```

点开 `char[]` 的引用链：

```txt
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

```txt
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
| :-- | :-- | :-- |
| Eden 每秒满 → Young GC 频率 > 1 次/秒 | `jstat -gcutil 1000` | 案例 7 |
| Object Copy 阶段耗时异常 | G1 GC 日志 `real=` | 案例 8 |
| GC 实际耗时（user）远小于停顿耗时（real） | GC 日志对比 user/real | 案例 9 |
| spin 时间 > 100ms | `-XX:+PrintSafepointStatistics` | 案例 9 |
| 大量等大 `char[]` 直接出现在老年代 | MAT Histogram 按 Shallow Heap 排序 | 案例 10 |

> **上一篇：** [第六章案例集（二）：GC 调优与综合诊断实战](./chapter-06-diagnostics-cases-part2)
>
> **下一篇：** [第六章案例集（四）：堆正常但服务崩了 —— TCP 层与堆外内存的隐形杀手](./chapter-06-diagnostics-cases-part4)
>
> **回到[第六章](./chapter-06-diagnostics)正文：** [线上排查与诊断](./chapter-06-diagnostics)
