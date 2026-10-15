# 为什么需要并发：从单线程到多核时代

> 程序为什么不能一个一个地执行任务？并发到底解决了什么问题？它又引入了哪些新问题？本章从硬件演进和软件需求两个维度，解释并发存在的根本原因，厘清并发与并行的区别，并为你画出 Java 并发体系的全景地图。

## 1. 程序为什么要同时执行多个任务

### 1.1 从单核到多核的演进

2005 年以前，CPU 厂商提升性能的主要手段是**提高主频**。你可能还记得，从 Pentium III 的 500MHz 到 Pentium 4 的 3.8GHz，频率几乎翻了七倍。但这条路线在 2005 年前后撞上了物理墙——更高的频率意味着更高的功耗和散热需求，而芯片的功耗与频率的关系近似于：

```txt
P ∝ C × V² × f
```

其中 `f` 是频率，`V` 是电压，`C` 是电容。频率提升要求电压同步提高，功耗呈指数级增长。Intel 的 Prescott 核心（Pentium 4）就是典型的例子：3.8GHz 的 TDP 高达 115W，热量密度已经逼近风冷极限。

厂商转向了另一条路：**在一块芯片上放多个核心**。2005 年 Intel 发布了 Pentium D（双核），2006 年 Core 2 Duo 将这条路走通。今天，你笔记本上的 CPU 可能有 6-8 个核心，服务器上的 CPU 可能有 64 甚至 128 个核心。

对典型的单执行流 CPU 密集型程序而言，单个执行流通常无法同时利用多个 CPU 核心完成自身计算。如果你的程序只有一个执行流，无论 CPU 有多少个核心，其余核心对这段计算而言都在空转，这就是硬件层面的驱动力。

### 1.2 三大驱动力

并发的存在有明确的现实驱动力：

**驱动力一：提升吞吐量（Throughput）**

想象一个 Web 服务器，处理一个请求需要 50ms。如果串行处理，1 秒最多处理 20 个请求。如果有 4 个核心且请求彼此独立，可以同时处理 4 个请求，吞吐量接近翻 4 倍。

```txt
单线程:   ──[req1]──[req2]──[req3]──[req4]──   → 20 req/s
多线程:   ──[req1]──[req3]──
          ──[req2]──[req4]──                    → 40 req/s（双核）
```

**驱动力二：降低响应时间（Latency）**

用户点击"导出报表"，后台需要做三件事：查询数据库（200ms）、生成图表（150ms）、打包文件（100ms）。串行执行需要 450ms。如果三件事彼此独立，且能在不同执行资源上同时运行，理想情况下总耗时可以接近最慢的 200ms，实际耗时还取决于资源竞争和调度开销。

**驱动力三：充分利用硬件资源**

现代 CPU 的一个核心并不只是"一个计算单元"。它有流水线、分支预测器、多级缓存。当一个线程因为等待 I/O（比如磁盘读取、网络请求）而阻塞时，这个核心就空闲了。操作系统通过线程调度，可以在一个线程等待 I/O 时切换到另一个线程，让 CPU 核心始终保持忙碌。

```txt
单线程（I/O 密集型场景）:
  CPU:  ██░░░░░░██░░░░░░██░░░░░░   （大量空闲）
  I/O:  ░░████░░░░████░░░░████░░

多线程:
  CPU:  ██AA██BB██CC██DD██AA██BB   （持续忙碌）
  I/O:  ░░CC░░DD░░AA░░BB░░CC░░DD
```

### 1.3 真实世界的例子：Web 服务器的进化

让我们用一个具体的例子来看并发的必要性。假设你在用 Java 写一个 HTTP 服务器。

**阶段一：单线程 accept 循环**

```java
// 最原始的服务器
ServerSocket server = new ServerSocket(8080);
while (true) {
    Socket client = server.accept();      // 阻塞等待连接
    handleRequest(client);                // 处理请求（可能 50-200ms）
    client.close();
}
```

瓶颈很直接：如果 `handleRequest` 耗时 100ms，那么每秒最多处理 10 个请求。第二个客户端必须等第一个请求处理完才能被接受。用户体验极差。

**阶段二：一请求一线程**

```java
// 每个请求一个线程
ServerSocket server = new ServerSocket(8080);
while (true) {
    Socket client = server.accept();
    new Thread(() -> handleRequest(client)).start();  // 新线程处理
}
```

