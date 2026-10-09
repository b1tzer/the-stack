# synchronized：从八个问题出发

> 一个 `synchronized` 关键字，锁住的到底是什么？为什么每个 Java 对象都能当锁？为什么 JDK 15 之后偏向锁被默认关闭，`synchronized` 仍然是"够用"的选择？

Java 里几乎所有并发工具都可以追溯到两条根：一条是 `synchronized` + Monitor，一条是 `LockSupport` + AQS。本章聚焦第一条。

`synchronized` 在语法上简单，在实现上覆盖了从字节码、对象头、CAS、自旋、内核态互斥、到 JIT 优化的完整栈。理解它，也就理解了 JVM 处理"临界区"的默认路径。

## 1. 为什么需要 synchronized？

先看一段单线程里正确、多线程里出错的代码：

```java
public class Counter {
    private int count = 0;
    public void increment() { count++; }
}
```

10 条线程各跑 10 000 次 `increment()`，`count` 最终几乎不会是 100 000。因为 `count++` 不是一步，是读、加一、写回三步，中间任一步都可能被别的线程插进来，导致更新丢失。

`synchronized` 就是用来把这段代码变成临界区的：

```java
public class Counter {
    private int count = 0;
    public synchronized void increment() { count++; }
    public synchronized int get() { return count; }
}
```

它一次性给了三样东西：互斥，同一时刻只有一个线程进临界区；可见性，进入临界区能看到上一个持锁线程的全部写入；有序性，临界区里的读写不跨越加锁解锁边界。这三样是打包卖的，而且开销被 JVM 压得很低。

## 2. synchronized 锁的到底是什么？

语法上有三种写法，锁的对象各不相同：

| 写法 | 锁对象 | 场景 |
| :-- | :-- | :-- |
| 修饰实例方法 | `this` | 保护实例可变状态 |
| 修饰静态方法 | 所在类的 `Class` 对象 | 保护类级可变状态 |
| `synchronized (obj) { }` | 指定的 `obj` | 细粒度，只锁该保护的那几行 |

这里有个容易被忽略的事实：**锁不是属于代码块的，是属于对象的**。看一段反编译结果就知道：

```txt
monitorenter            // 栈顶必须是某个对象引用
doSomething()
monitorexit             // 正常退出
monitorexit             // 异常退出
```

`monitorenter` 的操作数是栈顶的一个对象引用，不是"代码块标识"。所以"每个 Java 对象都能当锁"不是一句宣传语，是字节码层面的硬事实。

由此得出第一条铁律：**锁对象必须是共享的可达对象**。下面这种写法等于没锁：

```java
// ❌ 每次调用新建一把锁，各锁各的
public void doSync() {
    Object lock = new Object();
    synchronized (lock) { criticalSection(); }
}

// ✅ 锁对象由所有需要互斥的线程共享
private final Object lock = new Object();
public void doSync() {
    synchronized (lock) { criticalSection(); }
}
```

`new Object()` 是方法局部变量，落在各自的栈帧上，每个线程看到的都是自己的那把锁。

## 3. 同一个对象为什么能实现互斥？

先把三层分清，否则容易把"语义"和"某个具体实现"划等号：

```txt
Java 语言层        synchronized(lock)
                       ↓
JVM 规范层         获取 lock 对应的 Monitor
                       ↓
HotSpot 实现层     具体由 ObjectMonitor 等结构实现
```

Java 语言里 `synchronized(lock)` 锁的不是代码，是 `lock` 这个对象。JVM 规范层的说法是，每个对象都关联一个 Monitor，获取这个 Monitor 就等于拿到锁。互斥就来自一条简单规则：**一个对象绑定一个 Monitor，一个 Monitor 同一时间只能被一个线程持有**。所有竞争同一个对象的线程，争的是同一个 Monitor，谁持有谁进临界区，其余线程等在外面。

规范只规定 Monitor 必须满足这个语义，没规定怎么实现。HotSpot 里，这套语义由 ObjectMonitor 结构落地，关键字段是 `_owner`：

