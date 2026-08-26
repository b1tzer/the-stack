# synchronized：JVM 内置锁

> 一个 `synchronized` 关键字，锁住的到底是什么？为什么每个 Java 对象都能当锁？为什么 JDK 15 之后偏向锁被默认关闭，`synchronized` 仍然是"够用"的选择？

Java 里几乎所有并发工具都可以追溯到两条根：一条是 `synchronized` + Monitor，一条是 `LockSupport` + AQS。本章聚焦第一条。

`synchronized` 在语法上简单，在实现上覆盖了从字节码、对象头、CAS、自旋、内核态互斥、到 JIT 优化的完整栈。理解它，也就理解了 JVM 处理"临界区"的默认路径。

## 1. 从 `count++` 到 `synchronized`

### 1.1 单线程正确的代码，多线程为什么错

```java
public class Counter {
    private int count = 0;
    public void increment() { count++; }
    public int get() { return count; }
}
```

10 条线程各自跑 10 000 次 `increment()`，最终的 `count` 值几乎不会是 100 000。

原因是 `count++` 不是一步操作，而是三步：**读 count → 加 1 → 写回 count**。中间任何一步都可能被别的线程插入，导致更新丢失。第 4 章已经通过 JMM 解释过这类问题的根源——原子性缺失。

要修复这段代码，需要一段"任一时刻只有一个线程能执行"的临界区：

```java
public class Counter {
    private int count = 0;
    public synchronized void increment() { count++; }
    public synchronized int get() { return count; }
}
```

`synchronized` 一次性提供三样东西：

- **互斥**：同一时刻只有一个线程能进入临界区
- **可见性**：进入临界区能看到上一个持锁线程留下的所有写入
- **有序性**：临界区里的读写不会跨越加锁/解锁边界

三样能力打包出售，且成本已经被 JVM 优化到很低。这是 `synchronized` 在 Java 里长盛不衰的根本原因。

### 1.2 三种加锁位置

`synchronized` 有三种写法，对应三种不同的锁对象：

| 写法 | 锁对象 | 典型场景 |
| :-- | :-- | :-- |
| `synchronized` 修饰实例方法 | `this`（当前实例） | 保护实例可变状态 |
| `synchronized` 修饰静态方法 | 该方法所在类的 `Class` 对象 | 保护类级可变状态 |
| `synchronized (obj) { ... }` | 指定对象 | 细粒度控制，只锁真正需要保护的代码 |

优先选同步块。同步块能把临界区缩到最小，减少无关操作（日志、参数校验）持锁的时间；实例方法锁会让整段方法都持锁，粒度粗。

### 1.3 一个反复出现的错误

```java
// ❌ 每个线程各自的锁对象，没有互斥效果
public void doSync() {
    Object lock = new Object();
    synchronized (lock) {
        criticalSection();
    }
}

// ✅ 锁对象必须由所有需要互斥的线程共享
private final Object lock = new Object();

public void doSync() {
    synchronized (lock) {
        criticalSection();
    }
}
```

`Object lock = new Object()` 是方法局部变量，每次调用都新建一份，位于各自的调用栈帧上。多个线程看到的是不同的锁对象，等于没锁。加锁的第一条规则永远是：**锁对象是共享的可达对象**。

## 2. Monitor：`synchronized` 背后的执行体

### 2.1 从字节码开始看

先看一段最普通的同步块：

```java
public void syncBlock() {
    synchronized (obj) {
        doSomething();
    }
}
```

用 `javap -c` 反编译得到（简化）：

![sync-monitor-flow](/java/sync-monitor-flow.svg)

两点值得注意：

- 编译器一定会生成**两个** `monitorexit`：一个走正常路径，一个走异常处理路径。这是 `synchronized` 与手写 `lock.lock()/unlock()` 的核心差异，也是它天然不会漏解锁的原因。
- `monitorenter` / `monitorexit` 的操作数是栈顶的一个对象引用。锁不属于代码块，属于**对象**——这就是"每个 Java 对象都能当锁"的字节码依据。

### 2.2 Monitor 的三件套

`monitorenter` 真正操作的是对象关联的 **ObjectMonitor**（HotSpot 里的 C++ 结构）：

```text
             ┌──────────────────────────────┐
             │        ObjectMonitor          │
             │                              │
    持有者 →  │  _owner:      Thread-A       │
    重入计数  │  _recursions: 1              │
             │                              │
    等锁队列  │  _EntryList:  [B, D, ...]    │  BLOCKED
    等待队列  │  _WaitSet:    [C, E, ...]    │  WAITING
             └──────────────────────────────┘
```

三件套各司其职：