吞吐量上来了——多个请求可以并行处理。但问题也来了：如果并发请求有 10 000 个，就要创建 10 000 个线程。按每条 1 MB 栈参数粗算，栈预留空间约 10 GB；它不等于全部驻留物理内存，但线程创建、内核资源和上下文切换成本仍会随规模上升。

**阶段三：线程池**

```java
// 用线程池复用线程
ExecutorService pool = Executors.newFixedThreadPool(200);
ServerSocket server = new ServerSocket(8080);
while (true) {
    Socket client = server.accept();
    pool.submit(() -> handleRequest(client));
}
```

用固定数量的线程（比如 200）处理所有请求。线程被复用，不会无限增长。这是传统 Java Web 服务器（Tomcat 的 BIO 模式）的基本思路。

**阶段四：NIO + 事件驱动**

```java
// Netty / Tomcat NIO 的思路
// 少量线程通过 Selector 监听大量连接的 I/O 事件
Selector selector = Selector.open();
// ... 注册 channel ...
while (true) {
    selector.select();  // 阻塞等待 I/O 事件
    for (SelectionKey key : selector.selectedKeys()) {
        if (key.isReadable()) {
            pool.submit(() -> processRequest(key));
        }
    }
}
```

少量线程通过 I/O 多路复用（`Selector`）监听大量连接，只有在数据真正准备好时才分配线程处理。这是 Netty、Vert.x 等框架的核心思路。上面的代码是分派思路的简化示意，`SelectionKey` 的有效性、连接关闭和事件处理线程的职责，实际框架实现会做更严格的处理。

**阶段五：虚拟线程（JDK 21+）**

```java
// 每个请求一个虚拟线程，但开销极小
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    while (true) {
        Socket client = server.accept();
        executor.submit(() -> handleRequest(client));
    }
}
```

虚拟线程的栈内存按需分配，单个初始占用通常较小，在内存和 JVM 参数允许时可以创建远多于平台线程的数量。代码可以保留“一请求一线程”的写法，但吞吐和尾延迟仍取决于阻塞点、载体线程数与下游资源，需要压测验证。这就是 JDK 21 带来的范式变化。

这个进化过程本身就回答了本章的核心问题：**当服务需要处理多个重叠请求，或希望在等待 I/O 时继续推进其他任务，并发就成为重要的设计手段。** 而 Java 的并发工具一直在演进，目标就是让开发者用更简单的方式写出更高性能的并发程序。

## 2. 并发与并行的区别

很多人把"并发"和"并行"混为一谈。它们解决的问题不同，实现的前提也不同。

### 2.1 定义与对比

| 维度 | 并发（Concurrency） | 并行（Parallelism） |
| :-- | :-- | :-- |
| 核心问题 | **结构**问题：如何组织多个任务 | **执行**问题：如何同时运行多个任务 |
| 关注点 | 任务之间的协调与切换 | 任务的同时执行 |
| 硬件要求 | 单核即可 | 至少需要多个核心 |
| 典型场景 | 单核 CPU 上跑 Web 服务器，通过时间片轮转处理多个请求 | 多核 CPU 上同时执行多个排序任务 |
| 类比 | 一个厨师轮流做多道菜（切完菜 A 去翻炒菜 B） | 多个厨师各做各的菜 |

Rob Pike（Go 语言创始人之一）的经典表述：

> Concurrency is about dealing with lots of things at once. Parallelism is about doing lots of things at once.

### 2.2 单核可行并发，多核才能并行

在单核 CPU 上，"同时执行多个任务"是**错觉**。操作系统通过时间片轮转（Time Slicing）让多个线程交替执行，每个线程每次运行几十毫秒，然后被强制切换出去。由于切换速度远快于人类感知，看起来"同时"在跑。这是**并发**。

在多核 CPU 上，多个线程可以真正地、物理地同时执行。两个线程在两个核心上同时运行，没有任何切换，这是**并行**。

```java
// 并行排序示例（Java 8+）
Arrays.parallelSort(largeArray);
// 底层：将数组拆分到多个核心上同时排序
```

Java 的 `ForkJoinPool` 就是一个典型的并行框架：它把大任务递归拆成小任务，分配到多个核心上并行执行，最后合并结果。

