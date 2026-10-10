# 虚拟线程模型与 Pinning（JDK 21）

> 如果一条线程可以像一个对象那样廉价，过去十年围绕线程池积累的工程直觉，还剩下多少是对的？

Java 21 把虚拟线程从预览特性升级为 GA。它不是一种新语言语法，也不是异步框架，而是对 `java.lang.Thread` 的实现层重写：同样的类、API 和编程风格，但一台 JVM 可以同时承载远多于平台线程数量的虚拟线程。实际规模仍受内存、载体线程、阻塞点和 JVM 参数约束。

本章讨论：这次改动改到了哪里，改到了什么程度，改动之外还剩下什么。

## 1. 平台线程走到尽头的原因

### 1.1 一条平台线程的成本清单

在 JDK 21 之前，`new Thread()` 得到的每一条 Java 线程背后都对应一条 OS 线程（HotSpot 的 1:1 模型，见[第 2 章](./chapter-02-thread-model.md)）。这条 OS 线程要付出的固定成本：

| 项目 | 量级示意 | 说明 |
| :-- | :-- | :-- |
| 栈内存 | 常见配置约 1 MB | 依 `-Xss` 与平台而变；预留虚拟地址空间不等于全部提交 |
| 内核态数据结构 | 数 KB | `task_struct`、内核栈、调度器条目 |
| 上下文切换 | 依负载与平台而变 | 保存/恢复寄存器、切换 TLB、可能刷新缓存 |
| 创建/销毁 | 系统调用与分配相关 | 依 OS、安全配置和当前负载而变 |

上表只能用于建立数量级直觉，不能据此给固定线程上限。平台线程容量还受 `-Xss`、内核栈、进程线程数限制、内存映射数量和实际驻留页影响，必须结合目标操作系统与 JVM 压测。线程过多时，调度和上下文切换成本通常会比单条线程的固定开销更早成为瓶颈。

### 1.2 高并发场景下的两难

下面用一个假设的后端接口说明等待时间与并发数的关系：

```txt
        接收请求
             │
             ▼
     ┌────────────┐    RT 里 95% 时间在这
     │  下游 IO   │    数据库、Redis、下游服务
     └────────────┘
             │
             ▼
        组装返回
```

以下用一个假设场景计算平均并发数：线程 95% 的时间在等待 I/O，QPS = 10 000，平均 RT = 200 ms。按 Little 定律得到：

```txt
N = QPS × RT = 10 000 × 0.2s = 2 000
```

在这个假设下，约有 2 000 条线程同时处于等待状态。它是否触及平台上限取决于服务配置；如果可用并发额度不足，提高 QPS 后可能排队或拒绝请求。

过去应对这个矛盾有两条路：

- **限并发**：Tomcat 的 `maxThreads=200`，多余请求排队 —— 用户在门口等
- **改异步**：Netty、Reactor、`CompletableFuture` 链 —— 一条线程处理成千上万条连接

### 1.3 Reactor 路径的隐藏成本

异步方案不是没有代价。写过 `WebFlux` 或者 Netty 应用的人知道下面这几件事：

```java
// ❌ Reactor 式代码：调用栈被切碎
Mono<Order> loadOrder(String id) {
    return orderRepo.findById(id)
        .flatMap(order -> userRepo.findById(order.userId())
            .flatMap(user -> itemRepo.findAll(order.itemIds())
                .collectList()
                .map(items -> assemble(order, user, items))));
}
```

```java
// ✅ 同步代码：直读直写
Order loadOrder(String id) {
    Order order = orderRepo.findById(id);
    User user = userRepo.findById(order.userId());
    List<Item> items = itemRepo.findAll(order.itemIds());
    return assemble(order, user, items);
}
```

Reactor 版本换来的是吞吐，付出的是：

- **异常栈丢失**：`onError` 拿到的 stack trace 通常停在 Reactor 内部
- **`ThreadLocal` 失效**：跨算子切线程后 MDC、事务、租户上下文全断
- **调试困难**：断点打不到业务逻辑，`step over` 直接跳出方法
- **心智负担**：`flatMap` / `zipWith` / `switchIfEmpty` 的语义精确性要求高

也就是说，Reactor 让 CPU 更闲了，但让人更累了。

### 1.4 虚拟线程要解决的问题

