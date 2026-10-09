# 并发问题诊断

> 系统卡住了：CPU 空转、请求堆积、Thread Dump 里满屏 `BLOCKED`。这些症状分别对应什么问题？定位到哪一行代码才算根因？找到之后怎么修才不是治标？

并发 bug 的痛点不是"难修"，而是"难复现"。测试环境稳跑一整月，上生产两分钟就死锁。原因是并发问题的暴露时机取决于线程调度的微秒级顺序——你写的每一行同步代码，都是在替 JVM 和 CPU 打赌。**这一章不重讲通用 Thread Dump 语法**（见 [JVM 线上诊断](../01-jvm/chapter-01-jvm-diagnostics.md)），只讨论并发场景下的特化视角：症状识别、根因定位和上线检查。

## 1. 并发问题的四种典型症状

### 1.1 症状全景

线上并发问题的表现形式只有四种。识别到症状，就能快速缩小根因范围：

| 症状 | 表面表现 | 底层原因 | 首选定位手段 |
| :-- | :-- | :-- | :-- |
| **死锁** | 请求全部卡死、CPU 使用率低 | 多个线程互相持有对方需要的锁 | `jstack` 直接报告死锁 |
| **活锁** | 线程在跑、`context switch` 数飙升、无进展 | 线程互相谦让 / 反复重试 | CPU 高但吞吐为零 |
| **饥饿** | 部分请求响应正常、部分永远超时 | 非公平锁 + 高竞争 / 优先级倒挂 | 长尾延迟分布分析 |
| **竞态条件** | 结果时对时错、数据不一致 | 共享状态读写没同步 | 复现困难、需要看数据不一致的形态 |

**关键区分点**：死锁和活锁都表现为"没进展"，但 CPU 占用完全相反——死锁线程处于 `BLOCKED` / `WAITING`，CPU 曲线是平的；活锁线程处于 `RUNNABLE`，CPU 曲线是满的。这个区别决定了你查的方向。

### 1.2 死锁（Deadlock）

四种症状里最经典的一种。两条或更多线程互相持有对方需要的锁，谁都没法推进：

```java
public class DeadlockDemo {
    private static final Object lockA = new Object();
    private static final Object lockB = new Object();

    public static void main(String[] args) {
        new Thread(() -> {
            synchronized (lockA) {
                sleep(100);
                synchronized (lockB) {     // 想拿 lockB，但被 Thread-2 持有
                    // 到不了这里
                }
            }
        }, "Thread-1").start();

        new Thread(() -> {
            synchronized (lockB) {
                sleep(100);
                synchronized (lockA) {     // 想拿 lockA，但被 Thread-1 持有
                    // 到不了这里
                }
            }
        }, "Thread-2").start();
    }
}
```

两条线程各自持一把锁、又都在等对方那把——形成"环"。这个环一旦形成，除非有超时机制或外部干预，永远解不开。本页第 2 章会展开死锁的四个必要条件、检测方法和预防策略。

### 1.3 活锁（Livelock）

线程一直在跑但没有推进。经典比喻：两个人在走廊迎面走来，都往同一边让，又同时往另一边让，永远错不开。

```java
public class LivelockDemo {
    static class Worker {
        String name;
        volatile boolean active = true;

        void work(SharedResource res, Worker other) {
            while (active) {
                if (res.getOwner() != this) {
                    sleep(10);
                    continue;
                }
                if (other.active) {
                    res.setOwner(other);     // "礼让"给对方
                    continue;
                }
                doWork();
                active = false;
            }
        }
    }
}
```

活锁在生产上不如死锁常见，但杀伤力不亚于死锁——**它把 CPU 打满，却不做任何有用功**。常见诱因：无退避的重试逻辑、"礼让"策略、乐观锁的高竞争 CAS 死循环。修复思路一致：**引入随机退避（jitter）打破对称性**。

### 1.4 饥饿（Starvation）

某些线程永远拿不到 CPU 时间片或永远拿不到锁：

```java
// 非公平锁 + 短临界区，新来线程有极高概率插队
ReentrantLock lock = new ReentrantLock(false);   // 非公平

for (int i = 0; i < 100; i++) {
    new Thread(() -> {
        while (true) {
            lock.lock();
            try { doQuickWork(); }
            finally { lock.unlock(); }
        }
    }).start();
}
```

