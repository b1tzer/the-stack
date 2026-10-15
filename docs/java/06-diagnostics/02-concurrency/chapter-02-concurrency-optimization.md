# 并发性能优化：从锁竞争到异步化

> 诊断只回答“为什么慢”或“为什么错”，本页继续回答“确认根因后怎么改”。六种策略都围绕同一个目标：减少共享争用，同时明确数据一致性、持久性和隔离性的代价。本文的 Java API 说明以 JDK 21 为主要环境；JDK 7 与 JDK 8+ 的实现对比属于历史说明，Spring 定时任务示例依赖相应 Spring 容器配置。

## 1. 先根据诊断结果选择策略

性能优化不是把六种策略依次套一遍。先从线程状态、锁竞争、队列、CPU 和下游耗时中确认瓶颈，再选择能改变该瓶颈的策略。

| 诊断信号 | 优先方向 | 首要验证指标 |
| :-- | :-- | :-- |
| 大量线程长期 `BLOCKED`，锁持有时间长 | 缩小临界区、读写分离、换并发容器 | 锁等待时间、临界区耗时、p99 |
| CPU 高且大量 CAS 重试 | 分散热点、换 `LongAdder` 或分片结构 | 吞吐、CAS 失败率、CPU/请求 |
| 线程池队列持续增长或发生拒绝 | 有界队列、隔离、限流、调整执行模型 | 活跃线程、队列长度、拒绝率 |
| 线程在 Socket 或下游调用上等待 | 超时、异步化、连接池和熔断 | 下游 RT、连接等待、错误传播 |
| 大量高频小操作 | 合并操作或批处理 | 每批延迟、吞吐、失败恢复成本 |
| 数据结构本身成为热点 | 使用语义匹配的并发容器 | 容器操作耗时、争用次数、内存 |

表中的策略是候选方向，不能仅凭单一线程状态确定根因。实施前应结合锁持有栈、队列积压位置、连接池等待和下游耗时等证据进一步定位。

任何方案都要先满足正确性：可见性、原子性、事务持久性和异常传播不能为了吞吐被静默改变。确认根因后，进入下面的策略库。

## 2. 六种并发性能优化策略

诊断到问题之后，剩下的是修。本页按共享对象、读写模式、操作粒度和执行时机，归纳六类可落地策略。

### 2.1 减少锁粒度

大锁拆小锁，把"谁进来都要抢"改成"分区各管各的"。经典案例是 `ConcurrentHashMap` 从 JDK 7 的 Segment 分段锁到 JDK 8 的 bin 级锁的演进：

```txt
JDK 7：16 个 Segment，16 把锁                    JDK 8+：每个 bin 一把锁
┌─────────┬─────────┬─────────┐                 ┌───┬───┬───┬───┬───┬───┐
│Segment 0│Segment 1│Segment 2│ ...             │b 0│b 1│b 2│b 3│b 4│...│
│ Lock 0  │ Lock 1  │ Lock 2  │                 └───┴───┴───┴───┴───┴───┘
└─────────┴─────────┴─────────┘                 示意：不同 bin 上的更新可能并行，实际并发度取决于访问分布与实现
示意：不同 Segment 可并发更新
```

如果瓶颈确实来自共享 Map 的并发访问，且业务操作语义与并发容器一致，可以评估 ConcurrentHashMap。需要原子地完成复合操作时，应选择合适的原子方法或额外同步。

### 2.2 无锁化：用 CAS 替代锁

`AtomicLong` / `LongAdder` 是最常见的两种：

```java
// synchronized：竞争高时慢
public synchronized void inc() { count++; }

// AtomicLong：基于原子更新机制，竞争时可能重试
private final AtomicLong count = new AtomicLong();
public void inc() { count.incrementAndGet(); }

// LongAdder：分散热点，最后汇总
private final LongAdder count = new LongAdder();
public void inc() { count.increment(); }
```

三种方案的取舍不能脱离数据分布、竞争强度、JVM 版本和读写频率。可以按下面的语义边界选型，再用目标环境压测确认：

| 方案 | 核心特征 | 何时用 |
| :-- | :-- | :-- |
| `synchronized` | 低竞争下开销较小，适合包含多步的临界区 | 需要组合状态更新，而不只是单个计数 |
| `AtomicLong` | 单个值的原子更新与读取 | 计数器、序列号等需要精确结果的场景 |
| `LongAdder` | 分散写热点，汇总读取 | 高竞争、只做累加且可接受非瞬时读取的统计 |