虚拟线程给出的答案是：**同步代码风格 + 异步执行效率**。让开发者继续用 `Thread` / `ExecutorService` / try-catch / `ThreadLocal`，同时把 IO 阻塞时的"线程占坑"问题在 JVM 层面消掉。

## 2. 虚拟线程：M:N 调度与 continuation

### 2.1 虚拟线程与平台线程的对照

![虚拟线程由载体线程池调度并映射到平台线程的执行模型](/java/vt-mapping.svg)

- **虚拟线程（Virtual Thread, VT）**：`java.lang.Thread` 的子类实例，栈保存在堆上，个数可达百万级
- **载体线程（Carrier Thread）**：真正的平台线程，是 VT 运行时实际占用的 CPU 执行流；VT 只在 Carrier 上"临时挂载"
- **调度器（Scheduler）**：默认是一个专用的 `ForkJoinPool`，决定哪个 VT 挂到哪个 Carrier 上运行

关键设计：**当 VT 阻塞在 JDK 阻塞点（如 `Socket.read`、`Thread.sleep`、`LockSupport.park`）时，JVM 会把 VT 从 Carrier 上卸载，Carrier 立即去执行别的 VT**。等阻塞条件满足，VT 被重新挂到某条 Carrier 上继续跑。

### 2.2 continuation：可挂起可恢复的执行片段

虚拟线程的挂起/恢复能力，来自一个更底层的机制——`Continuation`（`jdk.internal.vm.Continuation`）。

一段执行流有两种状态：

- **running**：栈帧在某条 Carrier 的调用栈上
- **frozen**：栈帧被复制到堆上，等待被"解冻"

`Continuation.yield(scope)` 触发从 running 到 frozen 的转换：JVM 把当前 Carrier 上属于这个 VT 的所有栈帧、局部变量、返回地址复制到堆上的一段内存里，然后 Carrier 上的 `run()` 方法返回，Carrier 继续挑下一个 VT。

`Continuation.run()` 触发从 frozen 到 running：JVM 把堆上保存的栈帧复制回 Carrier 的调用栈顶，代码从 yield 点继续执行。

对读者的意义是：**虚拟线程不是操作系统线程，也不是协程库，而是"栈可搬家的 Java 线程"**。Java 语言不需要 `async` / `await` 关键字，因为搬家的动作发生在 JDK 内部的 IO 调用里，业务代码看不见。

### 2.3 调度器与 Carrier 池

默认 Carrier 池的属性可以用系统属性调整：

```bash
# Carrier 数量，默认等于 CPU 核数
-Djdk.virtualThreadScheduler.parallelism=16

# 最大并行度上限
-Djdk.virtualThreadScheduler.maxPoolSize=256

# 最小活跃 Carrier 数（发生 pinning 时新增）
-Djdk.virtualThreadScheduler.minRunnable=1
```

生产环境几乎不需要动这些参数——默认值已经是"CPU 核数"，这也是**平台线程池 IO 密集配置的经验值 `2 × N_CPU` 都被虚拟线程重新定义**的原因：CPU 核数由 Carrier 决定，与 VT 数量无关。

### 2.4 创建虚拟线程的四种方式

| 方式 | 场景 | 特点 |
| :-- | :-- | :-- |
| `Thread.startVirtualThread(runnable)` | 一次性异步任务 | 最简洁，立即启动 |
| `Thread.ofVirtual().name(...).start(runnable)` | 需要命名、异常处理器 | 通过 builder 配置 |
| `Executors.newVirtualThreadPerTaskExecutor()` | 替换现有 `ExecutorService` | 兼容既有代码 |
| `StructuredTaskScope`（第 14 章 §2.5） | 有生命周期约束的子任务组 | 结构化并发入口 |

```java
// 场景 1：一次性任务
Thread.startVirtualThread(() -> log.info("hello vt"));

// 场景 2：需要配置
Thread vt = Thread.ofVirtual()
    .name("order-worker-", 0)          // "order-worker-0"
    .uncaughtExceptionHandler((t, e) -> log.error("vt failed", e))
    .start(() -> processOrder(id));

// 场景 3：替换线程池
try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Request req : requests) {
        pool.submit(() -> handle(req));
    }
}   // try-with-resources 自动等待所有任务完成
```

**注意 `newVirtualThreadPerTaskExecutor` 的语义**：它不是"共享一批固定 Carrier 的池"，而是"每提交一个任务就新起一条虚拟线程"。它更接近 `newCachedThreadPool`，但没有创建上限——因为 VT 本身就是廉价的。

