# `Condition` 与 AQS 同步工具

> 本页建立在 [LockSupport 与 AQS 核心机制](./chapter-08-locksupport-aqs.md) 之上，回答两个应用问题：多个等待条件如何精确唤醒，以及常见同步工具在 AQS 上如何分工与选型。

## 1. `Condition`：AQS 里的等待队列

`ReentrantLock.newCondition()` 得到一个 `Condition` 对象。它替代 `Object.wait/notify`，能力上超过后者。

### 1.1 两条独立的队列

一个 AQS 内部只有一条 CLH **同步队列**（排队争锁的）。但可以挂**多个条件队列**——每个 `Condition` 一条：

```txt
同步队列（一条，AQS 内建）
   head → Node → Node → Node ← tail
           争锁排队者

Condition_notEmpty 条件队列（挂在 lock 上）
   firstWaiter → Node → Node ← lastWaiter
                在 notEmpty 上 await 的线程

Condition_notFull 条件队列（挂在同一个 lock 上）
   firstWaiter → Node ← lastWaiter
                在 notFull 上 await 的线程
```

节点在两条队列之间迁移：

- **`await()`**：从"当前持锁线程"→ 释放锁 → 加入指定 `Condition` 的条件队列尾 → `park`
- **`signal()`**：把条件队列的第一个节点摘下来 → 转移到同步队列尾 → 等待被锁释放时唤醒

**关键**：`signal` 不代表"立刻运行"。被 `signal` 的线程只是从"等条件"变成"等锁"，还得排队争锁——和 `wait/notify` 是一样的。

### 1.2 生产者-消费者用两条 Condition 精确唤醒 {#condition-producer-consumer}

```java
private final ReentrantLock lock = new ReentrantLock();
private final Condition notFull  = lock.newCondition();
private final Condition notEmpty = lock.newCondition();

public void put(E e) throws InterruptedException {
    lock.lock();
    try {
        while (isFull()) notFull.await();     // 只挂在 notFull 上
        enqueue(e);
        notEmpty.signal();                    // 精确唤一个消费者
    } finally { lock.unlock(); }
}

public E take() throws InterruptedException {
    lock.lock();
    try {
        while (isEmpty()) notEmpty.await();   // 只挂在 notEmpty 上
        E e = dequeue();
        notFull.signal();                     // 精确唤一个生产者
    } finally { lock.unlock(); }
}
```

用 `wait/notify` 实现同样的语义，只能用 `notifyAll` 把生产者和消费者一起叫起来，让每条线程醒来后自己重判——这就是"惊群"。`Condition` 把两条队列拆开，每次 `signal` 只精准唤一个方向的线程。

### 1.3 `Condition` vs `wait/notify`

| 维度 | `wait/notify` | `Condition` |
| :-- | :-- | :-- |
| 队列数量 | 一个（Monitor 的等待队列） | 多个（每次 `newCondition` 一条） |
| 唤醒精度 | `notifyAll` 惊群，`notify` 随机挑 | `signal` 只唤指定条件的线程 |
| 可中断等待 | `wait()` 支持 | `await()` 支持，另有 `awaitUninterruptibly` |
| 超时等待 | `wait(ms)` | `await(t, unit)` / `awaitUntil(deadline)` |
| 前置要求 | 必须在 `synchronized` 块内 | 必须在 `lock/unlock` 内 |

`await` 的超时组合也比 `wait` 丰富——`awaitNanos` 返回剩余时间、`awaitUntil` 用绝对时间。前者适合"再等 500ms 就走"，后者适合"11 点前必须返回"。

## 2. 基于 AQS 的工具矩阵

`java.util.concurrent.locks` 与 `java.util.concurrent` 中的多个工具直接复用 AQS；`StampedLock` 和 `CyclicBarrier` 则使用自己的锁状态或 `Lock`/`Condition` 组合。对 AQS 工具来说，它们的差异主要落在 `tryAcquire*`、`tryRelease*`、`tryAcquireShared*` 和 `tryReleaseShared*` 的实现方式。

### 2.1 一张矩阵

| 工具 | 模式 | `state` 语义 | 典型用途 |
| :-- | :-- | :-- | :-- |
| `ReentrantLock` | 独占 | 0 空闲；n 表示同一线程重入 n 次 | 通用互斥 |
| `ReentrantReadWriteLock` | 独占 + 共享 | 高 16 位 = 读锁持有数；低 16 位 = 写锁重入 | 读多写少 |
| `StampedLock` | 独占 + 共享 + 乐观读 | 版本戳（含锁状态） | 读极多、读操作极短 |
| `Semaphore` | 共享 | 剩余许可数 | 限流、资源池 |
| `CountDownLatch` | 共享（一次性） | 未完成计数 | 等 N 件事都完成 |
| `CyclicBarrier` | 用 `ReentrantLock` + `Condition` 组合，而非直接 AQS | —— | 一批线程互相等到齐再一起走 |