非公平锁的语义是"释放锁的瞬间，谁 CAS 抢到就是谁的"。100 条线程反复竞争，某些线程可能几分钟拿不到一次。生产上表现为**长尾延迟严重**——p50 正常、p99 拉到几百毫秒、p999 直接超时。

修复思路：改用公平锁（`new ReentrantLock(true)`），或者从根本上减少竞争强度。

### 1.5 竞态条件（Race Condition）

`count++` 结果时对时错，`HashMap` 在并发写下损坏得链表成环，`SimpleDateFormat` 并发解析抛 `NumberFormatException`——都是竞态。

竞态的定位比死锁更难：**它没有可靠的症状**。表现只有一个"数据不对"，且无法稳定复现。诊断方法只有一条：**从数据错乱的形态反推**——比如"少了一条更新"通常对应 `count++` 型漏更新；"看到半初始化对象"通常对应 [JMM 的安全发布](../../03-java-concurrency/chapter-04-jmm.md)讨论的发布不安全。

## 2. 死锁：机制、检测、预防

### 2.1 死锁的四个必要条件

死锁的形成需要四个条件同时满足——**打破任何一个都能预防死锁**：

| 条件 | 含义 | 打破方式 |
| :-- | :-- | :-- |
| **互斥** | 资源不能被同时持有 | 换共享锁（读写锁的读部分） |
| **持有并等待** | 持锁的同时等待另一把锁 | 一次性申请所有资源；或先释放再申请 |
| **不可剥夺** | 已持有的锁不能被抢走 | 用 `tryLock(timeout)`：超时后自己放手 |
| **循环等待** | 线程链条形成环 | **统一锁获取顺序** |

工程上最有效的是打破**循环等待**：为所有锁定义一个全局顺序（如按锁对象的 `identityHashCode`），任何线程都按同一顺序申请。没有环，就没有死锁。

```java
// ✅ 按锁对象哈希值统一获取顺序
public static void transfer(Account from, Account to, int amount) {
    Object first  = from.hashCode() < to.hashCode() ? from : to;
    Object second = from.hashCode() < to.hashCode() ? to : from;
    synchronized (first) {
        synchronized (second) {
            from.debit(amount);
            to.credit(amount);
        }
    }
}
```

### 2.2 用 `jstack` 定位死锁

`jstack` 是死锁诊断的第一把工具。JVM 在 Thread Dump 末尾会直接标出死锁信息，不需要肉眼扫栈：

```bash
jps                      # 找到 Java 进程 PID
jstack <pid>             # 打印 Thread Dump
```

关键片段：

```txt
Found one Java-level deadlock:
=============================
"Thread-1":
  waiting to lock monitor 0x00007f8b4c003818 (object 0x00000007aab3a0d0, a java.lang.Object),
  which is held by "Thread-2"
"Thread-2":
  waiting to lock monitor 0x00007f8b4c006418 (object 0x00000007aab3a0d8, a java.lang.Object),
  which is held by "Thread-1"

Java stack information for the threads listed above:
"Thread-1":
    at DeadlockDemo.lambda$main$0(DeadlockDemo.java:12)
    - waiting to lock <0x00000007aab3a0d8>
    - locked <0x00000007aab3a0d0>
"Thread-2":
    at DeadlockDemo.lambda$main$1(DeadlockDemo.java:20)
    - waiting to lock <0x00000007aab3a0d0>
    - locked <0x00000007aab3a0d8>

Found 1 deadlock.
```

读法：

- `locked <地址>`：这条线程已经持有的锁
- `waiting to lock <地址>`：这条线程正在等的锁
- 两条线程的"持有"与"等待"交叉——就是环

**局限**：`jstack` 只能检测 `synchronized` 与 `ReentrantLock` 系的死锁。**如果死锁涉及 `LockSupport.park()` 无对象引用的挂起（第 8 章的 LockSupport 一节），`jstack` 不报告死锁**——只会显示线程在 `park`。这种情况需要下一节的编程式检测。

### 2.3 编程式死锁检测

对生产环境常驻的服务，可以在监控线程里主动跑死锁检测：

```java
ThreadMXBean bean = ManagementFactory.getThreadMXBean();

scheduler.scheduleAtFixedRate(() -> {
    long[] deadlocked = bean.findDeadlockedThreads();          // synchronized + ReentrantLock
    // long[] deadlocked = bean.findMonitorDeadlockedThreads(); // 只查 synchronized
    if (deadlocked != null) {
        ThreadInfo[] infos = bean.getThreadInfo(deadlocked, true, true);
        alarm(infos);      // 发告警 + 打印栈
    }
}, 5, 10, TimeUnit.SECONDS);
```