```txt
          ┌─────────────┐
          │  大任务排序   │
          └──────┬───────┘
           ┌─────┴─────┐
      ┌────┴────┐ ┌────┴────┐
      │ 左半排序 │ │ 右半排序 │   ← 并行执行
      └────┬────┘ └────┬────┘
           └─────┬─────┘
          ┌──────┴───────┐
          │   合并结果    │
          └──────────────┘
```

### 2.3 并发的多种形态

并发不只有"多线程"一种形态。下面的技术不是互斥的选项，而是从不同维度观察并发：多进程、多线程描述执行实体，事件驱动描述任务组织方式，协程与虚拟线程描述调度机制，数据并行描述计算拆分方式。

| 形态 | 机制 | 代表技术 | 适用场景 |
| :-- | :-- | :-- | :-- |
| 多进程 | OS 进程隔离，地址空间独立 | CGI、微服务 | 需要强隔离的场景 |
| 多线程 | OS 线程共享进程内存 | Java Thread、servlet | CPU 密集 + 通用服务端 |
| 事件驱动 | 事件循环 + 非阻塞 I/O，可用单线程也可多线程 | Node.js、Netty | I/O 密集型 |
| 协程/虚拟线程 | 运行时调度的轻量级任务，挂载在平台线程上执行 | Go goroutine、Java 虚拟线程 | 大量阻塞任务 |
| 数据并行 | 把一批数据拆成多份并行计算 | SIMD、ForkJoinPool、parallelStream | 批量计算 |

Go goroutine 由 Go 运行时调度，Java 虚拟线程由 JVM 调度，两者机制不同，不能简单等同。事件驱动也不意味着只能用单线程，Netty 就用多个 EventLoop 处理不同连接。这些方式可以组合，一个服务可以同时用事件驱动管理网络 I/O、用线程池跑 CPU 密集任务。

**关键认知：** 写代码时，你设计的是并发（任务结构）。运行时，能否并行取决于硬件核心数、任务依赖、可拆分程度和同步开销。并发是编程模型问题，并行是执行模型问题。

## 3. 并发带来的核心问题

并发带来的收益是明确的，代价同样明确——它引入了单线程程序中根本不存在的问题。

### 3.1 数据竞争：count++ 的陷阱

看这段代码：

```java
public class Counter {
    private int count = 0;

    public void increment() {
        count++;  // 这不是原子操作！
    }

    public int getCount() {
        return count;
    }
}
```

`count++` 在 Java 语言层面不是原子操作。可以把它抽象为三个步骤来理解：

```txt
1. 读取 count 的当前值到寄存器  (LOAD)
2. 寄存器中的值加 1             (ADD)
3. 将寄存器的值写回 count       (STORE)
```

实际生成的机器指令取决于编译器和处理器，但这不改变它缺少原子性保证的事实。

如果两个线程同时执行 `increment()`，可能发生以下交错：

```txt
时间    线程A                    线程B                    count
────────────────────────────────────────────────────────────────
t1      LOAD count (=0)                                    0
t2                               LOAD count (=0)           0
t3      ADD 1 (=1)                                         0
t4                               ADD 1 (=1)                0
t5      STORE 1                                            1
t6                               STORE 1                   1
```

两个线程各执行了一次 `count++`，但结果是 **1** 而不是 **2**。严格地说，如果多个线程对同一个变量进行冲突访问，至少一次是写入，而且这些访问之间不存在 happens-before 排序，就构成 Java 内存模型意义上的**数据竞争（Data Race）**。即使某次运行恰好得到正确结果，也不代表程序是线程安全的。

用代码验证：

```java
public class DataRaceDemo {
    private static int count = 0;

    public static void main(String[] args) throws InterruptedException {
        Thread t1 = new Thread(() -> {
            for (int i = 0; i < 100000; i++) count++;
        });
        Thread t2 = new Thread(() -> {
            for (int i = 0; i < 100000; i++) count++;
        });
        t1.start();
        t2.start();
        t1.join();
        t2.join();
        System.out.println("Expected: 200000, Actual: " + count);
    }
}
```

多运行几次，可能观察到小于 200000 的结果，但具体数值取决于运行时的线程交错。即使某次输出恰好为 200000，也不能证明实现正确。验证线程安全不能依赖某个测试结果，而应依赖明确的同步机制和内存模型保证。

### 3.2 共享可变状态的本质问题

数据竞争的根源是什么？是**共享可变状态（Shared Mutable State）**。

