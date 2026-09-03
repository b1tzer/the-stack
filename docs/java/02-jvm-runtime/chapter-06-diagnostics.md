# 线上排查与诊断

> 凌晨三点 CPU 100% 告警。`top` 看 pid → `jstack` dump 线程栈 → 几百个 `RUNNABLE` 线程栈顶全是 `HashMap.get()`——你以为找到了根因。但再看 `vmstat`，context switch 每秒才 200——不是业务线程在烧 CPU，是所有线程在 `while(true)` 自旋等锁。排查方向从「慢查询」180 度转向「锁竞争」——只差一个 `vmstat`。线上排障最怕的不是查不到，是查对了方向但看了错误的数据。

## 1. JVM 常见故障速查

| 现象 | 首选诊断方向 |
| :-- | :-- |
| CPU 100% | `top -Hp <pid>` → 找最忙的线程 → `jstack` 看栈 |
| 频繁 Full GC | GC 日志 → 内存 dump → MAT 分析大对象 |
| OOM | `-XX:+HeapDumpOnOutOfMemoryError` → MAT 分析 |
| StackOverflow | 检查无限递归 / 过深调用栈 |
| Metaspace OOM | 检查动态代理/反射/脚本引擎是否生成大量类 |

## 2. CPU 100% 诊断流程

```bash
# 1. 找到 Java 进程 PID
jps -l

# 2. 找到 CPU 最高的线程
top -Hp <pid>

# 3. 将线程 ID 转为十六进制
printf "%x\n" <tid>

# 4. 在 thread dump 中查找该线程
jstack <pid> | grep -A 30 "<tid in hex>"
```

输出的栈信息会告诉你这个线程在执行什么代码。常见的根因有四种：

**根因一：死循环或正则回溯**

```txt
"Thread-1" #12 prio=5 os_prio=0 cpu=985421.23ms
   java.lang.Thread.State: RUNNABLE
    at com.example.Processor.process(Processor.java:45)  ← 死循环位置
    at com.example.Handler.handle(Handler.java:23)
```

特征：线程状态为 RUNNABLE，CPU 时间极高。如果是正则回溯（ReDoS），栈顶通常有 `java.util.regex.Pattern` 相关方法。

**根因二：GC 线程占用**

```txt
"GC task thread#0 (ParallelGC)" os_prio=0 cpu=892341.56ms
```

特征：`top -Hp` 中 CPU 最高的不是应用线程而是 GC 线程。说明频繁 GC 导致 CPU 被 GC 线程占用。先查 GC 日志，确认是否 FGC 频繁。

**根因三：锁竞争（自旋）**

```txt
"Thread-2" #13 prio=5 os_prio=0 cpu=567823.12ms
   java.lang.Thread.State: RUNNABLE
    at com.example.SharedResource.access(SharedResource.java:30)
    - waiting to lock <0x00000007aab3a0d0>  ← 等待锁
```

特征：多个线程状态为 BLOCKED 或 RUNNABLE 但都在等同一把锁。持锁线程可能在做慢操作（I/O、慢查询）。

**根因四：JIT 编译**

```txt
"CompilerThread0" os_prio=0 cpu=345212.78ms
```

特征：`top -Hp` 中 CPU 最高的是 `CompilerThread`，说明 JIT 正在编译大量代码。通常是正常的预热行为，如果持续占用则需检查 CodeCache。

## 3. Heap Dump 分析

### 3.1 获取方式

```bash
# 方式 1：OOM 时自动生成（推荐，线上必开）
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/path/to/dumps/

# 方式 2：手动 dump
jmap -dump:format=b,file=heap.hprof <pid>

# 方式 3：Arthas
heapdump /path/to/heap.hprof
```

### 3.2 MAT（Memory Analyzer Tool）四大核心功能

**1. Leak Suspects Report。** 自动分析 dump 文件，识别可疑的内存泄漏点。

**2. Histogram。** 按类统计对象数量和占用空间。找到"数量异常多"或"占用异常大"的类。

**3. Dominator Tree。** 找到阻止 GC 回收的最大对象——这些对象持有了大量其他对象的引用。

**4. Path to GC Roots。** 从某个对象出发，追溯到 GC Root 的引用链。回答"为什么这个对象没有被回收"。

### 3.3 MAT 实战：分析一次内存泄漏

**场景：** 应用运行一段时间后 OOM，拿到 dump 文件用 MAT 分析。

**第一步：打开 Leak Suspects Report**

MAT 自动分析后报告：