- **`_owner`**：当前持锁线程。首次加锁时 CAS 写入，重入时不动，解锁到 0 时清空。
- **`_EntryList`**：正在争锁的线程。它们线程状态是 `BLOCKED`，堆栈里常见 `waiting to lock <0x...>`。
- **`_WaitSet`**：调用了 `wait()` 主动挂起的线程。它们状态是 `WAITING` 或 `TIMED_WAITING`。

区分 `_EntryList` 与 `_WaitSet` 是排查线上锁竞争问题的关键——同一个锁的 dump 里能不能看到 `_WaitSet` 里堆着线程，直接决定要不要往 `wait/notify` 的方向查。

### 2.3 Monitor 是懒加载的

HotSpot 里 `ObjectMonitor` 不会在对象创建时就分配。原因很简单：**大多数对象永远不会被当作锁**，为每个对象都预留一份 Monitor 是浪费。

真正的分配时机是——锁状态从轻量级升级到重量级，且升级的那个瞬间。升级路径见 §6.4。

### 2.4 `synchronized` 的内存语义

Monitor 的两个动作，落实到 JMM 上：

| 动作 | JMM 语义 | 结果 |
| :-- | :-- | :-- |
| `monitorexit` | release | 临界区里的写入，对下一个获取同一把锁的线程可见 |
| `monitorenter` | acquire | 获取锁之后的读写，不允许被重排到加锁之前 |

写到规范里就是 JMM 的"**同一把锁的解锁 happens-before 后续加锁**"。示意：

```text
线程 A                            线程 B
─────────────────────            ───────────────────────
synchronized (lock) {             synchronized (lock) {
    x = 42;                           读 ready → true
    ready = true;                     读 x     → 必定为 42
}                                 }
```

只要 B 拿到的是 A 刚刚释放的那把锁，B 就一定看到 A 在临界区里做的全部写入。第 5 章讨论过 `volatile` 是"变量粒度"的内存语义，`synchronized` 则是"代码块粒度"的内存语义。二者不是竞品，是不同粒度的工具。

HotSpot 会根据竞争情况把实现分成偏向锁、轻量级锁、重量级锁等不同路径；但无论走哪条路径，release / acquire 语义都必须成立。这是 `synchronized` 在不同实现形态下仍然保持同一并发语义的基础。

## 3. `wait` / `notify`：Monitor 的等待协作

### 3.1 从 `_WaitSet` 讲起

`_EntryList` 解决"抢不到锁怎么办"。`_WaitSet` 解决另一个问题：**已经抢到锁的线程，发现条件还不满足，怎么办**。

`_WaitSet` 就是这些"等条件"的线程停靠的地方。`wait()` / `notify()` 是操作 `_WaitSet` 的 API：

```java
// 消费者：条件不满足则等待
synchronized (queue) {
    while (queue.isEmpty()) {
        queue.wait();          // 释放锁，进入 _WaitSet
    }
    Object item = queue.poll();
}

// 生产者：制造条件后唤醒
synchronized (queue) {
    queue.offer(item);
    queue.notify();            // 从 _WaitSet 拉一个线程出来
}
```

### 3.2 三条硬性要求

**要求 1：必须持有该对象的 Monitor**

```java
Object lock = new Object();
lock.wait();  // ❌ IllegalMonitorStateException
```

`wait()` 的语义是"释放我持有的这把锁并挂起"。没持有过，何谈释放。

**要求 2：条件判断用 `while`，不用 `if`**

```java
// ❌ 用 if：唤醒后不检查条件
synchronized (queue) {
    if (queue.isEmpty()) queue.wait();
    Object item = queue.poll();     // 可能空指针
}

// ✅ 用 while：唤醒后重新检查
synchronized (queue) {
    while (queue.isEmpty()) queue.wait();
    Object item = queue.poll();
}
```

两个原因：

- **虚假唤醒（spurious wakeup）**：`wait()` 底层依赖操作系统的等待原语（`pthread_cond_wait`），POSIX 明确允许无通知唤醒。这不是 bug，是规范。
- **竞争唤醒**：`notifyAll` 唤醒了 N 个线程，但锁只有一把，其余线程醒来发现条件已被别人消耗掉，必须重新等。

**要求 3：区分 `notify` 与 `notifyAll`**

| 场景 | 选择 | 原因 |
| :-- | :-- | :-- |
| 所有等待线程做同样的事 | `notify()` | 唤醒一个就够了，减少无效竞争 |
| 等待不同条件的线程 | `notifyAll()` | 只唤醒一个可能唤醒了错误的线程 |
| 不确定 | `notifyAll()` | 安全，多唤醒几个不会有正确性问题 |