判断标准：高竞争、只用于统计累加且不要求并发期间原子快照，可考虑 `LongAdder`；需要原子读取和更新单个计数值时，可考虑 `AtomicLong`。

### 2.3 读写分离

读多写少时，读写锁允许多个读线程并发访问，但是否比独占锁更快取决于读操作耗时、竞争强度和同步开销，需要在目标负载下验证：

| 方案 | 读性能 | 写性能 | 适用 |
| :-- | :-- | :-- | :-- |
| `synchronized` | 低（读也互斥） | 低 | 读写均衡 |
| `ReentrantReadWriteLock` | 高（读共享） | 低（写独占） | 读多写少 |
| `StampedLock` 乐观读 | 读阶段不阻塞，仍需乐观校验 | 中 | 读极多、读操作短 |
| `CopyOnWriteArrayList` | 极高（无锁） | 极低（复制整个数组） | 读极多、写极少的**配置类**数据 |

使用 `StampedLock` 乐观读时，必须通过 `validate(stamp)` 校验读取期间是否发生写锁操作。校验失败后，应重新读取或退回读锁，不能直接使用可能不一致的结果。

`CopyOnWriteArrayList` 的写成本是 O(N) 数组复制，不适合频繁写入。**读远大于写、列表规模和复制成本可接受的场景；写操作能够合并成批时通常更有利**（配置、白名单、订阅者列表）才划算。

### 2.4 批处理

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

这里的 `synchronized` 仅用于说明应用内共享锁的获取次数，不等于数据库事务，也不能协调其他进程或不使用同一把锁的访问。数据库批处理的事务边界需由数据库访问层明确保证。

更进一步：**攒批 + 异步 flush**，从"每次入库都同步"变成"入队后立刻返回，后台线程定时批量入库"：

```java
private final BlockingQueue<Order> queue = new LinkedBlockingQueue<>(10_000);

public void add(Order o) {
    if (!queue.offer(o)) {
        throw new RejectedExecutionException("async write queue is full");
    }
}

@Scheduled(fixedRate = 100)
public void flush() {
    List<Order> batch = new ArrayList<>();
    queue.drainTo(batch, 500);
    if (!batch.isEmpty()) batchInsert(batch);
}
```

队列容量应结合积压对象的内存占用、可接受排队延迟和消费速率确定；队列满时的拒绝行为应与调用方的失败处理约定一致。该片段假设已启用 Spring 定时任务并由容器管理此 Bean。生产实现还需定义应用关闭时未处理批次的收尾策略。

代价：**入库不再立即持久化，异常场景会丢队列里未 flush 的数据**。业务能容忍明确的数据丢失窗口才能采用；队列满、flush 失败和进程退出都要有显式错误处理与监控，不能忽略 `offer()` 的返回值。drainTo 移出的数据不会因 batchInsert 失败自动回到队列。生产实现应明确失败批次的恢复方式，并保证重试不会造成重复写入。

### 2.5 异步化

用户请求的响应路径上只做必要工作，非核心操作丢到异步线程：

```java
// 优化前：整条链同步串行。下列耗时仅用于说明总和关系，不是性能基准。
public OrderResult create(OrderRequest req) {
    validate(req);          // 10 ms
    saveToDB(req);          // 50 ms
    sendNotification(req);  // 200 ms  ← 外部服务
    updateInventory(req);   // 30 ms
    return new OrderResult();
}

// 优化后：仅当通知与库存更新允许异步时，才移出同步响应路径。
public OrderResult create(OrderRequest req) {
    validate(req);
    saveToDB(req);
    CompletableFuture<Void> notifyFuture =
            CompletableFuture.runAsync(() -> sendNotification(req), notifyPool);
    CompletableFuture<Void> inventoryFuture =
            CompletableFuture.runAsync(() -> updateInventory(req), inventoryPool);
    CompletableFuture.allOf(notifyFuture, inventoryFuture)
            .whenComplete((ignored, failure) -> {
                if (failure != null) {
                    recordAsyncFailure(req, failure);
                }
            });
    return new OrderResult();
}
```