```txt
        ┌─────────┐     ┌─────────┐
        │ 线程 A   │     │ 线程 B  │
        └────┬────┘     └────┬────┘
             │               │
             │   读/写        │   读/写
             ▼               ▼
        ┌─────────────────────────┐
        │     共享可变变量 count    │
        └─────────────────────────┘
```

三个条件同时满足才会出问题。这个模型是设计时的排查框架，不是数据竞争的形式化定义：

| 条件 | 含义 | 消除手段 |
| :-- | :-- | :-- |
| **共享**（Shared） | 多个线程能访问同一个变量 | 线程封闭、线程私有数据 |
| **可变**（Mutable） | 变量的值可以被修改 | 不可变类（final 字段、不可变容器） |
| **状态**（State） | 程序正确性依赖访问顺序 | 锁、原子操作、并发容器建立协调 |

消除任意一个条件，这类共享可变状态问题就不会发生。这就是后面所有并发工具的设计哲学：

- `synchronized`、`Lock` → 保证同一时刻只有一个线程能修改共享状态
- `volatile` → 保证可见性，但不保证原子性
- `ConcurrentHashMap` → 提供线程安全的并发映射操作；JDK 7 用 Segment 分段锁，JDK 8 起改为 CAS 加局部同步，不再用分段锁
- `AtomicInteger` → 用原子读改写操作更新整数，适合单个数值的原子状态变更
- `ThreadLocal` → 让每个线程持有自己的副本，消除"共享"；但不能自动隔离副本所引用的共享对象
- `String`、`Integer` → 不可变对象，消除"可变"

### 3.3 不只是数据竞争：并发 Bug 的分类

数据竞争只是并发问题的一种。实际开发中，你会遇到更多类型的并发 Bug：

| Bug 类型 | 描述 | 典型场景 | 后果 |
| :-- | :-- | :-- | :-- |
| **数据竞争** | 多线程同时读写共享变量，没有同步 | count++ 无保护 | 数据丢失、结果不一致 |
| **死锁** | 两个线程互相持有对方需要的锁，永远等待 | 线程 A 持有锁1 等锁2，线程B 持有锁2 等锁1 | 程序卡住不动 |
| **活锁** | 线程不断重试某个操作，但始终无法推进 | 两个人在走廊里互相让路，结果反复左右横跳 | CPU 空转，无进展 |
| **饥饿** | 某个线程始终得不到执行机会 | 低优先级线程被高优先级线程持续抢占 | 功能不工作 |
| **竞态条件** | 程序的正确性依赖于线程执行的时序 | 先检查后执行（check-then-act） | 偶发性 Bug，难以复现 |

数据竞争关注冲突访问是否缺少同步关系，竞态条件关注执行时序是否影响程序正确性。即使 `map` 是线程安全的并发集合，先 `containsKey` 再 `put` 的复合逻辑仍可能产生竞态条件，因为两个线程都可能先观察到键不存在再分别插入。使用线程安全容器能消除某些数据竞争，却不一定能保证跨多个操作的业务逻辑正确。

其中**死锁**是最让人头疼的问题之一。看这个例子：

```java
public class DeadlockDemo {
    private static final Object lockA = new Object();
    private static final Object lockB = new Object();

    public static void main(String[] args) {
        // 线程1：先拿 lockA，再拿 lockB
        new Thread(() -> {
            synchronized (lockA) {
                System.out.println("Thread 1: holding lockA");
                try { Thread.sleep(100); } catch (InterruptedException e) {}
                synchronized (lockB) {
                    System.out.println("Thread 1: holding lockA + lockB");
                }
            }
        }).start();

        // 线程2：先拿 lockB，再拿 lockA
        new Thread(() -> {
            synchronized (lockB) {
                System.out.println("Thread 2: holding lockB");
                try { Thread.sleep(100); } catch (InterruptedException e) {}
                synchronized (lockA) {
                    System.out.println("Thread 2: holding lockB + lockA");
                }
            }
        }).start();
    }
}
```

如果两个线程各自先拿到第一把锁，再互相等待对方释放第二把锁，就会形成循环等待，谁都走不下去。`Thread.sleep(100)` 只是提高两个线程都拿到第一把锁的概率，死锁是否发生仍取决于运行时调度。用 `jstack` 工具可以检测到死锁，但更重要的是在设计阶段就避免它（比如统一按顺序获取锁）。