### 3.3 唤醒不等于运行

被 `notify` 唤醒的线程，走的路径是：

```text
Thread-C 状态迁移
─────────────────
在 _WaitSet 中                     WAITING
  ↓ notify()
从 _WaitSet 移到 _EntryList         BLOCKED
  ↓ 前一个持锁线程 monitorexit
拿到锁，从 wait() 返回               RUNNABLE
```

关键：**从 `_WaitSet` 出来的线程不会立即执行**，它先进 `_EntryList`，还要重新抢锁。`wait()` 必须写在 `synchronized` 块里的原因正在于此——醒来后要重新持锁才能继续。

### 3.4 `wait/notify` 的能力边界

`wait/notify` 是 Monitor 的原语，能力也止步于此：

- 一个 Monitor 只有一个 `_WaitSet`，没法把"队列非空"和"队列非满"的等待者分开
- `notify()` 从 `_WaitSet` 里挑哪个线程是**不确定**的，做不到公平唤醒
- 没有"超时后自动放弃"的组合语义，只能 `wait(timeout)` 后手工判断

这些限制正是 `Condition` + `ReentrantLock` 要处理的（详见第 8 章）。一个 `Lock` 上可以挂多个 `Condition`，每个 `Condition` 各自的等待队列互不干扰——比如生产者-消费者可以清晰拆成 `notEmpty` 和 `notFull` 两条队列。

## 4. Mark Word 与锁升级

### 4.1 锁状态藏在对象头里

第二卷第 3 章讨论过 Java 对象的内存布局：**对象头**由 Mark Word 与类型指针组成。`synchronized` 的锁状态就写在 Mark Word 里，不需要额外分配空间。

64 位 HotSpot 上，Mark Word 是 8 字节。它在不同锁状态下承载不同内容：

| 状态 | 标志位 | Mark Word 主要内容 |
| :-- | :-- | :-- |
| 无锁 | `001` | `unused(25) \| hashCode(31) \| age(4) \| biased(0) \| 01` |
| 偏向锁 | `101` | `ThreadID(54) \| Epoch(2) \| age(4) \| biased(1) \| 01` |
| 轻量级锁 | `00` | `指向线程栈中锁记录的指针(62) \| 00` |
| 重量级锁 | `10` | `指向 ObjectMonitor 的指针(62) \| 10` |
| GC 标记 | `11` | 与锁无关 |

最低两位就能定位锁状态，这样 JVM 在每条锁路径上只需检查两个 bit——空间和时间开销都被压到极限。

### 4.2 升级路径：从最乐观到最悲观

`synchronized` 采用**只升不降**的策略：

```text
    无锁 ── 首次线程 CAS──▶ 偏向锁
                            │
                   出现竞争  │
                            ▼
                        轻量级锁 ──自旋失败──▶ 重量级锁
                                                 │
                                    OS Mutex + _EntryList 队列
```

三个升级点各自解决一个问题：

- **偏向锁**：解决"同一线程反复获取"零竞争场景的开销
- **轻量级锁**：解决"多线程交替进入、几乎不阻塞"低竞争场景的开销
- **重量级锁**：解决"真的存在阻塞等待"的正确性

**只升不降**的设计原因：降级要在运行时反复判断"当前是否值得回到轻量级"，逻辑复杂且不划算——真出现竞争就说明这把锁确实值得用重量级实现。偏向锁例外：JVM 会在安全点通过 `epoch` 递增做批量撤销。

### 4.3 偏向锁的细节：`epoch` 是干什么的

回到 Mark Word 表格，偏向锁里有 2 位 `Epoch`。它不是给对象用的，是给**类**用的：

- 每个类的元数据里维护一个类级 `epoch` 计数器
- 对象加偏向锁时，把当时的类 `epoch` 复制进对象头
- 需要"撤销这个类的所有偏向锁"时，JVM 把类的 `epoch` 递增
- 之后任何线程访问该类的偏向锁对象，一比对 `epoch` 就知道偏向已失效

这样一次 `epoch++` 就顶掉了逐对象遍历撤销的成本，是 JVM 内部很典型的"批量作废"设计。

### 4.4 轻量级锁：栈上锁记录 + CAS

线程 B 尝试获取一把已被线程 A 偏向的锁时，会走这样一条路：