`findDeadlockedThreads` 覆盖 `synchronized` 和所有 AQS 系的锁。开销可控，生产上开着不影响性能。

### 2.4 用 `tryLock(timeout)` 从代码层面消灭死锁

即便统一了锁顺序，业务复杂到多个模块交叉持锁时，仍可能出现意料之外的环。给锁获取增加超时可以缩短无限等待，但超时后的重试仍需保证幂等、避免活锁，也不能替代修正规约：

```java
// ❌ 无超时：环形成后永远挂
lock1.lock();
lock2.lock();

// ✅ 超时兜底：拿不到就放手退出
if (!lock1.tryLock(500, TimeUnit.MILLISECONDS)) return false;
try {
    if (!lock2.tryLock(500, TimeUnit.MILLISECONDS)) return false;
    try { doWork(); }
    finally { lock2.unlock(); }
} finally { lock1.unlock(); }
```

超时后返回 `false`，业务层可以选择重试或降级。**任何生产上"永远拿不到就永远等"的锁都是隐患**。

## 3. Thread Dump 的并发特化视角

Thread Dump 的通用获取方式（`jstack` / `jcmd Thread.print` / `kill -3` / VisualVM）和格式解析，已经在 [JVM 线上诊断](../01-jvm/chapter-01-jvm-diagnostics.md)中讲过。**这一节只讨论并发场景下的读法**——同样一份 dump，通用视角看的是"哪条线程栈异常"，并发视角看的是"整体的锁竞争与阻塞形态"。

### 3.1 线程状态分布：先看总盘

拿到 dump 的第一件事不是逐条读栈——是**统计线程状态分布**：

```bash
grep "java.lang.Thread.State" threads.dump | sort | uniq -c | sort -rn
# 输出示例：
#   150 java.lang.Thread.State: BLOCKED (on object monitor)
#    30 java.lang.Thread.State: WAITING (parking)
#    15 java.lang.Thread.State: TIMED_WAITING (parking)
#     5 java.lang.Thread.State: RUNNABLE
```

用这个分布对照四种典型症状：

| 分布形态 | 症状 | 下一步 |
| :-- | :-- | :-- |
| 大量 `BLOCKED` 集中在同一把锁 | 严重锁竞争 | 本页 §3.2 找热点锁 |
| 大量 `RUNNABLE` 但 CPU 满、吞吐低 | 活锁 / 空转 | 查重试与退避逻辑 |
| 少量 `BLOCKED` + 明显的两两互等 | 死锁 | `jstack` 直接看死锁段 |
| 大量 `WAITING` 在 `LinkedBlockingQueue.take` | 线程池空闲 | 正常，非问题 |
| 大量 `WAITING` 在 `AQS.parkAndCheckInterrupt` | 有人在等 `Condition.signal` | 检查 `signal` 是否漏调 |

### 3.2 顺着 `BLOCKED` 找热点锁

`BLOCKED` 线程的栈里都会写明它在等哪把锁：

```txt
"pool-1-thread-15" ... BLOCKED
    at com.example.OrderService.createOrder(OrderService.java:42)
    - waiting to lock <0x00000007aab3b020> (a com.example.OrderService)

"pool-1-thread-16" ... BLOCKED
    at com.example.OrderService.createOrder(OrderService.java:42)
    - waiting to lock <0x00000007aab3b020> (a com.example.OrderService)
```

看到 100 条线程都 `waiting to lock <0x00000007aab3b020>`——**热点锁定位完成**。剩下的问题只有一个：谁持有它？

用 dump 里的 `- locked <0x00000007aab3b020>` 反查，就能定位持锁线程；再看它的栈，就知道它卡在临界区里的哪一步。80% 的锁竞争问题到这一步就能修：拆锁粒度、缩短临界区、换共享锁。

### 3.3 `WAITING` 线程的三种典型形态

`WAITING` 状态在栈上的顶部帧固定是 `Unsafe.park`。三种最常见的下文：