```txt
        ┌─────────────────────────────┐
        │        ObjectMonitor        │
        │                             │
持有者 → │  _owner:      Thread-A      │
重入计数 │  _recursions: 1             │
等锁队列 │  _EntryList:  [B, D, ...]   │  BLOCKED
等待队列 │  _WaitSet:    [C, E, ...]   │  WAITING
        └─────────────────────────────┘
```

一个线程想进临界区，本质是抢着把 `_owner` 写成自己。抢到了就持锁，抢不到就进 `_EntryList` 排队。

`_recursions` 是重入计数。同一线程再次进入同一把锁的临界区，`_recursions` 加一而不是重新抢锁，退出时减一，减到零才把 `_owner` 清空。这就是 `synchronized` 可重入的由来，也是死锁的天然解法之一，自己不会锁死自己。

这里只讲了 `_owner`。`_EntryList` 留给第 6 节，`_WaitSet` 留给第 7 节。

## 4. 为什么还能保证可见性和有序性？

互斥只保证"同一时刻只有一个线程在临界区"，不保证线程退出后别人能看到它写的东西。`synchronized` 额外提供的内存语义，靠 Monitor 的加解锁规则实现：

| 动作 | JMM 语义 | 结果 |
| :-- | :-- | :-- |
| 释放 Monitor | release | 临界区里的写入对下一个拿同一把锁的线程可见 |
| 获取 Monitor | acquire | 获取之后的读写不允许重排到获取之前 |

写成 happens-before 就是"同一把锁的解锁 happens-before 后续加锁"：

```txt
线程 A                        线程 B
synchronized (lock) {         synchronized (lock) {
    x = 42;                       读 ready → true
    ready = true;                 读 x     → 必定 42
}                             }
```

只要 B 拿到的是 A 刚释放的那把锁，A 在临界区里的全部写入 B 一定看得见。这是可见性。

有序性来自同一条规则的另一面。JVM 和处理器会重排指令，但 release 语义要求临界区内的写不能漏到解锁之后，acquire 语义要求临界区外的读不能提前到加锁之前。临界区内部的读写仍可能重排，但不会跨越加锁解锁这条边界，这给了并发代码一个可预期的执行窗口。

[第 5 章的 `volatile`](./chapter-05-volatile.md)是变量粒度的内存语义，`synchronized` 是代码块粒度的，两者不是竞品，是不同粒度的工具。

无论 JVM 底层采用哪一版锁实现，release/acquire 语义都必须成立，这是不同实现形态下保持同一并发语义的根基。

## 5. synchronized 在 JVM 中如何执行？

同步块和同步方法在字节码层面是两条不同的路，别混成一套。

同步代码块编译成 `monitorenter` / `monitorexit` 指令：

```txt
monitorenter            // 获取 Monitor
doSomething()
monitorexit             // 正常路径释放
monitorexit             // 异常路径释放
```

这里有两个 `monitorexit`。关键在于异常退出，如果临界区抛异常，JVM 走异常处理表，保证异常路径上的那个 `monitorexit` 也会被执行，锁照样释放。这正是 `synchronized` 和手写 `lock.lock()` / `unlock()` 的关键差异：临界区抛异常时锁也一定被释放，天然不会漏解锁。

要记住的不是"一定有两个 monitorexit"，而是"无论正常退出还是异常退出，释放 Monitor 的逻辑都会被走到"。

同步方法完全不同。它不在方法体里插 `monitorenter` / `monitorexit`，而是在方法的访问标志里加一个 `ACC_SYNCHRONIZED` 标记：

```txt
public synchronized void doSomething();
  flags: ACC_PUBLIC, ACC_SYNCHRONIZED
```

JVM 在方法调用和返回的机制里看到这个标记，就隐式地获取和释放 Monitor，不需要显式指令。同步方法的加解锁和"方法进出"绑在一起，而不是和某两条字节码绑在一起。

![sync-monitor-flow](/java/sync-monitor-flow.svg)

