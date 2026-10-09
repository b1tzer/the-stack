# `Condition` 与同步工具：基于 AQS 的应用

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

### 1.2 生产者-消费者用两条 Condition 精确唤醒

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

`java.util.concurrent.locks` 与 `java.util.concurrent` 里几乎所有同步工具都是 AQS 子类。它们的差异，落到源码上就是四行 `try*` 方法的写法不同。

### 2.1 一张矩阵

| 工具 | 模式 | `state` 语义 | 典型用途 |
| :-- | :-- | :-- | :-- |
| `ReentrantLock` | 独占 | 0 空闲；n 表示同一线程重入 n 次 | 通用互斥 |
| `ReentrantReadWriteLock` | 独占 + 共享 | 高 16 位 = 读锁持有数；低 16 位 = 写锁重入 | 读多写少 |
| `StampedLock` | 独占 + 共享 + 乐观读 | 版本戳（含锁状态） | 读极多、读操作极短 |
| `Semaphore` | 共享 | 剩余许可数 | 限流、资源池 |
| `CountDownLatch` | 共享（一次性） | 未完成计数 | 等 N 件事都完成 |
| `CyclicBarrier` | 用 `ReentrantLock` + `Condition` 组合，而非直接 AQS | —— | 一批线程互相等到齐再一起走 |

`CyclicBarrier` 是唯一没有直接继承 AQS 的常用工具——它自己组合 `Lock` + `Condition` 就够用。列在这里方便一同选型。

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

`state != 0` 且低 16 位为 0 时，说明"有读锁在，无写锁"——新读线程可以并发进入。这样一次 CAS 就能同时判读锁和写锁，位分割设计让并发状态管理不需要额外字段。

代价是理论上限——最多 65535 个并发读、65535 次写锁重入。业务里几乎不会撞到，但排查时值得记住。

### 2.3 `StampedLock`：乐观读绕开了 CAS

`ReentrantReadWriteLock` 有一个跑不掉的问题：**写线程饥饿**。读远多于写时，读锁一直有人持有，写请求永远等不到"读锁数归零"。

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
| JIT 优化 | 锁消除、锁粗化 | 无对应优化 |

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

这是 `Lock` 相比 `synchronized` 最容易踩的坑。`synchronized` 的 `monitorexit` 有异常处理路径保底（见第 6 章 §5），`Lock` 没有——`unlock` 必须写在 `finally` 里。

## 3. 本页小结

| 问题 | 根源 | 解决方案 |
| :-- | :-- | :-- |
| 需要超时/中断/公平的锁 | `synchronized` 把选择权关在 JVM 内部 | `LockSupport` 把挂起/唤醒暴露给 Java 层 |
| 唤醒可能早于挂起造成丢失 | `notify` 无许可证语义 | `LockSupport.unpark` 的许可证保留 |
| 每种同步器都要写一套等待队列 | 队列与业务耦合 | AQS 抽出"state + CLH + park/unpark"骨架 |
| 独占与共享的唤醒规则不同 | 一个持有者 vs 多个持有者 | 共享模式的 `PROPAGATE` 传播 |
| 多种等待条件混在一个 Monitor 里 | `_WaitSet` 只有一个 | `Condition` 每个一条独立队列 |
| 读多写少下写线程饥饿 | `ReadWriteLock` 允许无限读并发 | `StampedLock` 的乐观读 |
| `Lock` 忘解锁导致永久阻塞 | 无编译器保底 | `unlock` 强制放 `finally` |