**核心教训：** 并发问题经常具有时序依赖性。同一段代码在一次运行中可能正确，在另一次运行中却失败，但并非所有并发 Bug 都不可重现，死锁、数据竞争和竞态条件在特定条件下都可能稳定复现。真正困难的是，错误是否发生、何时发生、表现为何，往往受执行时序影响。这就是为什么理解并发原理如此重要——你不能靠"试出来"来保证正确性，必须从原理上保证。

## 4. Java 并发体系全景

Java 的并发体系不是一蹴而就的。从 JDK 1.0 的 `Thread` 和 `synchronized`，到 JDK 5 的 `java.util.concurrent`，到 JDK 8 的 `CompletableFuture`，到 JDK 21 的虚拟线程——它是一部逐步演进的历史。

### 4.1 全景图

```mermaid
graph TD
    A["线程基础<br/>Thread / Runnable / Callable"] --> B["同步机制<br/>synchronized / volatile"]
    B --> C["Java 内存模型<br/>JMM / happens-before"]
    C --> D["显式锁<br/>ReentrantLock / ReadWriteLock"]
    D --> E["同步器框架<br/>AQS / CountDownLatch / Semaphore"]
    E --> F["并发容器<br/>ConcurrentHashMap / BlockingQueue"]
    F --> G["线程池<br/>ThreadPoolExecutor / ForkJoinPool"]
    G --> H["异步编程<br/>CompletableFuture / Virtual Threads"]

    style A fill:#e1f5fe
    style B fill:#e1f5fe
    style C fill:#fff3e0
    style D fill:#fff3e0
    style E fill:#e8f5e9
    style F fill:#e8f5e9
    style G fill:#fce4ec
    style H fill:#fce4ec
```

这张图表示学习的递进关系，不是运行时调用链。JMM 与同步机制相互关联，并发容器、线程池和异步编程之间也不存在简单的单向依赖。

### 4.2 后续章节导读地图

| 章节 | 主题 | 核心问题 | 依赖前置 |
| :-- | :-- | :-- | :-- |
| [第2章](./chapter-02-thread-model) | 线程：Java 的执行单元 | 线程是如何被创建、调度和销毁的？ | 无 |
| [第3章](./chapter-03-threadlocal) | 线程封闭：`ThreadLocal` | 每条线程持有独立副本，如何避免竞争？ | [第2章](./chapter-02-thread-model) |
| [第4章](./chapter-04-jmm) | Java 内存模型（JMM） | 线程之间如何看到彼此的写入？ | [第2章](./chapter-02-thread-model) |
| [第5章](./chapter-05-volatile) | `volatile` | 轻量级同步机制能保证什么、不能保证什么？ | [第4章](./chapter-04-jmm) |
| [第6章](./chapter-06-synchronized) | `synchronized` | Java 内置锁的本质是什么？锁如何升级？ | [第4章](./chapter-04-jmm)、[第5章](./chapter-05-volatile) |
| [第7章](./chapter-07-cas-atomic) | CAS 与原子类 | 无锁并发如何实现？CAS 的局限是什么？ | [第4章](./chapter-04-jmm) |
| [第8章](./chapter-08-locksupport-aqs) | `LockSupport` 与 AQS | `synchronized` 不够用时怎么办？AQS 如何统一并发工具？ | [第6章](./chapter-06-synchronized)、[第7章](./chapter-07-cas-atomic) |
| [第9章](./chapter-09-condition-lock-tools) | `Condition` 与 AQS 同步工具 | AQS 如何支撑条件等待和常见同步工具？ | [第8章](./chapter-08-locksupport-aqs) |
| [第10章](./chapter-10-concurrent-collections) | 并发集合 | 如何在高并发下安全地使用集合？ | [第7章](./chapter-07-cas-atomic)、[第8章](./chapter-08-locksupport-aqs) |
| [第11章](./chapter-11-thread-pool) | 线程池 | 线程太多怎么办？如何复用和管理线程？ | [第8章](./chapter-08-locksupport-aqs)、[第10章](./chapter-10-concurrent-collections) |
| [第12章](./chapter-12-async-model) | 异步编程 | 从 `Future` 到 `CompletableFuture`，有哪些异步范式？ | [第11章](./chapter-11-thread-pool) |
| [第13章](./chapter-13-virtual-thread) | 虚拟线程模型与 Pinning | 虚拟线程如何调度，什么情况下会被钉住？ | [第2章](./chapter-02-thread-model)、[第11章](./chapter-11-thread-pool)、[第12章](./chapter-12-async-model) |
| [第14章](./chapter-14-virtual-thread-migration) | 迁移、适用边界与结构化并发 | 哪些任务适合虚拟线程，如何组织子任务？ | [第13章](./chapter-13-virtual-thread) |
| [诊断与案例](../06-diagnostics/02-concurrency/chapter-01-concurrency-diagnostics.md) | 并发问题诊断 | 并发问题怎么查？如何从症状进入根因？ | 全部前置 |

