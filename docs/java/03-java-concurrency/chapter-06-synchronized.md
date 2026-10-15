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

10 条线程各跑 10 000 次 `increment()`，`count` 最终可能低于 100 000。因为 `count++` 不是一步，是读、加一、写回三步，中间任一步都可能被别的线程插进来，导致更新丢失。

`synchronized` 就是用来把这段代码变成临界区的：

```java
public class Counter {
    private int count = 0;
    public synchronized void increment() { count++; }
    public synchronized int get() { return count; }
}
```

它一次性给了三样东西：互斥，同一时刻只有一个线程进临界区；可见性，进入临界区能看到上一个持锁线程的全部写入；有序性，临界区里的读写不跨越加锁解锁边界。互斥、可见性和有序性由同步语义共同提供，实际成本取决于实现和竞争情况。

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

局部变量 `lock` 保存的是对象引用，`new Object()` 创建的对象通常在堆上分配。每次调用都执行 `new Object()`，就会创建不同的锁对象；即使这些对象都可达，各线程争抢的也不是同一个 Monitor。

## 3. 同一个对象为什么能实现互斥？

先把三层分清，否则容易把"语义"和"某个具体实现"划等号：

```txt
Java 语言层        synchronized(lock)
                       ↓
JVM 规范层         获取 lock 对应的 Monitor
                       ↓
HotSpot 实现层     具体由 ObjectMonitor 等结构实现
```

Java 语言里 `synchronized(lock)` 锁的不是代码，是 `lock` 这个对象。JVM 规范层的说法是，每个对象都关联一个 Monitor，获取这个 Monitor 就等于拿到锁。互斥就来自一条简单规则：**一个对象关联一个 Monitor，一个 Monitor 同一时间只能被一个线程持有**。所有竞争同一个对象的线程，争的是同一个 Monitor，谁持有谁进临界区，其余线程等在外面。这不意味着 HotSpot 在对象创建时就为每个对象分配一个独立的 ObjectMonitor 结构，Monitor 的具体关联和分配方式由实现决定。

规范只规定 Monitor 必须满足这个语义，没规定怎么实现。HotSpot 里，这套语义由 ObjectMonitor 结构落地，关键字段是 `_owner`：

```txt
        ┌─────────────────────────────┐
        │        ObjectMonitor        │
        │                             │
持有者 → │  _owner:      Thread-A      │
重入计数 │  _recursions: 0             │
等锁队列 │  _EntryList:  [B, D, ...]   │  BLOCKED
等待队列 │  _WaitSet:    [C, E, ...]   │  WAITING
        └─────────────────────────────┘
```

一个线程想进临界区，必须通过 Monitor 的进入协议完成所有权竞争，获取成功后才能进入临界区；竞争失败的线程则可能继续尝试、自旋或进入排队阻塞路径。

`_recursions` 记录持有者在首次进入之外的重入次数，首次获取锁时计数为 0。同一线程再次进入同一把锁的临界区，计数增加而不是重新抢锁；退出嵌套的同步范围时先递减计数，只有最外层同步范围退出，Monitor 才真正释放。这就是 `synchronized` 可重入的由来。可重入只能避免线程因再次获取自己已持有的同一把锁而自我阻塞，不能解决一般死锁。

这里只讲了 `_owner`。`_EntryList` 留给第 6 节，`_WaitSet` 留给第 7 节。以上字段和队列关系用于说明 HotSpot 中 Monitor 的典型实现，字段命名与组织方式随 JDK 版本变化（当前 OpenJDK 源码已用 `_entry_list`、`_wait_set` 等命名）；Java 规范只要求同步操作满足规定的互斥与内存语义。

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

有序性来自同一条规则的另一面。从内存语义看，release 约束临界区内的写入与解锁操作之间的可观察顺序，acquire 约束加锁操作与后续内存访问之间的可观察顺序。JVM 可以进行不影响这些语义的优化，但不能让程序表现出违反 happens-before 关系的结果。临界区内部的读写仍可能重排，但不会在可观察结果上跨越加锁解锁这条边界，这给了并发代码一个可预期的执行窗口。

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

![同步块通过 monitorenter 和 monitorexit 获取并释放 Monitor 的流程](/java/sync-monitor-flow.svg)

HotSpot 的一种实现策略是让 `ObjectMonitor` 懒加载：对象创建时不预留 Monitor，真正进入重量级路径时才可能膨胀（inflate）。这不是 Java 语言规范保证，其他 JVM 可以采用不同布局。

## 6. 抢锁失败的线程去了哪里？

抢锁失败的线程可能进入 Monitor 的排队与阻塞路径，处于 `BLOCKED` 状态，线程堆栈里常见 `waiting to lock <0x...>` 的字样。

HotSpot 在部分锁模式下会让抢锁失败的线程先自适应自旋，再进入阻塞等待。下图描述这一常见实现路径，不是所有 JVM 的固定步骤：

```txt
1. 线程 B 尝试获取锁
2. 成功 → 进入临界区，无需因本次获取锁而阻塞等待
3. 失败 → 说明当前无法获取 Monitor，短暂自旋重试
4. 自旋后仍无法获取 → 继续占用 CPU 不划算，转入排队与阻塞
5. 线程 park 进入阻塞，状态变 BLOCKED
```

自旋是否值得继续，取决于竞争状态以及之前自旋的效果等信息。若预计短时间内仍无法获取锁，继续占用 CPU 就不划算，线程可能转入排队和阻塞路径。这种依赖具体 HotSpot 实现的启发式优化，不是 `synchronized` 在所有 JVM 上都必须执行的固定步骤，也不存在一个适用于所有场景的固定自旋次数。

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