```txt
# 形态 1：线程池 Worker 等任务
at java.util.concurrent.LinkedBlockingQueue.take(...)
at java.util.concurrent.ThreadPoolExecutor.getTask(...)
    → 正常，没事

# 形态 2：AQS ConditionObject.await
at java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject.await(...)
    → 有人在等 signal——检查生产者路径

# 形态 3：CompletableFuture.get
at java.util.concurrent.CompletableFuture$Signaller.block(...)
    → 阻塞等异步结果——检查依赖的异步链是否完成
```

排查时最容易被形态 1 干扰——线程池里几十个 `WAITING` 都是空闲 Worker，与问题无关。养成"先跳过空闲池、只看业务栈"的习惯。

### 3.4 一个真实案例：从 dump 到根因的一次推进

某个线上服务响应突然从 20ms 涨到 3s。Thread Dump 显示：

```txt
200 BLOCKED / 20 WAITING / 5 RUNNABLE
```

`BLOCKED` 线程全部集中在 `LoggerFactory.getLogger` 的一把锁上——问题不在业务代码，而在**日志框架初始化**。深挖发现：业务代码里每次调用都动态用 `LoggerFactory.getLogger(clazz)` 获取 logger，而 SLF4J 的这个方法内部有 `synchronized`。改成把 logger 声明成 `static final` 常量后，`BLOCKED` 线程降到 0。

这种"锁竞争不在业务代码里，而在公共组件里"的场景在生产上非常常见。dump 是唯一能定位到这类问题的手段。

## 4. 锁竞争分析

Thread Dump 是**快照**——一次采样。要看锁竞争的**时序变化**，需要专门的工具。

### 4.1 关键指标

| 指标 | 含义 | 来源 |
| :-- | :-- | :-- |
| Blocked Thread Count | 当前 `BLOCKED` 线程数 | Thread Dump / JMX |
| Monitor Contention Rate | 单位时间的锁冲突次数 | JFR |
| Average Lock Wait Time | 平均等锁时间 | JFR / Arthas |
| Lock Hold Time | 持锁时间分布 | JFR |
| Contended Lock Top-N | 竞争最激烈的 N 把锁 | JFR |

其中 **Lock Wait Time 分布** 最重要——它直接告诉你锁竞争到底影响了多少延迟。

### 4.2 JFR：低开销的持续记录

JDK Flight Recorder 是并发问题诊断的一等公民。它开销极低（通常 <1%），可以在生产环境长期开着：

```bash
# 启动一次 60 秒的记录
jcmd <pid> JFR.start duration=60s filename=recording.jfr

# 或者服务启动时开启
java -XX:StartFlightRecording=duration=60s,filename=recording.jfr MyApp
```

用 JMC（Java Mission Control）打开 `recording.jfr`，进入 **Lock Instances** 面板可以看到：

- 每把锁的等待次数、总等待时间、平均等待时间
- 竞争最激烈的锁排名
- 每次锁冲突的线程栈

**排查节奏**：Thread Dump 看当前形态 → JFR 看时间维度上的竞争分布。两者结合，锁问题基本无处可藏。

### 4.3 Arthas：在线看谁在阻塞谁

Arthas 是阿里开源的 Java 在线诊断工具，`thread -b` 一条命令直接告诉你**哪条线程在阻塞其他人**：

```bash
[arthas@12345]$ thread -b
"http-nio-8080-exec-1" Id=45 BLOCKED on com.example.OrderService@7a3d3e4a
    - blocked by: http-nio-8080-exec-3
    at com.example.OrderService.createOrder(OrderService.java:42)

"http-nio-8080-exec-3" Id=47 RUNNABLE
    - holding 1 lock(s)
    at com.example.OrderService.createOrder(OrderService.java:42)
```

对不能重启、不便开 JFR 的线上环境，Arthas 是最快的定位手段。

## 5. 虚拟线程的诊断专项

第 13 章介绍了虚拟线程的机制与 pinning 陷阱。诊断层面，虚拟线程带来了三个和平台线程完全不同的坑。

### 5.1 pinning：虚拟线程独有的性能陷阱

平台线程被阻塞就是被阻塞，没有"钉住"这一说。虚拟线程不同——它挂在平台线程（carrier thread）上运行，遇到 `park` 会自动卸载，把 carrier 让给其他虚拟线程。但**遇到 `synchronized` 里的阻塞操作，虚拟线程会被"钉住"在 carrier 上，无法卸载**：

```java
// ❌ synchronized 里做阻塞 IO：虚拟线程被 pin 在 carrier 上
synchronized (lock) {
    httpClient.get(url);      // carrier 线程被占死
}
```