## 3. pinning：`synchronized` 造成的钉住问题 {#virtual-thread-pinning}

### 3.1 什么是 pinning

虚拟线程遇到阻塞点时，JVM 应当把它从 Carrier 卸载下来，让 Carrier 空出手服务别的 VT。但在两种情况下卸载会失败——这条 VT 被"钉"在了 Carrier 上，直到阻塞返回。这种现象叫 **pinning**。

被钉住时的现场：

```txt
虚拟线程 VT1 持有 monitor lock，进入 synchronized 块 → 挂载在 Carrier C1
                                    │
                                    │  发起 HTTP 请求，等待响应
                                    ▼
    正常情况：VT1 应该被卸载，C1 去跑其他 VT
    pinning：VT1 卡在 C1 上，C1 无法离开
    后果：VT1、C1 一起等 HTTP 响应；期间其他 VT 少一条可用 Carrier
```

如果 Carrier 池只有 8 条，且业务大量使用 `synchronized` 包裹阻塞 I/O，8 条 Carrier 可能全部被钉住。此时虚拟线程调度可能退化到接近传统线程池的瓶颈，实际吞吐也可能低于配置合理的固定线程池。

### 3.2 造成 pinning 的两类场景

| 场景 | 原因 | JDK 21 表现 | JDK 24 表现 |
| :-- | :-- | :-- | :-- |
| `synchronized` 块内执行阻塞 IO | monitor 与 Carrier 强绑定，无法搬走栈帧 | 钉住 | 已修复（JEP 491） |
| 本地方法（JNI）内阻塞 | JVM 无法感知 native 栈帧 | 钉住 | 仍钉住 |

JDK 21–23 里 `synchronized` 是 pinning 的主要来源之一。JDK 24（2025-03）通过 JEP 491 让 `synchronized` 内的虚拟线程也能挂起，消除了这一类来源；JNI 等其他 pinning 原因仍需单独分析。生产环境停留在 JDK 21 LTS 时，应继续评估这段组合。

### 3.3 迁移建议：从 synchronized 到 ReentrantLock

```java
// ❌ JDK 21 下会 pinning
public class OrderService {
    private final Object lock = new Object();

    public void update(String id) {
        synchronized (lock) {
            httpClient.send(request);   // 阻塞 IO，VT 被钉在 Carrier 上
            db.write(id);
        }
    }
}
```

```java
// ✅ 用 ReentrantLock 替换：VT 会正常卸载
public class OrderService {
    private final ReentrantLock lock = new ReentrantLock();

    public void update(String id) {
        lock.lock();
        try {
            httpClient.send(request);   // VT 阻塞时被卸载，Carrier 空闲
            db.write(id);
        } finally {
            lock.unlock();
        }
    }
}
```

`ReentrantLock` 通过 `LockSupport.park` 挂起，JDK 21 的虚拟线程会把这段等待从 Carrier 上卸载。**在 JDK 21–23 中，应重点排查 `synchronized` 与阻塞 I/O 的组合；运行在 JDK 24+ 时再按 JEP 491 后的行为重新评估**。

### 3.4 pinning 的检测手段

生产环境常用三条路径：

```bash
# 1. 启动参数：VT 一旦 pinning 就打印栈
-Djdk.tracePinnedThreads=short   # 只打印栈顶
-Djdk.tracePinnedThreads=full    # 打印完整栈

# 2. JFR 事件
jcmd <pid> JFR.start settings=profile
# 事件名: jdk.VirtualThreadPinned

# 3. 线程快照
jcmd <pid> Thread.dump_to_file -format=json /tmp/vt-dump.json
# 输出中 state=RUNNABLE 且 carrier != null 的 VT 值得关注
```

`jdk.tracePinnedThreads=short` 的输出片段示例：

```txt
Thread[#42,ForkJoinPool-1-worker-3,5,CarrierThreads]
    java.base/java.net.Socket.connect(Socket.java:...)
    <monitors:>
    - java.lang.Object@0x00000007c0a01234
```

`<monitors:>` 后列出的 monitor 就是钉住的元凶。


前面几节解释了虚拟线程的调度模型、pinning 机制和适用限制。下一步把这些结论转成迁移决策：哪些场景应保留平台线程、如何使用结构化并发，以及如何从传统 API 平滑迁移。

> **下一页：** [适用边界、结构化并发与迁移](./chapter-14-virtual-thread-migration.md)