有三个关键点，每条背后都有明确原因：

**必须持有锁**。`wait()` 的语义是“释放我持有的这把锁并挂起”，没持有就调用会抛出 `IllegalMonitorStateException`。

**条件判断用 `while` 不用 `if`**。`wait()` 可能因中断、超时或实现层面的虚假唤醒返回，也可能在 `notify` 后重新抢锁时发现条件已经被其他线程消耗。无论底层是否采用 `pthread_cond_wait`，Java 代码都应循环重新检查条件。

**唤醒不等于运行**。`notify()` 只通知一个等待者，不会立即释放当前线程持有的 Monitor；通知线程退出同步范围或以其他方式释放锁后，被通知线程才有机会重新竞争该锁。在经典 HotSpot 实现的示意模型中，被通知的线程会离开等待集合，转入后续的 Monitor 竞争路径：

```txt
_WaitSet 里            WAITING
   ↓ notify()
离开等待集合，参与竞争  BLOCKED
   ↓ 前一个持锁线程 monitorexit
重新获取锁后，wait() 返回并继续执行
```

这也是 `wait()` 必须写在 `synchronized` 里的原因，醒来后要重新持锁才能继续。具体使用哪些内部队列属于 HotSpot 实现细节。

`wait/notify` 适合基本的条件等待，但不支持多个独立的等待条件。一个 Monitor 只有一个 `_WaitSet`，没法把"队列非空"和"队列非满"的等待者分开，`notify` 挑哪个线程也是不确定的。这些限制正是 `Condition` + `ReentrantLock` 要解决的，一个 `Lock` 能挂多个 `Condition`，各自独立等待，详见 [LockSupport 与 AQS](./chapter-08-locksupport-aqs.md)。

## 8. JVM 为了让锁更快做了哪些优化？ {#synchronized-lock-optimization}

一共两层优化，一层在锁的实现里，一层在 JIT 里。

**HotSpot 锁实现层，靠锁升级。** 下表以常见的 HotSpot 64 位对象布局为例；具体位宽、是否压缩指针以及偏向锁配置会改变 Mark Word 内容，不能当作 JVM 规范：

| 状态 | lock 标志位（2 位） | Mark Word 主要内容 |
| :-- | :-- | :-- |
| 无锁 | `01`（biased_lock=0） | unused(25) \| hash(31) \| unused(1) \| age(4) \| biased_lock(1) \| `01` |
| 偏向锁 | `01`（biased_lock=1） | thread(54) \| epoch(2) \| unused(1) \| age(4) \| biased_lock(1) \| `01` |
| 轻量级锁 | `00` | 指向线程栈中 Lock Record 的指针(62) \| `00` |
| 重量级锁 | `10` | 指向 ObjectMonitor 的指针(62) \| `10` |
| GC 标记 | `11` | 与锁无关 |

经典 HotSpot 锁优化模型如下。这是帮助理解锁优化的概念模型，不是每次获取锁都会经过的固定状态机；本文以 JDK 21 默认 HotSpot 行为为主，偏向锁作为旧版实现单独介绍：

```txt
无锁状态
   ├─ 轻量级锁路径（JDK 21 默认）
   │      └─ 竞争加剧时可能膨胀为重量级 Monitor
   └─ 旧版本中的偏向锁路径
          └─ 撤销/竞争处理后转入其他锁状态
```

三个状态分别针对同一线程反复获取、低竞争交替访问和真实阻塞等待。HotSpot 的常见实现主要沿升级路径前进，不承诺每种锁模式都执行完全相同的降级策略。

有一处版本差异要留意：偏向锁的版本变化需要区分两个时间点。**JDK 15 起 HotSpot 默认关闭偏向锁，并弃用相关参数**；JDK 18 又将这些参数标记为 obsolete。因而在 JDK 21 的默认配置下，偏向锁不再是常规锁获取路径的一环，表格里的偏向锁状态是理解旧版 HotSpot 锁优化的历史内容。偏向锁性能收益在现代平台上已不如早期明显，而撤销机制与实现复杂度仍有成本。

**JIT 层，靠两类编译变换。** 这两类针对"根本不该加的锁"：

```java
// 锁消除：局部变量不逃逸，JIT 可能把锁删掉
public String concat(String a, String b) {
    StringBuffer sb = new StringBuffer();   // 不逃逸
    sb.append(a);
    sb.append(b);
    return sb.toString();
}

// 锁粗化：优化前，循环里反复获取和释放同一把锁
for (int i = 0; i < 100; i++) {
    synchronized (lock) {
        buffer.append(data[i]);
    }
}

// 锁粗化：优化后的概念形式，锁范围合并到循环外
synchronized (lock) {
    for (int i = 0; i < 100; i++) buffer.append(data[i]);
}
```

`StringBuffer.append` 内部有 `synchronized`，如果 JIT 能证明 `sb` 不会逃逸且优化条件成立，就可能用逃逸分析把锁整段消掉，机器码里没有加锁指令。锁粗化则把循环里相邻的同一把锁合并到循环外，加锁次数从 100 降到 1。第二段是概念示意，不保证实际 JIT 一定生成完全相同的形态，锁粗化是否可行还取决于控制流和异常语义。

自适应自旋是运行时锁竞争策略，不属于编译器优化，已在第 6 节单独说明。

这些优化让 `synchronized` 在许多无竞争或低竞争场景中开销明显下降，但单次成本依 JIT、锁状态、CPU 和争用情况而变，不能用固定纳秒值代替实测。竞争激烈并进入阻塞路径时，应先缩小临界区或降低争用，再比较锁工具。

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