还有个重要事实：ObjectMonitor 是懒加载的。对象创建时不会为它预留 Monitor，因为绝大多数对象一辈子都不会被当锁用，预留是浪费。真正的创建发生在锁膨胀（inflate）到重量级实现的那一刻。绝大多数情况下，你写的 `synchronized` 根本没走到这一步。

## 6. 抢锁失败的线程去了哪里？

抢不到锁的线程最终会进 ObjectMonitor 的 `_EntryList`，处于 `BLOCKED` 状态，线程堆栈里常见 `waiting to lock <0x...>` 的字样。

但 JVM 不会让线程一抢锁失败就直接挂起，中间还有一段挣扎：

```txt
1. 线程 B 尝试获取锁
2. 成功 → 直接进入临界区，全程无系统调用
3. 失败 → 说明持有者还在临界区里，短暂自旋重试
4. 自旋若干次仍失败 → 说明临界区不短，真的该等了
5. 线程 park 进 _EntryList，状态变 BLOCKED
```

判断要不要走到第 5 步，靠的是"上一个线程在这个锁上自旋了多久"。上一轮很快拿到，这一轮就多自旋几下；上一轮白转，这一轮直接跳过自旋去排队。这就是自适应自旋。

这一节只回答"抢不到锁的线程会经历什么"，先自旋，自旋没用再阻塞进 `_EntryList`。至于每一步叫什么、对象头 Mark Word 怎么变，那是第 8 节锁优化的实现细节，这里不展开。

排查线上问题时，区分 `_EntryList` 和 `_WaitSet` 是第一步：`_EntryList` 里堆着线程，说明是真的锁竞争，往锁粒度和临界区长短方向查。

## 7. wait/notify 又是另一种什么等待？ {#wait-notify}

`_EntryList` 回答"抢不到锁怎么办"，`_WaitSet` 回答另一个问题：**已经抢到锁的线程，发现条件不满足，怎么办**。

答案是主动放弃锁，进 `_WaitSet` 挂起，等别人来通知。`wait()` / `notify()` 就是操作 `_WaitSet` 的 API：

```java
synchronized (queue) {
    while (queue.isEmpty()) {
        queue.wait();      // 释放锁，进 _WaitSet
    }
    Object item = queue.poll();
}

synchronized (queue) {
    queue.offer(item);
    queue.notify();        // 从 _WaitSet 拉一个出来
}
```

有三条硬性要求，每条背后都有明确原因：

**必须持有锁**。`wait()` 的语义是"释放我持有的这把锁并挂起"，没持有何谈释放。没持有就调用，直接 `IllegalMonitorStateException`。

**条件判断用 `while` 不用 `if`**。原因有两个：虚假唤醒，`wait()` 底层是 `pthread_cond_wait`，POSIX 明确允许无通知唤醒，这是规范不是 bug；竞争唤醒，`notifyAll` 唤醒了一堆线程，锁只有一把，其余线程醒来发现条件已被别人消耗，必须重新等。

**唤醒不等于运行**。被 `notify` 的线程不是立刻执行，而是从 `_WaitSet` 移到 `_EntryList`，重新抢锁：

```txt
_WaitSet 里            WAITING
   ↓ notify()
移到 _EntryList        BLOCKED
   ↓ 前一个持锁线程 monitorexit
拿到锁，wait() 返回    RUNNABLE
```

这也是 `wait()` 必须写在 `synchronized` 里的原因，醒来后要重新持锁才能继续。

`wait/notify` 的能力到这就见底了。一个 Monitor 只有一个 `_WaitSet`，没法把"队列非空"和"队列非满"的等待者分开，`notify` 挑哪个线程也是不确定的。这些限制正是 `Condition` + `ReentrantLock` 要解决的，一个 `Lock` 能挂多个 `Condition`，各自独立等待，详见 [LockSupport 与 AQS](./chapter-08-locksupport-aqs.md)。

## 8. JVM 为了让锁更快做了哪些优化？ {#synchronized-lock-optimization}