```text
1. JVM 在安全点暂停 A，检查 A 是否还在临界区
2. 如果 A 已退出 → 撤销偏向，锁回到无锁
   如果 A 仍持有 → 就地升级为轻量级锁，A 继续跑
3. B 走轻量级锁路径：
   ┌────────────────────────┐
   │ B 的栈帧               │
   │   ├─ Lock Record       │  ← 新分配
   │   │    Displaced MW    │  ← 把原 Mark Word 复制进来
   └────────────────────────┘
4. B 用 CAS 把对象的 Mark Word 换成"指向 Lock Record 的指针"
   ├─ CAS 成功 → 获取轻量级锁
   └─ CAS 失败 → 说明 A 还在跑，自旋重试
```

轻量级锁的核心思想是：**用一次用户态 CAS 换一次内核态 mutex**。没有阻塞、没有系统调用，只在锁对象和线程栈之间玩指针。

### 4.5 升到重量级：真的要挂起了

轻量级锁自旋若干次仍拿不到，说明持锁线程的临界区并不短：

```text
1. 分配 ObjectMonitor
2. 对象 Mark Word 改写为"指向 ObjectMonitor 的指针"，标志位 10
3. 竞争线程 park 到 _EntryList，线程状态变成 BLOCKED
4. 持锁线程执行完临界区，走 monitorexit：
     - 发现 Mark Word 指向 Monitor（不再是栈里的 Lock Record）
     - 从 _EntryList 唤醒一个线程
5. 被唤醒线程重新 CAS 争锁
```

重量级锁的成本主要在两处：**分配 Monitor + 用户态到内核态的切换**。所以只要能停留在轻量级路径上，性能就足够好；真被顶到重量级，说明业务里确实存在竞争，需要考虑降低锁粒度或改用其它工具。

### 4.6 JDK 15 起偏向锁默认关闭

JEP 374 从 JDK 15 起把偏向锁默认关闭（`-XX:-UseBiasedLocking`），JDK 18 标记为废弃。原因不是偏向锁做错了，而是：

- 现代应用的并发度普遍偏高，"单线程反复获取"越来越罕见
- 撤销偏向锁需要 STW 到安全点，成为长尾延迟的来源
- HotSpot 里偏向锁相关代码占比高，维护成本超过它带来的收益
- ZGC / Shenandoah 等新 GC 与偏向锁配合复杂

一句话：**JDK 15+ 之后，直接从轻量级锁起步**。表格里的偏向锁状态在新版 JVM 上是历史遗迹，遇到旧文档提到偏向锁时，需要留意 JDK 版本。

## 5. JIT 帮 `synchronized` 做的事

写业务代码时，肉眼看到的每一次 `synchronized` 都会加锁——但真正跑起来时，JIT 会主动帮忙削掉一部分开销。

### 5.1 锁消除：不逃逸的锁根本不用加

```java
public String concat(String a, String b) {
    StringBuffer sb = new StringBuffer();   // 局部变量，不逃逸
    sb.append(a);
    sb.append(b);
    return sb.toString();
}
```

`StringBuffer.append` 内部有 `synchronized`。但 JIT 通过**逃逸分析**（第二卷第 5 章）发现 `sb` 不会被任何其它线程访问，就把这些锁**完整消除**——生成的机器码里根本没有加锁指令。

参数验证：

```bash
-XX:+DoEscapeAnalysis     # 逃逸分析（默认开）
-XX:+EliminateLocks       # 锁消除（默认开）
```

### 5.2 锁粗化：把小锁合成大锁

```java
// 写法上：循环里反复加/解锁
for (int i = 0; i < 100; i++) {
    synchronized (lock) {
        buffer.append(data[i]);
    }
}

// JIT 优化后：锁被粗化到循环外
synchronized (lock) {
    for (int i = 0; i < 100; i++) {
        buffer.append(data[i]);
    }
}
```

粗化后加锁次数从 100 降到 1。JIT 判断的条件是：**相邻的 `monitorenter/monitorexit` 作用在同一个锁对象上**。这条优化在处理"循环里操作同一个同步集合"时非常有效。

### 5.3 自适应自旋

轻量级锁走到自旋这一步时，自旋多少次不是固定的：

- 上一次在同一个锁上自旋很快拿到了锁 → 这次多自旋几次
- 上一次自旋很多次都没成功 → 这次直接跳过自旋，走升级路径

自适应自旋让 JVM 在"低竞争"和"高竞争"之间自动切换，减少了固定自旋阈值调不准的问题。

### 5.4 一个可以感知的性能剖面

以下数量级来自 JDK 17、典型 x86 服务器、低竞争场景，用作**相对量级**参考：

| 路径 | 单次操作量级 |
| :-- | :-- |
| 无同步（或锁被完全消除） | ~2 ns |
| 偏向锁命中（JDK 14 及以下） | ~3 ns |
| 轻量级锁（一次 CAS 成功） | ~15 ns |
| 重量级锁（无竞争，走过 Monitor） | ~30 ns |
| 重量级锁（有竞争，含上下文切换） | ~200 ns 起 |