```txt
Problem Suspect 1:
  4,523 instances of "com.example.CacheEntry", loaded by "app classloader"
  occupy 1,892,345,678 bytes (45.2% of heap)

  These instances are referenced from:
    java.util.HashMap @ 0x7f8b2c012340
      → com.example.CacheManager.cache (CacheManager.java:15)
```

MAT 告诉你：`CacheEntry` 对象占了堆的 45%，被 `CacheManager` 的 `cache` 字段（一个 HashMap）持有。

**第二步：用 Dominator Tree 确认**

打开 Dominator Tree，按 Retained Heap 排序：

```txt
com.example.CacheManager @ 0x7f8b2c012300
  └─ java.util.HashMap @ 0x7f8b2c012340
       └─ java.util.HashMap$Node[16384] @ 0x7f8b2c020000
            └─ 4,523 x CacheEntry (每个 418KB)
```

`CacheManager` 的 Retained Heap = 1.8GB，它阻止了这 4,523 个 CacheEntry 被 GC 回收。

**第三步：定位代码**

CacheManager 是一个单例，`cache` 字段是一个只增不减的 HashMap。添加 TTL 和容量限制后问题解决。

## 4. Thread Dump 分析

```bash
# 获取方式
jstack <pid>              # 推荐
kill -3 <pid>             # 输出到 stdout
Arthas: thread            # 交互式分析
```

### 4.1 关键线程状态

| 状态 | 含义 | 关注点 |
| :-- | :-- | :-- |
| RUNNABLE | 正在运行或等待 CPU | CPU 热点线程 |
| BLOCKED | 等待获取锁 | 锁竞争问题 |
| WAITING | 无限期等待 | `wait()`、`join()`、`park()` |
| TIMED_WAITING | 限时等待 | `sleep()`、`wait(timeout)` |

### 4.2 死锁检测

`jstack` 输出末尾会自动检测死锁：

```txt
Found one Java-level deadlock:
=============================
"Thread-1":
  waiting to lock monitor 0x00007f8b4c003a18 (object 0x00000007aab3a0d0, a java.lang.Object),
  which is held by "Thread-0"
"Thread-0":
  waiting to lock monitor 0x00007f8b4c006358 (object 0x00000007aab3a0e0, a java.lang.Object),
  which is held by "Thread-1"
```

### 4.3 非死锁场景：多线程 BLOCKED 在同一把锁

比死锁更常见的情况是多个线程 BLOCKED 在同一把锁上：

```txt
"http-nio-8080-exec-1" #15 prio=5
   java.lang.Thread.State: BLOCKED
    at com.example.OrderService.createOrder(OrderService.java:30)
    - waiting to lock <0x00000007aab3a0d0> (a java.lang.Object)
    which is held by "http-nio-8080-exec-5"

"http-nio-8080-exec-2" #16 prio=5
   java.lang.Thread.State: BLOCKED
    at com.example.OrderService.createOrder(OrderService.java:30)
    - waiting to lock <0x00000007aab3a0d0> (a java.lang.Object)
    which is held by "http-nio-8080-exec-5"

"http-nio-8080-exec-3" #17 prio=5
   java.lang.Thread.State: BLOCKED
    at com.example.OrderService.createOrder(OrderService.java:30)
    - waiting to lock <0x00000007aab3a0d0> (a java.lang.Object)
    which is held by "http-nio-8080-exec-5"
```

三个线程都在等同一把锁，持锁线程是 `exec-5`。接下来搜索 `exec-5` 的栈信息：

```txt
"http-nio-8080-exec-5" #20 prio=5
   java.lang.Thread.State: RUNNABLE
    at java.net.SocketInputStream.socketRead0(Native Method)
    at com.example.OrderService.createOrder(OrderService.java:31)
    - locked <0x00000007aab3a0d0> (a java.lang.Object)
```

`exec-5` 持有锁，但在做网络 I/O（socketRead0）——它在等数据库响应。这就是所有其他线程被阻塞的根因：**持锁线程在同步 I/O 上阻塞**。

修复方向：将同步 I/O 移出 synchronized 块，或改用异步 I/O。

## 5. Arthas 核心命令

Arthas 是阿里开源的 Java 诊断工具，无需重启即可实时诊断线上问题。

| 命令 | 用途 | 示例 |
| :-- | :-- | :-- |
| `dashboard` | 实时看板（线程、内存、GC） | `dashboard` |
| `thread` | 线程分析 | `thread -n 3`（最忙的 3 个线程） |
| `thread -b` | 查找阻塞线程 | `thread -b` |
| `trace` | 方法调用链路耗时 | `trace com.example.UserService getUser` |
| `jad` | 反编译线上代码 | `jad com.example.UserService` |
| `watch` | 方法入参/返回值/异常 | `watch com.example.UserService getUser '{params, returnObj}'` |
| `heapdump` | 生成 dump 文件 | `heapdump /tmp/dump.hprof` |
| `ognl` | 执行表达式 | `ognl '@com.example.Config@getInstance()'` |