`CyclicBarrier` 和 `StampedLock` 不直接继承 AQS：前者用 `ReentrantLock` 与 `Condition` 组合，后者用内部版本戳和同步状态。列在这里是为了按协调语义一并选型，而不是把所有工具都归入同一套 AQS 源码。

### 2.2 `ReentrantReadWriteLock`：一个 `int` 同时管理读写

用 32 位 `state` 的高低位分别记两种锁：

```txt
state (32 bit)
┌───────────────────────┬───────────────────────┐
│    高 16 位             │    低 16 位            │
│    读锁持有数           │    写锁重入次数        │
│    (共享模式)          │    (独占模式)         │
└───────────────────────┴───────────────────────┘
```

`state != 0` 且低 16 位为 0 时，说明“有读锁在，无写锁”——读请求可以尝试 CAS 增加读计数。是否立即进入还受公平策略、队列中其他请求和并发竞争影响。位分割设计让读写状态共享一个 `int`，但不意味着所有读线程都无条件绕过排队。

代价是理论上限——最多 65535 个并发读、65535 次写锁重入。是否接近上限取决于业务规模，排查计数异常时值得记住。

### 2.3 `StampedLock`：乐观读绕开了 CAS

`ReentrantReadWriteLock` 在非公平模式下有一个风险：**写线程可能长时间等待**。读远多于写时，持续进入的读请求可能让写请求迟迟得不到机会；非公平模式不提供严格的等待时间保证。

`StampedLock` 用三档模式解决：

```java
StampedLock lock = new StampedLock();

// 1. 悲观写锁（独占）
long stamp = lock.writeLock();
try { /* 写 */ } finally { lock.unlockWrite(stamp); }

// 2. 悲观读锁（共享）
long stamp = lock.readLock();
try { /* 读 */ } finally { lock.unlockRead(stamp); }

// 3. 乐观读（不加锁！）
long stamp = lock.tryOptimisticRead();
int x = point.x, y = point.y;
if (!lock.validate(stamp)) {         // 期间被写过？
    stamp = lock.readLock();          // 降级到悲观读
    try { x = point.x; y = point.y; }
    finally { lock.unlockRead(stamp); }
}
```

乐观读不获取写锁，读取时只检查版本戳，读完后通过 `validate()` 判断期间是否发生写入。**读多、读操作短**的场景下，它通常比悲观读锁更轻；实际成本仍取决于架构、内存序和实现细节。

限制：`StampedLock` 不可重入，也不支持 `Condition`。它是一个"高性能读写锁"，不是 `ReentrantLock` 的替代品。

### 2.4 `Lock` vs `synchronized`：三维对比

`Lock` 提供的新能力，付出的代价，与 `synchronized` 的对照：

| 维度 | `synchronized` | `Lock` |
| :-- | :-- | :-- |
| 可中断获取 | ❌ | ✅ `lockInterruptibly()` |
| 超时获取 | ❌ | ✅ `tryLock(t, unit)` |
| 非阻塞尝试 | ❌ | ✅ `tryLock()` |
| 公平 / 非公平 | 仅非公平 | 构造时可选 |
| 条件队列数量 | 一条 | 多条（`newCondition`） |
| 非块结构（跨方法加解锁） | ❌ | ✅ |
| 出错自动释放 | 编译器保证 | 必须 `try/finally` 手写 |
| JIT 优化 | 常见有锁消除、锁粗化 | 优化路径不同，需按具体调用点与 JVM 分析 |

选型规则很好记：

- **没有 `Lock` 才有的能力诉求** → 用 `synchronized`；简单且 JIT 会替你做优化
- **需要超时 / 中断 / 公平 / 多条件队列 / 跨方法持锁** → 用 `Lock`
- **写少读多且读操作短** → `StampedLock`
- **写少读多但需要重入或 `Condition`** → `ReentrantReadWriteLock`

```java
// ❌ Lock 忘了 try/finally，异常路径漏解锁
lock.lock();
doSomething();       // 抛异常，锁永远不释放
lock.unlock();

// ✅ 强制 try/finally
lock.lock();
try {
    doSomething();
} finally {
    lock.unlock();
}
```

这是 `Lock` 相比 `synchronized` 最容易踩的坑。[`synchronized` 的 `monitorexit` 有异常处理路径保底](./chapter-06-synchronized.md)，`Lock` 没有——`unlock` 必须写在 `finally` 里。

## 3. 常见协调工具的语义与边界

`Semaphore`、`CountDownLatch` 和 `CyclicBarrier` 都解决“多个线程按某种计数协作”的问题，但计数代表的含义、能否复用和失败后的状态不同。

### 3.1 CountDownLatch：一次性的完成计数