后果是**吞吐量骤降**：虚拟线程的调度优势建立在"carrier 数量少但可以承载海量虚拟线程"上，pinning 让 carrier 一条条被占死，最坏情况下退化成"平台线程池"。第 13 章的 pinning 一节有完整讨论。

### 5.2 检测 pinning：`-Djdk.tracePinnedThreads`

启动时加上参数，pinning 发生时会打印栈：

```bash
java -Djdk.tracePinnedThreads=full -jar app.jar
```

输出示例：

```txt
Thread[#22,ForkJoinPool-1-worker-3,5,CarrierThreads]
    java.lang.VirtualThread$VThreadContinuation.onPinned(VirtualThread.java:183)
    ...
    at com.example.MyService.doWork(MyService.java:42)
    - locked <0x00000007aab3a0d0> (a java.lang.Object)   ← 被这把锁 pin 住
    at com.example.MyService.process(MyService.java:35)
```

生产环境不建议一直开 `full`（栈打印有开销），可以改用 `short` 或走 JFR。

### 5.3 JFR：生产环境的 pinning 持续监控

JFR 有一个专门的事件 `jdk.VirtualThreadPinned`，只在 pinning 发生时记录：

```bash
jcmd <pid> JFR.start filename=vt.jfr duration=60s \
  jdk.VirtualThreadPinned#enabled=true
```

在 JMC 里过滤 `VirtualThreadPinned` 事件，能看到每次 pinning 的时长、涉及的锁对象、完整栈。**生产环境推荐这个方式**——开销极低（只在 pinning 时才记录），信息完整。

修复思路一句话：**任何 `synchronized` 包住的阻塞操作，换成 `ReentrantLock`**。`ReentrantLock` 底层是 `LockSupport.park`（第 8 章的 LockSupport 一节），虚拟线程 park 时能正常卸载。

### 5.4 `jstack` 的输出差异

虚拟线程在 dump 里的表示和平台线程有明显不同：

```txt
# 平台线程：有独立编号、状态清晰
"http-nio-8080-exec-1" #15 daemon prio=5 os_prio=0
   java.lang.Thread.State: RUNNABLE
    at com.example.Controller.handle(Controller.java:20)

# 虚拟线程：没有独立 OS 线程编号，挂在 carrier 上
"" #22 daemon prio=5
   java.lang.Thread.State: TIMED_WAITING
    at java.lang.VirtualThread.parkOnCarrierThread(VirtualThread.java:...)
```

生产上一个 JVM 可能同时跑几万个虚拟线程，`jstack` 输出会非常大。改用：

```bash
jcmd <pid> Thread.dump_to_file -format=json vt-threads.json
```

JSON 格式便于用工具分析（`jq` 或专用 dump 分析工具），比逐行 grep 高效得多。

### 5.5 `ThreadMXBean` 的能力缺口

`ThreadMXBean.getThreadCount()` **不统计虚拟线程**——这是 API 设计的历史限制。想统计虚拟线程数、内存占用、状态分布，只能走 JFR 事件流或 Arthas。这一点在虚拟线程场景下的监控体系设计里要提前意识到。

### 5.6 虚拟线程诊断规则速览

| 规则 | 说明 |
| :-- | :-- |
| 用 `ReentrantLock` 替代 `synchronized` | 消灭 pinning |
| 不要池化虚拟线程 | 虚拟线程本身就是"每任务一条"，池化没有意义 |
| 生产开 `VirtualThreadPinned` JFR 事件 | 持续监控 pinning |
| CPU 密集任务用平台线程池 | 虚拟线程的优势在 IO 等待，不在计算 |
| 用 `Semaphore` 限流下游资源 | 替代"用线程池大小限制下游并发"的老思路 |

```java
// ✅ 虚拟线程场景下的下游限流
Semaphore dbLimit = new Semaphore(20);

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (int i = 0; i < 100_000; i++) {
        executor.submit(() -> {
            dbLimit.acquire();
            try { return queryDB(); }
            finally { dbLimit.release(); }
        });
    }
}
```

## 6. 上生产前的并发自检清单

以下是这一卷全部内容凝练出的自检清单。发布前对着走一遍，能过滤掉绝大多数经典并发问题。