一共两层优化，一层在锁的实现里，一层在 JIT 里。

**锁实现层，靠锁升级。** 锁状态写在对象头的 Mark Word 里，8 个字节，不同状态下装不同内容：

| 状态 | lock 标志位（2 位） | Mark Word 主要内容 |
| :-- | :-- | :-- |
| 无锁 | `01`（biased_lock=0） | unused(25) \| hash(31) \| unused(1) \| age(4) \| biased_lock(1) \| `01` |
| 偏向锁 | `01`（biased_lock=1） | thread(54) \| epoch(2) \| unused(1) \| age(4) \| biased_lock(1) \| `01` |
| 轻量级锁 | `00` | 指向线程栈中 Lock Record 的指针(62) \| `00` |
| 重量级锁 | `10` | 指向 ObjectMonitor 的指针(62) \| `10` |
| GC 标记 | `11` | 与锁无关 |

升级路径只升不降：

```txt
无锁 ── 首次线程 CAS ──▶ 偏向锁 ── 出现竞争 ──▶ 轻量级锁 ── 自旋失败 ──▶ 重量级锁
```

三个状态各解决一个问题。偏向锁解决"同一线程反复获取"的零竞争开销，轻量级锁解决"多线程交替进入、几乎不阻塞"的低竞争开销，重量级锁解决"真的存在阻塞等待"的正确性。降级要在运行时反复判断值不值得回到轻量级，复杂且不划算，真出现竞争就说明这把锁确实该用重量级实现。

有一处版本差异要留意：**JDK 15 起偏向锁默认关闭**，JDK 18 标记废弃。原因不是它做错了，而是现代应用并发度偏高，单线程反复获取越来越罕见，撤销偏向锁还要 STW 到安全点，成了长尾延迟来源。所以 JDK 15+ 直接从轻量级锁起步，表格里的偏向锁状态在新 JVM 上是历史遗迹。

**JIT 层，靠三种变换。** 前两种针对"根本不该加的锁"：

```java
// 锁消除：局部变量不逃逸，JIT 直接把锁删掉
public String concat(String a, String b) {
    StringBuffer sb = new StringBuffer();   // 不逃逸
    sb.append(a);
    sb.append(b);
    return sb.toString();
}

// 锁粗化：循环里反复加解锁，合并成一次
synchronized (lock) {
    for (int i = 0; i < 100; i++) buffer.append(data[i]);
}
```

`StringBuffer.append` 内部有 `synchronized`，但 `sb` 不逃逸，JIT 用逃逸分析把锁整段消掉，机器码里根本没有加锁指令。锁粗化则把循环里相邻的同一把锁合并到循环外，加锁次数从 100 降到 1。

第三种是前文提过的自适应自旋，让 JVM 在低竞争和高竞争之间自动切换，省掉了固定自旋阈值调不准的麻烦。

这些优化叠起来，才有了 JDK 6 之后 `synchronized` 已经够快的结论。对绝大多数业务，一次 `synchronized` 停留在轻量级路径上，几十纳秒量级；真正要担心的是竞争激烈到每次进 Monitor 阻塞，而那是任何锁工具都躲不掉的场景。

## 9. 八个问题串起来看

```txt
为什么需要？            count++ 不原子
锁的是什么？            是对象，不是代码块
为什么能互斥？          Monitor 语义，ObjectMonitor 落地
为什么能可见？          Monitor 的 release/acquire
如何执行？              同步块 monitorenter，同步方法 ACC_SYNCHRONIZED
抢锁失败去哪？          自旋后进 _EntryList，BLOCKED
wait/notify 是什么？    _WaitSet，主动等条件
怎么更快？              锁升级 + JIT 三种变换
```

一条线是"锁的归属与抢占"，从对象到 Monitor 到 CAS，讲互斥。另一条线是"线程的等待状态"，`_EntryList` 的被动等锁和 `_WaitSet` 的主动等条件，讲协作。可见性和有序性横跨这两条线，由 Monitor 的 release/acquire 语义统一提供。