### 5.1 常用诊断场景

**场景 1：接口变慢**

```bash
# 追踪方法耗时，找出哪个调用慢
trace com.example.OrderService createOrder

# 输出
+---[3.2ms] com.example.OrderService:createOrder()
    +---[1.1ms] com.example.UserDao:findById()
    +---[0.8ms] com.example.OrderDao:save()
    +---[1.2ms] com.example.NotificationService:send()  ← 这里最慢
```

**场景 2：确认线上代码是否最新**

```bash
# 反编译正在运行的代码
jad com.example.OrderService

# 对比源码，确认是否是最新版本
```

**场景 3：查看方法参数和返回值**

```bash
# 监控方法调用
watch com.example.UserService getUser '{params[0], returnObj}' -x 2

# 输出
params[0]: 12345
returnObj: User{id=12345, name='Tom', age=25}
```

## 6. JFR（Java Flight Recorder）

JFR 是 JDK 内置的低开销性能分析工具，可以在生产环境持续录制，事后用 JDK Mission Control（JMC）分析。

**启动录制：**

```bash
# 录制 60 秒，输出到文件
jcmd <pid> JFR.start duration=60s filename=recording.jfr

# 持续录制（手动停止）
jcmd <pid> JFR.start settings=profile filename=continuous.jfr
jcmd <pid> JFR.stop

# 查看正在录制的任务
jcmd <pid> JFR.check
```

**JFR 能看到什么：**

| 数据类别 | 内容 |
| :-- | :-- |
| CPU 热点 | 哪个方法消耗最多 CPU |
| 内存分配 | 哪个方法分配了最多对象 |
| 锁竞争 | 哪把锁等待时间最长 |
| GC 事件 | 每次 GC 的耗时和回收量 |
| I/O | 文件和网络 I/O 的耗时 |
| 线程 | 线程状态变化、死锁检测 |

**JMC 分析：**

```bash
# 打开 JMC 图形界面
jmc
```

JMC 提供自动分析功能，能标记出潜在的性能问题（如"方法编译时间过长"、"GC 停顿过长"）。JFR 的优势是开销极低（< 1%），适合生产环境 7×24 持续录制。

### 6.1 JFR 分析实战

**场景：** 用 JFR 录制了 60 秒的生产环境运行数据，用 JMC 打开分析。

**第一步：看 JMC 的自动分析结果**

JMC 打开 `.jfr` 文件后，左侧 "Rule Results" 中自动标记了问题：

```txt
⚠️ Hot Methods:
  com.example.QueryBuilder.buildQuery() — 占用 12.3% CPU
  java.util.regex.Pattern.matches() — 占用 8.7% CPU

⚠️ GC Stall:
  GC 暂停时间平均 234ms，超过阈值 200ms

⚠️ Lock Instances:
  java.util.concurrent.ConcurrentHashMap @ 0x7f8b — 平均等待 45ms
```

**第二步：看 CPU 热点**

点击 "Hot Methods"，看到 `QueryBuilder.buildQuery()` 消耗了 12.3% CPU。展开调用栈，发现这个方法在循环中反复拼接字符串。

**第三步：看内存分配**

点击 "Allocation"，发现 `QueryBuilder` 每次调用分配了大量临时 `StringBuilder` 和 `String` 对象。这些对象在新生代被快速回收，但频繁分配导致 Young GC 频繁。

**第四步：修复**

将字符串拼接改为预分配的 `StringBuilder`，减少临时对象分配。再次录制确认 CPU 和 GC 均有改善。

## 7. 工具选择指南

遇到问题时，选对工具能事半功倍：

| 问题类型 | 首选工具 | 辅助工具 |
| :-- | :-- | :-- |
| CPU 高 | `top -Hp` + `jstack` | Arthas `thread -n 3` |
| 内存泄漏 / OOM | `-XX:+HeapDumpOnOutOfMemoryError` + MAT | Arthas `heapdump` + `dashboard` |
| GC 问题 | GC 日志（`-Xlog:gc*`）+ `jstat` | JFR 的 GC 事件 |
| 接口变慢 | Arthas `trace` | JFR CPU 热点 |
| 锁竞争 | `jstack` / Arthas `thread -b` | JFR 的 Lock 事件 |
| 确认线上代码 | Arthas `jad` | — |
| 综合性能分析 | JFR（持续录制） | JMC 可视化分析 |
| CodeCache 问题 | `jstat -compiler` | `-Xlog:compilation*` |