| 检查项 | 关注点 | 参考 |
| :-- | :-- | :-- |
| 共享可变状态 | 能不共享就不共享；共享的必须同步 | [Java 内存模型](../../03-java-concurrency/chapter-04-jmm.md) |
| 不可变数据 | 优先用 `record` / `final` / `List.of` | [JMM 的安全发布](../../03-java-concurrency/chapter-04-jmm.md) |
| 锁对象 | 用 `private final Object`，不锁 `this` / 字符串 / 装箱值 | [synchronized](../../03-java-concurrency/chapter-06-synchronized.md) |
| 锁顺序 | 多锁按全局顺序申请，或用 `tryLock(timeout)` | 本页 §2 |
| 临界区大小 | 只锁真正需要保护的最少代码 | 本页 §4 |
| 队列有界 | 线程池 / 生产者-消费者都用有界队列 | [并发集合](../../03-java-concurrency/chapter-10-concurrent-collections.md)、[线程池](../../03-java-concurrency/chapter-11-thread-pool.md) |
| 线程池独立 | 不同业务用不同池，禁用 `commonPool` 跑阻塞任务 | 第 11 章 §8.4、第 12 章 §5.3 |
| 线程命名 | 每个池起有辨识度的名字 | 第 11 章 §8.2 |
| 超时兜底 | 所有阻塞操作都有超时 | 本页 §2.4、第 12 章 §4.4 |
| `submit` 异常 | `submit` 的任务要 `future.get()`，否则异常吞掉 | 第 11 章 §8.6 |
| `CompletableFuture` executor | 每个 stage 都显式传 executor | 第 12 章 §5.3 |
| `Condition` 精确唤醒 | 生产/消费用两条 `Condition` 而非 `signalAll` | 第 9 章 §1.2 |
| 虚拟线程 pinning | `synchronized` + 阻塞 IO 必须替换成 `ReentrantLock` | 第 13 章 §3.3、本页 §5.1 |
| 死锁监控 | 生产开 `findDeadlockedThreads` 定时检测 | 本页 §2.3 |
| JFR 常态录制 | 生产开 `duration=continuous` 的低采样 JFR | 本页 §4.2、§5.3 |

## 7. 本章小结

| 症状 | 定位手段 | 修复方向 |
| :-- | :-- | :-- |
| 死锁 | `jstack` 直接报告；`findDeadlockedThreads` 编程式检测 | 统一锁顺序 / `tryLock(timeout)` |
| 活锁 | CPU 打满但吞吐为零 | 引入随机退避 |
| 饥饿 | p99 长尾拉高 | 换公平锁 / 降低竞争 |
| 竞态 | 从数据错乱形态反推 | 加锁 / CAS / 不可变对象 |
| 锁竞争严重 | Thread Dump 分布 + JFR Lock Instances | 减少锁粒度 / 无锁化 / 读写分离 |
| 虚拟线程 pinning | `-Djdk.tracePinnedThreads` / JFR `VirtualThreadPinned` | `synchronized` → `ReentrantLock` |
| 长 RT 请求 | Arthas `thread -b` 看谁在阻塞谁 | 缩短临界区 / 异步化 |

## 8. 案例入口

以上内容是并发诊断方法、工具和优化策略的速查手册。以下案例集均为构造或匿名化的教学案例，每个案例都包含完整的背景、排查链路、根因定位和修复验证：

- **[锁与执行模型案例](./chapter-03-cases-lock-execution.md)**
  - [双十一的死锁 —— 订单与库存的锁序之战](./chapter-03-cases-lock-execution.md#case-1)
  - [618 的雪崩 —— CallerRunsPolicy 把 Tomcat 线程全拖下水](./chapter-03-cases-lock-execution.md#case-2)
  - [ConcurrentHashMap 去重失效 —— 可变 key 的 hashCode 陷阱](./chapter-04-cases-mutable-key-pin.md#case-3)
  - [虚拟线程 pinning —— 同步锁让 5000 QPS 跌到 800](./chapter-04-cases-mutable-key-pin.md#case-4)

- **[异步任务与下游超时案例](./chapter-05-cases-async-timeout.md)**
  - [CompletableFuture + DiscardPolicy —— 静默丢弃任务导致永久阻塞](./chapter-05-cases-async-timeout.md#case-5)
  - [线程池 core = max + 无界队列 —— maxPoolSize 永远不触发](./chapter-05-cases-async-timeout.md#case-6)
  - [虚拟线程静默死锁与下游无超时](./chapter-05-cases-async-timeout.md)