示例只在业务明确允许“先返回、后台补齐”时成立；任务异常仍要记录、告警并提供补偿入口。本例返回的结果只能表示订单已受理，不能默认表示库存更新和通知均已成功。若库存更新决定订单能否成立，必须定义相应的失败处理；若业务要求订单与库存原子提交，则不能直接采用此示例。配合[第 11 章“业务线程池要相互隔离”](../../03-java-concurrency/chapter-11-thread-pool.md#thread-pool-isolation)的规则——阻塞或关键业务任务不能直接扔到 `commonPool`。使用自定义线程池仍需明确容量、拒绝行为和任务超时；隔离不能替代背压与失败恢复。具体配置参见线程池章节。

whenComplete 可以观察本次运行中的完成结果，但不提供任务持久化或进程重启后的自动恢复。若任务必须可靠执行，还需另行设计持久化与恢复机制。

### 2.6 换成语义匹配的并发工具

不要在普通集合、锁和异步调用上叠加补丁。先检查 JDK 是否已有语义匹配的实现：

- 计数热点可用 `LongAdder`，需要精确读取时再评估 `AtomicLong`。
- 生产者-消费者使用 `BlockingQueue`，不要手写 `wait/notify`。
- 高并发 Map、Set 和队列优先选择 [ConcurrentHashMap](../../03-java-concurrency/chapter-10-concurrent-collections.md)、并发 Set 或并发队列。
- 需要一次性完成计数、许可限流或循环集合，按[同步工具的协作语义](../../03-java-concurrency/chapter-09-condition-lock-tools.md)选择。

换工具同样有代价：无界队列可能把内存问题推迟到 OOM，复制型容器在频繁写入时会放大成本，公平锁可能降低吞吐。工具名称不能替代边界分析。

### 2.7 六种策略一览

| 策略 | 核心思路 | 适用场景 | 代表工具 |
| :-- | :-- | :-- | :-- |
| 减少锁粒度 | 大锁拆小锁 | 高并发容器 | `ConcurrentHashMap` |
| 无锁化 | CAS 替代锁 | 计数、累加 | `AtomicLong` / `LongAdder` |
| 读写分离 | 读不互斥 | 读多写少 | `ReadWriteLock` / `CopyOnWriteArrayList` |
| 批处理 | 合并加锁 | 高频小操作 | 批量 SQL / 攒批队列 |
| 异步化 | 请求与处理解耦 | 非核心慢操作 | `CompletableFuture` / MQ |
| 换工具 | 让容器语义匹配访问模式 | 队列、Map | 并发容器 |

## 3. 实施顺序与验证指标

一次只改变一个主要变量，并保留可回退路径：

1. 记录修改前的吞吐、p50/p95/p99、错误率、CPU、内存、线程状态和下游依赖指标。
2. 完成正确性测试，覆盖并发更新、异常路径、超时、取消和恢复。
3. 用接近生产的负载与数据分布压测，避免只验证无竞争样例。
4. 注入下游变慢、连接耗尽、线程中断和进程重启，确认失败会显式暴露。
5. 对比修改前后；指标没有改善或故障边界变差时，回退而不是继续叠加策略。

不同策略应观察不同指标：

| 策略 | 成功信号 | 需要防住的回归 |
| :-- | :-- | :-- |
| 缩小锁、读写分离 | 锁等待和 p99 下降 | 竞态、写饥饿、死锁 |
| CAS、无锁化 | 吞吐上升且 CPU/请求下降 | ABA、活锁、读取到中间状态 |
| 批处理 | 吞吐上升、网络往返减少 | 批次失败扩大、数据延迟 |
| 异步化 | 请求线程占用和端到端 RT 下降 | 丢失异常、无限等待、背压缺失 |
| 换并发工具 | 操作耗时下降且语义不变 | 无界增长、错误的并发契约 |

## 4. 什么时候不要继续优化

- 没有基线或瓶颈证据时，不根据“据说更快”替换锁或容器。
- 线程池已经过载时，先限流、隔离和处理下游，不继续增加线程。
- 需要强一致提交或审计顺序时，不把同步写简单改成可能丢数据的异步写。
- 优化只在微型 benchmark 成立、在真实数据分布和故障条件下不成立时，不进入生产。

## 5. 下一步

策略选择完成后，回到[并发问题诊断](./chapter-01-concurrency-diagnostics.md)验证根因是否消失；具体线程、容器和异步语义分别回到[并发集合](../../03-java-concurrency/chapter-10-concurrent-collections.md)、[线程池](../../03-java-concurrency/chapter-11-thread-pool.md)与[异步编程](../../03-java-concurrency/chapter-12-async-model.md)。