**学习建议：** [第2章](./chapter-02-thread-model) 至 [第4章](./chapter-04-jmm) 是地基，必须扎实。[第5章](./chapter-05-volatile) 至 [第9章](./chapter-09-condition-lock-tools) 是核心同步机制，理解它们才能读懂 `java.util.concurrent` 的源码。[第10章](./chapter-10-concurrent-collections) 至 [第11章](./chapter-11-thread-pool) 是应用层，日常开发中用得最多。[第12章](./chapter-12-async-model) 至 [第14章](./chapter-14-virtual-thread-migration) 是范式扩展；先用[并发问题诊断](../06-diagnostics/02-concurrency/chapter-01-concurrency-diagnostics.md)定位问题，再用[并发性能优化](../06-diagnostics/02-concurrency/chapter-02-concurrency-optimization.md)选择改法。

### 4.3 Java 并发的历史里程碑

| JDK 版本 | 年份 | 关键并发特性 |
| :-- | :-- | :-- |
| JDK 1.0 | 1996 | `Thread`、`synchronized`、`wait/notify` |
| JDK 1.2 | 1998 | `ThreadLocal` |
| JDK 1.4 | 2002 | `java.nio`（非阻塞 I/O），`Selector` |
| JDK 5 | 2004 | `java.util.concurrent`（JUC），`Executor`、`Future`、`Lock`、`Atomic`、`ConcurrentHashMap` |
| JDK 7 | 2011 | `Phaser`、`ForkJoinPool`、`TransferQueue` |
| JDK 8 | 2014 | `StampedLock`、`CompletableFuture`、并行流（parallelStream）、`LongAdder` |
| JDK 9 | 2017 | `Flow`（响应式流）、`CompletableFuture` 增强 |
| JDK 19 | 2022 | 虚拟线程首次以预览特性引入 |
| JDK 20 | 2023 | 虚拟线程第二次预览 |
| JDK 21 | 2023 | 虚拟线程正式定型；Scoped Values、Structured Concurrency 首次以预览特性提供 |

JDK 5 是一个分水岭。在它之前，Java 并发基本靠 `Thread` + `synchronized` + `wait/notify` 三板斧。Doug Lea 的 `java.util.concurrent` 包的引入，让 Java 拥有了工业级的并发工具库。从那以后，Java 并发编程从"手搓线程"进入了"使用框架"的时代。

### 4.4 本书的学习路径

面对如此庞大的并发体系，初学者容易迷失方向。本书的编排从底层原理到上层应用：

- **基础模型**：线程、线程封闭与 JMM，理解线程执行、状态隔离和内存可见性。
- **同步机制**：volatile、synchronized、CAS、AQS 与并发集合，理解共享状态如何被安全访问。
- **任务组织与应用**：线程池、异步编程、虚拟线程与结构化并发，理解任务如何调度、组合和管理。

建议按顺序阅读。如果你已经有一定基础，可以跳过前两部分，从 [JMM](./chapter-04-jmm) 开始——它是理解后续所有内容的钥匙。

> **与本专题其他章节的关系：** 本章回答的是“为什么”——为什么需要并发。[线程模型](./chapter-02-thread-model)将回答“是什么”——Java 中的线程到底是什么东西；[线程封闭](./chapter-03-threadlocal)引入线程封闭思路，先给出一条回避竞争的捷径；[JMM](./chapter-04-jmm)回答“怎么保证正确性”——当多个线程同时访问数据时，Java 内存模型提供了哪些保证。如果你对本章提到的任何概念（如 CAS、AQS、ForkJoinPool、虚拟线程）感到陌生，不必担心，后续章节会逐一展开。