### 7.1 端到端排查案例：接口变慢

**现象：** 某个 API 接口从 200ms 降到 3 秒。

**第一步：快速定位是 CPU 问题还是 GC 问题**

```bash
# 看 GC 日志
tail -f gc.log
# 发现每 2 分钟一次 Full GC，每次耗时 1.5 秒 → GC 问题

# 确认堆状态
jstat -gcutil <pid> 1000
# O 区持续增长到 99% 后触发 FGC
```

**第二步：找到老年代中的大对象**

```bash
# 生成 dump（线上慎用，会触发 Full GC）
jmap -dump:format=b,file=heap.hprof <pid>

# 或用 Arthas（不触发 GC）
heapdump /tmp/heap.hprof
```

**第三步：MAT 分析**

Leak Suspects Report 显示 `com.example.ReportGenerator` 持有了 2GB 的 `ArrayList<ReportData>`。

**第四步：定位代码**

```bash
# 用 Arthas 反编译线上代码
jad com.example.ReportGenerator
```

发现 `ReportGenerator` 在每次请求时将数据加入一个静态 `ArrayList`，但从不清理。

**第五步：修复并验证**

将 `ArrayList` 改为请求级局部变量，或添加清理逻辑。修复后部署，用 `jstat` 确认老年代使用率稳定，Full GC 消失。

## 8. JVM 核心参数速查

| 类别 | 参数 | 说明 |
| :-- | :-- | :-- |
| 堆内存 | `-Xms4g -Xmx4g` | 初始/最大堆，线上设为一致 |
| 新生代 | `-Xmn2g` | 新生代大小 |
| 栈大小 | `-Xss256k` | 每个线程的栈大小 |
| GC 算法 | `-XX:+UseG1GC` | 选择收集器 |
| GC 停顿 | `-XX:MaxGCPauseMillis=200` | G1 目标停顿时间 |
| GC 日志 | `-Xlog:gc*=info:file=gc.log` | JDK 9+ 统一格式 |
| OOM dump | `-XX:+HeapDumpOnOutOfMemoryError` | OOM 时自动 dump |
| dump 路径 | `-XX:HeapDumpPath=/path/` | dump 文件存储位置 |
| Metaspace | `-XX:MaxMetaspaceSize=256m` | 限制 Metaspace 大小 |
| 压缩指针 | `-XX:+UseCompressedOops` | 64 位 JVM 默认开启 |

## 9. 实战案例集

以上内容是诊断工具和方法的速查手册。以下案例集从生产环境真实事故中精挑细选，每个案例都包含完整的事故背景、排查链路、根因定位和修复验证：

- **[案例集（一）：CPU 飙升与内存泄漏实战](./chapter-06-diagnostics-cases-part1)**
  - 正则灾难性回溯（ReDoS）—— 一行正则烧了银行的支付网关
  - 本地缓存无上限 —— 把整个订单表装进内存
  - CGLIB 动态代理未复用 —— 爆掉 256MB Metaspace

- **[案例集（二）：GC 调优与综合诊断实战](./chapter-06-diagnostics-cases-part2)**
  - 背靠背 Full GC —— 双十一订单服务的蜕变
  - 连接池耗尽 —— 200 个线程全卡在 getConnection()
  - Arthas + JFR 综合诊断 —— 接口从 50ms 变成 3000ms 的全链路追踪

- **[案例集（三）：低内存低 CPU 下的 GC 疑难杂症](./chapter-06-diagnostics-cases-part3)**
  - 支付回调的 Young GC 风暴 —— 日志拼接每秒造 300MB 垃圾
  - 索引热更新的 Survivor 复制风暴 —— 500MB 对象在新生代来回搬家
  - SafePoint 同步延迟 —— GC 只花了 0.14 秒，线程却停了 2.26 秒
  - Log4j2 + PretenureSizeThreshold 组合技 —— 2MB 的"日志炸弹"直冲老年代

> 第二卷到此结束。从字节码 → 类加载 → 内存模型 → 对象模型 → GC → JIT → 线上排查，读者已经建立起 Java 代码从源码到机器执行的完整心智模型。
>
> **与后续卷的连接：**
>
> - 第三卷并发：AQS 依赖对象头和 Monitor，synchronized 依赖 Mark Word 锁升级
> - 第六卷 Spring：反射依赖 Class 元数据，CGLIB 依赖字节码操作
> - 第七卷性能：GC 调优依赖分代模型和收集器特性的理解