对绝大多数业务，`synchronized` 都停留在前三行——这也是"JDK 6 之后 `synchronized` 已经不慢"结论的定量依据。真正需要担心的是"竞争激烈到每次都进 Monitor 阻塞"，而这是任何锁工具都躲不掉的场景。

## 6. `synchronized` 的三个常见误用

前面 §6.1.3 讲了"锁对象必须共享"这个入门级错误。实际线上还有三种误用出现得非常频繁。

### 6.1 锁字符串常量

```java
// ❌ 与 JVM 常量池里的其它使用者共享同一把锁
synchronized ("LOCK") {
    // ...
}
```

字符串字面量会被 JVM 放进字符串常量池；**同一 JVM 内任何写 `"LOCK"` 的代码，锁的都是同一个对象**。这意味着某个第三方库、某段陌生代码只要也写了 `synchronized ("LOCK")`，就会和你争同一把锁。排查时几乎无法定位。

正确做法：

```java
// ✅ 用私有对象作锁
private final Object lock = new Object();
```

### 6.2 锁 `Integer` / `Long` 装箱值

```java
// ❌ 一半时间"共享"，一半时间"独立"
private Integer counter = 0;

public void inc() {
    synchronized (counter) {
        counter++;   // 装箱后是新对象
    }
}
```

两处坑：

- `Integer` 在 `-128..127` 之间走缓存，多个线程拿到的可能是同一个对象；其它值不走缓存，各是各的对象
- `counter++` 是"拆箱-加一-装箱"，`counter` 变量在临界区里换成了新的对象——**锁着 A 对象，操作 B 对象**

任何**可能被别的代码写到、也可能被 JVM 缓存共享**的对象，都不适合当锁。规则很简单：**锁 `final` 修饰的私有对象**。

### 6.3 锁 `this` 泄漏

```java
// ❌ 把 this 当锁，但 this 引用被外部拿走了
public class Service {
    public synchronized void doWork() { /* ... */ }

    public Service register(Registry r) {
        r.add(this);       // this 引用外泄
        return this;
    }
}
```

外面拿到 `this` 的代码可以：

```java
Service s = new Service().register(reg);
synchronized (s) {
    // 和 doWork() 争同一把锁！
    Thread.sleep(Long.MAX_VALUE);
}
```

只要 `this` 引用外泄，任何拿到它的代码都能干扰你自己的临界区。生产上更常见的形式是**方法上加 `synchronized` + 对象被注入到多个位置**——被谁锁住了根本查不清。

治法：**永远不锁 `this`；实例方法要同步时，改用私有 `final` 锁对象**。

```java
// ✅
public class Service {
    private final Object lock = new Object();

    public void doWork() {
        synchronized (lock) { /* ... */ }
    }
}
```

## 7. 本章小结

| 问题 | 根源 | 解决方案 |
| :-- | :-- | :-- |
| 复合操作被打断 | 原子性缺失 | `synchronized` 建立临界区互斥 |
| 一个线程的写另一个线程看不见 | JMM 缓存/重排 | Monitor 的 release / acquire 语义 |
| 每个对象都要预留锁开销 | 大多数对象不当锁 | Monitor 懒加载，锁状态写在 Mark Word |
| 单线程反复获取锁的开销 | 传统 mutex 每次都走内核 | 轻量级锁 + CAS（JDK 15+ 之前还有偏向锁） |
| 局部对象加锁的浪费 | 锁对象不逃逸 | JIT 逃逸分析 → 锁消除 |
| 循环里频繁加解锁 | 相邻 monitor 操作同锁 | JIT 锁粗化 |
| 不确定锁对象是不是被共享 | 锁字符串、装箱值、`this` | 用 `private final Object` |

> **纵横联系**
>
> - **向前依赖**：§6.2.4 的内存语义建立在第 4 章 JMM 的 happens-before 与 acquire/release 之上；§6.4 的 Mark Word 状态编码依赖第二卷第 3 章对对象头的介绍；§6.5 的锁消除、锁粗化、逃逸分析在第二卷第 5 章 JIT 章节有完整展开。
> - **向后使用**：`synchronized` 的能力边界（不可中断、无超时、无公平性、单一等待队列）催生了 `Lock` / AQS，详见第 8 章；`Condition` 对 `wait/notify` 的扩展也在第 8 章。
> - **跨卷关系**：JVM 层锁优化的完整机制在第二卷；`ThreadPoolExecutor` 内部对短临界区的加锁思路（第 10 章）也建立在轻量级锁足够便宜的前提上。
