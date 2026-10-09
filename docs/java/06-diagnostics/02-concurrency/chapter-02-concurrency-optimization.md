# 并发性能优化：从锁竞争到异步化

> 诊断只回答“为什么慢”或“为什么错”，本页继续回答“确认根因后怎么改”。六种策略都围绕同一个目标：减少共享争用，同时明确数据一致性、持久性和隔离性的代价。

## 1. 六种并发性能优化策略

诊断到问题之后，剩下的是修。生产上被反复验证过的策略只有六种。

### 1.1 减少锁粒度

大锁拆小锁，把"谁进来都要抢"改成"分区各管各的"。经典案例是 `ConcurrentHashMap` 从 JDK 7 的 Segment 分段锁到 JDK 8 的 bin 级锁的演进：

```txt
JDK 7：16 个 Segment，16 把锁                    JDK 8+：每个 bin 一把锁
┌─────────┬─────────┬─────────┐                 ┌───┬───┬───┬───┬───┬───┐
│Segment 0│Segment 1│Segment 2│ ...             │b 0│b 1│b 2│b 3│b 4│...│
│ Lock 0  │ Lock 1  │ Lock 2  │                 └───┴───┴───┴───┴───┴───┘
└─────────┴─────────┴─────────┘                 并发度 = bin 数（默认 16，动态扩展）
并发度 = 16
```

工程上直接换 `ConcurrentHashMap` 就够——无锁读、CAS 写、只有哈希冲突到 bin 级才加锁。

### 1.2 无锁化：用 CAS 替代锁

`AtomicLong` / `LongAdder` 是最常见的两种：

```java
// synchronized：竞争高时慢
public synchronized void inc() { count++; }

// AtomicLong：CAS 重试，无阻塞
private final AtomicLong count = new AtomicLong();
public void inc() { count.incrementAndGet(); }

// LongAdder：分散热点，最后汇总
private final LongAdder count = new LongAdder();
public void inc() { count.increment(); }
```

三者在 8 线程并发递增 100 万次的相对量级：

| 方案 | 相对耗时 | 何时用 |
| :-- | :-- | :-- |
| `synchronized` | ~450 ms | 低竞争，同时需要复合原子性 |
| `AtomicLong` | ~120 ms | 计数器、序列号，中等竞争 |
| `LongAdder` | ~45 ms | 高竞争的纯累加 / 统计场景 |

判断标准：**只需要"最终一致的累加"用 `LongAdder`；需要"每次读到最新准确值"用 `AtomicLong`**。

### 1.3 读写分离

读多写少的场景，共享读比独占读快一个数量级：

| 方案 | 读性能 | 写性能 | 适用 |
| :-- | :-- | :-- | :-- |
| `synchronized` | 低（读也互斥） | 低 | 读写均衡 |
| `ReentrantReadWriteLock` | 高（读共享） | 低（写独占） | 读多写少 |
| `StampedLock` 乐观读 | 极高（无 CAS） | 中 | 读极多、读操作短 |
| `CopyOnWriteArrayList` | 极高（无锁） | 极低（复制整个数组） | 读极多、写极少的**配置类**数据 |

`CopyOnWriteArrayList` 的写成本是 O(N) 数组复制，不适合频繁写入。**只有"读远大于写、且写操作可以合并成批"的场景**（配置、白名单、订阅者列表）才划算。

### 1.4 批处理

减少加锁次数：

```java
// ❌ 每条数据都获取一次锁
for (Order o : orders) {
    synchronized (dbLock) { insert(o); }
}

// ✅ 一次锁批量提交
synchronized (dbLock) {
    batchInsert(orders);
}
```

更进一步：**攒批 + 异步 flush**，从"每次入库都同步"变成"入队后立刻返回，后台线程定时批量入库"：

```java
private final BlockingQueue<Order> queue = new LinkedBlockingQueue<>(10_000);

public void add(Order o) {
    queue.offer(o);                // 无锁入队
}

@Scheduled(fixedRate = 100)
public void flush() {
    List<Order> batch = new ArrayList<>();
    queue.drainTo(batch, 500);
    if (!batch.isEmpty()) batchInsert(batch);
}
```

代价：**入库不再立即持久化，异常场景会丢队列里未 flush 的数据**。业务能容忍"一定时间窗口的数据丢失"再上这条策略。

### 1.5 异步化

用户请求的响应路径上只做必要工作，非核心操作丢到异步线程：

```java
// 优化前：整条链同步串行，总 RT ≈ 290ms
public OrderResult create(OrderRequest req) {
    validate(req);          // 10 ms
    saveToDB(req);          // 50 ms
    sendNotification(req);  // 200 ms  ← 外部服务
    updateInventory(req);   // 30 ms
    return new OrderResult();
}

// 优化后：核心同步 + 非核心异步，用户可见 RT ≈ 60ms
public OrderResult create(OrderRequest req) {
    validate(req);
    saveToDB(req);
    CompletableFuture.runAsync(() -> sendNotification(req), notifyPool);
    CompletableFuture.runAsync(() -> updateInventory(req),  inventoryPool);
    return new OrderResult();
}
```

配合第 11 章"业务线程池要相互隔离"的规则——异步任务不能扔到 `commonPool`。

### 1.6 六种策略一览

| 策略 | 核心思路 | 适用场景 | 代表工具 |
| :-- | :-- | :-- | :-- |
| 减少锁粒度 | 大锁拆小锁 | 高并发容器 | `ConcurrentHashMap` |
| 无锁化 | CAS 替代锁 | 计数、累加 | `AtomicLong` / `LongAdder` |
| 读写分离 | 读不互斥 | 读多写少 | `ReadWriteLock` / COW |
| 批处理 | 合并加锁 | 高频小操作 | 批量 SQL / 攒批队列 |
| 异步化 | 请求与处理解耦 | 非核心慢操作 | `CompletableFuture` / MQ |
| 换工具 | 用无锁数据结构 | 队列、Map | `ConcurrentLinkedQueue` |

> **回到诊断入口：** [并发问题诊断](./chapter-01-concurrency-diagnostics.md)