`CountDownLatch` 创建时固定计数。其他线程调用 `await()` 等待计数归零，负责方完成一项工作后调用 `countDown()`：

```java
CountDownLatch completed = new CountDownLatch(tasks.size());
for (Runnable task : tasks) {
    executor.execute(() -> {
        try {
            runTask(task);
        } finally {
            completed.countDown();
        }
    });
}

if (!completed.await(3, TimeUnit.SECONDS)) {
    throw new IllegalStateException("workers did not become ready in time");
}
```

计数不能重置。需要重复使用时创建新的 Latch，或者选择支持重置的协调结构。`await()` 可以被中断，也支持超时；调用方必须处理 `InterruptedException`。Latch 只表达“完成了多少”，不会收集工作线程抛出的异常；任务失败还要通过 `Future`、异常队列或统一错误处理传回。它适合“等 N 件一次性事件完成”，不适合“每轮都让 N 个线程重新集合”。

### 3.2 Semaphore：限制许可数量

`Semaphore` 的状态表示可用许可数。线程先 `acquire()` 或 `tryAcquire()` 取得许可，完成资源使用后在 `finally` 中 `release()`：

```java
Semaphore permits = new Semaphore(maxConcurrentRequests);

if (permits.tryAcquire()) {
    try {
        callLimitedResource();
    } finally {
        permits.release();
    }
} else {
    throw new RejectedExecutionException("concurrency limit reached");
}
```

必须保证“成功取得的许可最终只释放一次”。没有先取得许可却调用 `release()`，会凭空增加许可，使限流失效。`tryAcquire()` 可以立即返回失败，`tryAcquire(timeout)` 可以给等待设置预算。Semaphore 默认不保证公平排队；在强公平需求下要显式构造公平模式，并接受吞吐与排队行为的变化。

### 3.3 CyclicBarrier：一批线程互相等待

`CyclicBarrier(parties)` 要求指定数量的线程都调用 `await()` 后才一起继续。可以在创建时提供 barrier action，让所有线程释放前先执行一次公共步骤：

```java
CyclicBarrier barrier = new CyclicBarrier(
        participantCount,
        () -> publishRoundResult()
);

// 每个参与线程在每一轮结束时调用
barrier.await(5, TimeUnit.SECONDS);
```

调用点需要声明或捕获 `InterruptedException`、`TimeoutException` 和 `BrokenBarrierException`。一轮全部到达后，Barrier 可以复用。任一线程中断、超时或抛出异常时，Barrier 进入 broken 状态，其他等待线程会收到 `BrokenBarrierException`，后续 `await()` 也无法自动恢复。需要重试时必须明确调用 `reset()`，或创建新的 Barrier。它由 `ReentrantLock` 和 `Condition` 组合实现，不直接继承 AQS。

### 3.4 按协作语义选型

| 你想表达的关系 | 首选工具 | 不适合的场景 |
| :-- | :-- | :-- |
| 一次性等待 N 个事件完成 | `CountDownLatch` | 需要多轮复用 |
| 最多允许 N 个线程进入资源 | `Semaphore` | 只想等待固定事件数量 |
| N 个线程每轮到齐后一起继续 | `CyclicBarrier` | 单向通知或单次启动门闩 |
| 精确唤醒生产者或消费者 | 两个 `Condition` | 线程只等待一个一次性计数 |
| 多阶段、动态参与方 | 需要评估 `Phaser` 等结构 | 把上述工具强行拼接 |

这些工具都只协调线程，不解决共享数据的原子更新，也不决定任务在哪个线程池执行。选型后还要检查[并发集合](./chapter-10-concurrent-collections.md)、[线程池](./chapter-11-thread-pool.md)和[并发性能优化](../06-diagnostics/02-concurrency/chapter-02-concurrency-optimization.md)是否形成完整方案。

## 4. 本页小结

| 问题 | 根源 | 解决方案 |
| :-- | :-- | :-- |
| 需要超时/中断/公平的锁 | `synchronized` 把选择权关在 JVM 内部 | `LockSupport` 把挂起/唤醒暴露给 Java 层 |
| 唤醒可能早于挂起造成丢失 | `notify` 无许可证语义 | `LockSupport.unpark` 的许可证保留 |
| 每种同步器都要写一套等待队列 | 队列与业务耦合 | AQS 抽出"state + CLH + park/unpark"骨架 |
| 独占与共享的唤醒规则不同 | 一个持有者 vs 多个持有者 | JDK 21：`SharedNode` + `signalNextIfShared` |
| 多种等待条件混在一个 Monitor 里 | `_WaitSet` 只有一个 | `Condition` 每个一条独立队列 |
| 读多写少下写线程等待 | 非公平读锁可能被持续读请求延迟 | `StampedLock` 的乐观读 |
| `Lock` 忘解锁导致永久阻塞 | 无编译器保底 | `unlock` 强制放 `finally` |
