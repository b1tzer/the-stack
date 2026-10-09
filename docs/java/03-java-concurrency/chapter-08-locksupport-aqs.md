# `LockSupport` 与 AQS：并发工具的骨架

> `ReentrantLock`、`Semaphore`、`CountDownLatch`——三种表面不同的工具，为什么源码都藏在同一个基类里？`CyclicBarrier` 为什么不继承它？

第 6 章的 `synchronized` 把互斥锁封装在 JVM 内部。开发者只有一个开关：`synchronized`/不 `synchronized`。这一章讨论的是另一条路：**把锁的实现搬到 Java 代码层面**，让"如何挂起线程"、"如何组织等待队列"、"如何唤醒"这些机制变得可编程。这条路的起点是 `LockSupport`，终点是 AQS。走完这一章，回头再看 `java.util.concurrent.locks` 和 `java.util.concurrent` 包里绝大多数工具，会发现它们其实只有一个骨架。

## 1. `synchronized` 走不到的地方

### 1.1 五个 `synchronized` 做不到的诉求

`synchronized` 的语义是"要么拿到锁进入临界区，要么阻塞等"。真到线上，业务几乎每天都在提出更细的要求：

| 需求 | `synchronized` 的答案 |
| :-- | :-- |
| "我最多等 3 秒，拿不到就走" | 做不到 |
| "我等锁的时候允许被 `interrupt` 打断" | 做不到 |
| "同一把锁，读线程之间不要互斥" | 做不到 |
| "等的时间越久越优先，别让新来的插队" | 做不到 |
| "生产者等'非满'、消费者等'非空'，两条队列别搅在一起" | 做不到（一个 Monitor 只有一条等待队列） |

不是 `synchronized` 设计得差，而是它把选择权全部下放到了 JVM 内部——JVM 只做互斥这一种语义。任何超出互斥的诉求，都需要一套 Java 层可编程的锁基础设施。

### 1.2 把锁搬到 Java 层，需要什么

如果不再依赖 `monitorenter`/`monitorexit`，一把互斥锁至少要自己回答三个问题：

- **状态用什么表达**：几把锁、有没有人持锁、重入了几次
- **争锁失败的线程放到哪里**：等待队列的数据结构、入队方式
- **挂起和唤醒怎么实现**：谁把线程挂起、谁把它叫醒

第一个问题的答案是：**一个 `volatile int` + CAS**。第二个问题的答案是：**一条 FIFO 双向链表**。第三个问题的答案是：**`LockSupport.park` / `unpark`**。

这三样加在一起就是 AQS 的骨架。但要理解 AQS 的挂起/唤醒是怎么发生的，得先看第三样——`LockSupport`。

## 2. `LockSupport`：许可证式挂起

### 2.1 `park` / `unpark` 的语义

`java.util.concurrent.locks.LockSupport` 只有两个核心静态方法：

```java
LockSupport.park();                 // 挂起当前线程
LockSupport.park(Object blocker);   // 同上，附带阻塞原因，dump 时能看到

LockSupport.unpark(Thread t);       // 唤醒指定线程
```

它对每条线程维护一张**许可证（permit）**：

- `unpark(t)` 把 t 的许可证置为"可用"
- `park()` 检查当前线程的许可证：可用则消耗掉后立即返回，不可用则挂起，直到有人调用 `unpark`

许可证是一个二值状态——不是计数器。连续两次 `unpark` 只会保留一张许可证，第二张被忽略。

### 2.2 三点关键差异

`LockSupport` 与 `Object.wait/notify` 表面上都能挂起线程，但用途完全不同：

| 维度 | `wait` / `notify` | `park` / `unpark` |
| :-- | :-- | :-- |
| 是否需要持锁 | 必须持有对象的 Monitor，否则 `IllegalMonitorStateException` | 不需要 |
| 唤醒目标 | 从 `_WaitSet` 里挑一个（`notify` 不确定，`notifyAll` 全部） | 精确指定某条线程 |
| `unpark` / `notify` 早于挂起 | 无效，`notify` 时如果没人在 wait，什么都不发生 | 有效，许可证保留，后续 `park` 立即返回 |
| 中断行为 | 抛 `InterruptedException` | `park` 直接返回，需自行检查 `Thread.interrupted()` |

**"唤醒可以先于挂起"** 是许可证语义带来的关键性质。用 `wait/notify` 实现一个"线程 A 通知 B"的原语，要小心 A 的 `notify` 早于 B 的 `wait` 的时序——一旦跑到前面，B 就会永远睡下去。`park/unpark` 不存在这个时序坑。

### 2.3 一个可以自己写的简易锁

用 `park`/`unpark` 就能拼一把最简的互斥锁：

```java
public class SimpleLock {
    private final AtomicBoolean locked = new AtomicBoolean(false);
    private final Queue<Thread> waiters = new ConcurrentLinkedQueue<>();

    public void lock() {
        Thread current = Thread.currentThread();
        while (!locked.compareAndSet(false, true)) {
            waiters.offer(current);
            // 二次检查：可能就在这一瞬间锁被释放了
            if (locked.get()) {
                LockSupport.park(this);
            }
            waiters.remove(current);
        }
    }

    public void unlock() {
        locked.set(false);
        Thread next = waiters.peek();
        if (next != null) LockSupport.unpark(next);
    }
}
```

这段代码正确性不够强（缺失公平性、可能丢唤醒、无重入），但它揭示了一个事实：**"CAS 抢状态 + 队列排队 + `park/unpark` 挂起唤醒"就是一把锁的最小工作集**。AQS 做的事，本质上就是把这套模式提炼成一个可扩展的框架。

### 2.4 底层实现的一句话交代

`LockSupport.park` 最终委托到 JVM 的线程挂起实现；具体系统调用会随 JDK 版本和操作系统变化，不能笼统地归结为某一个 POSIX 函数。挂起线程在 Java 层通常表现为 `WAITING`，在操作系统层面进入等待状态，不持续消耗 CPU。这也是 AQS 得以在**未拿到锁的线程上不空转**的技术底座。

## 3. AQS 的三件套

### 3.1 一个 `state` + 一个 CLH 队列 + 一套 Node 状态

`AbstractQueuedSynchronizer`（AQS）的内部结构：

```txt
     ┌──────────────────────────────────────────────┐
     │        AbstractQueuedSynchronizer            │
     │                                              │
     │   volatile int state          ← 同步状态       │
     │                                              │
     │   Node head ─→ Node ─→ Node ─→ Node ← tail   │
     │        │        │       │       │            │
     │        │      thread=B thread=C thread=D     │
     │        │     ws=SIGNAL ws=SIGNAL   ws=0      │
     │      (虚节点)                                 │
     └──────────────────────────────────────────────┘
```

- **`state`**：`volatile int`。语义由子类决定——`ReentrantLock` 里它是"重入次数"，`Semaphore` 里它是"剩余许可数"，`CountDownLatch` 里它是"未完成计数"。修改通过 `compareAndSetState` 保证原子性。
- **CLH 队列**：一条 FIFO 双向链表，节点类型是 `Node`。抢锁失败的线程被封装成 Node 挂到队尾。队头是一个"虚节点"（sentinel），当前持锁线程本身不在队列中——head 是"下一个要被唤醒的候选人的前驱"。
- **Node 的 `waitStatus`**：一个 `int` 字段，编码了节点的四种状态。

### 3.2 Node 的四种状态

| 常量 | 值 | 含义 |
| :-- | :-- | :-- |
| `SIGNAL` | -1 | 当前节点释放锁时**必须**唤醒后继 |
| `CANCELLED` | 1 | 线程被中断/超时放弃排队，节点作废 |
| `CONDITION` | -2 | 节点当前挂在某个 `Condition` 的条件队列里 |
| `PROPAGATE` | -3 | 共享模式下用于把"释放"事件继续向后传播 |
| 0 | 0 | 初始状态 / 已消费掉 SIGNAL |

一条完整的排队线程通常经历：`0 → SIGNAL → 被唤醒后消费掉 → 0`。理解这四个状态，AQS 里让人头晕的 CAS 就有了坐标。

### 3.3 模板方法模式：分离"如何获取"与"失败后怎么办"

AQS 用模板方法把工作切成两半：

**AQS 已经写好的（不变部分）**：

- CLH 队列的入队 / 出队 / 前驱状态维护
- `LockSupport.park` / `unpark` 挂起唤醒
- 中断响应
- 超时控制
- 公平/非公平策略骨架

**子类需要实现的（变化部分）**：

| 方法 | 语义 | 何时实现 |
| :-- | :-- | :-- |
| `tryAcquire(int)` | 独占模式：尝试获取，成功 true 失败 false | `ReentrantLock` 等独占锁 |
| `tryRelease(int)` | 独占模式：尝试释放，state 归零返回 true | 独占锁 |
| `tryAcquireShared(int)` | 共享模式：返回剩余许可，负数表示失败 | `Semaphore` / `CountDownLatch` |
| `tryReleaseShared(int)` | 共享模式：释放并返回是否需要传播 | 共享同步器 |
| `isHeldExclusively()` | 当前线程是否独占持有 | 支持 `Condition` 时需实现 |

子类不需要碰队列、park、中断处理——那些 AQS 已经解决过一次，之后所有子类共用。这就是"用一个 state + 一个队列统一万物"能成立的原因：只要业务逻辑能编码进 `state`，AQS 就能把它跑成一个正确的同步器。

```mermaid
classDiagram
    class AbstractQueuedSynchronizer {
        <<abstract>>
        -volatile int state
        -Node head
        -Node tail
        +acquire(int)$ 模板方法
        +release(int)$ 模板方法
        +acquireShared(int)$ 模板方法
        +releaseShared(int)$ 模板方法
        #tryAcquire(int)* 抽象步骤
        #tryRelease(int)* 抽象步骤
        #tryAcquireShared(int)* 抽象步骤
        #tryReleaseShared(int)* 抽象步骤
    }

    class ReentrantLock_Sync {
        state = 重入次数
        tryAcquire: CAS(0,1) 或重入 +1
        tryRelease: --state, 归零则 free
    }

    class Semaphore_Sync {
        state = 剩余许可
        tryAcquireShared: state - n
        tryReleaseShared: state + n
    }

    class CountDownLatch_Sync {
        state = 未完成计数
        tryAcquireShared: state==0 ? 1 : -1
        tryReleaseShared: --state == 0
    }

    AbstractQueuedSynchronizer <|-- ReentrantLock_Sync
    AbstractQueuedSynchronizer <|-- Semaphore_Sync
    AbstractQueuedSynchronizer <|-- CountDownLatch_Sync
```

## 4. 独占模式与共享模式

AQS 从入口就分成两条路径：`acquire` / `release` 走独占，`acquireShared` / `releaseShared` 走共享。骨架相同，唤醒策略不同。

### 4.1 独占模式：先尝试，再入队，再挂起

`ReentrantLock` 是独占模式的典型。`acquire` 的骨架：

```java
public final void acquire(int arg) {
    if (!tryAcquire(arg) &&
        acquireQueued(addWaiter(Node.EXCLUSIVE), arg))
        selfInterrupt();
}
```

三步走：

**第一步 `tryAcquire`（子类实现）**：非公平模式直接 CAS 抢，公平模式先看队列有没有前驱。

```java
// NonfairSync 非公平模式
final boolean nonfairTryAcquire(int acquires) {
    Thread current = Thread.currentThread();
    int c = getState();
    if (c == 0) {
        if (compareAndSetState(0, acquires)) {
            setExclusiveOwnerThread(current);
            return true;
        }
    } else if (current == getExclusiveOwnerThread()) {   // 重入
        setState(c + acquires);
        return true;
    }
    return false;
}
```

```java
// FairSync 公平模式：多一行前驱检查
if (c == 0) {
    if (!hasQueuedPredecessors() && compareAndSetState(0, acquires)) {
        setExclusiveOwnerThread(current);
        return true;
    }
}
```

**第二步 `addWaiter`（入队）**：把当前线程包成 Node 挂到队尾。快速路径是"tail 非空 + 一次 CAS"，慢路径 `enq` 用自旋 CAS 处理"队列尚未初始化"的边界。

**第三步 `acquireQueued`（自旋 + 挂起）**：

```java
for (;;) {
    Node p = node.predecessor();
    if (p == head && tryAcquire(arg)) {   // 前驱是 head，再试一次
        setHead(node);
        p.next = null;                     // help GC
        return interrupted;
    }
    if (shouldParkAfterFailedAcquire(p, node))
        interrupted |= parkAndCheckInterrupt();
}
```

`shouldParkAfterFailedAcquire` 做的事是——**把前驱节点的 `waitStatus` 置为 `SIGNAL`**。这一步的语义是"我要睡了，你解锁时记得叫我"。这个契约让后续的释放变得极简。

`parkAndCheckInterrupt` 内部就是 §8.2 讲的 `LockSupport.park(this)`。线程从此挂起，直到前驱调用 `unpark`。

把这三步串起来，完整的 `acquire` 流程如下：

```mermaid
flowchart TD
    A["acquire(arg)"] --> B["tryAcquire(arg)\n子类实现，CAS 修改 state"]
    B -->|成功| C["返回，获取锁成功"]
    B -->|失败| D["addWaiter(EXCLUSIVE)\n创建 Node 加入 CLH 队列尾部"]
    D --> E{"前驱节点是 head？"}
    E -->|是| F["再次 tryAcquire(arg)"]
    F -->|成功| G["setHead(node)\n释放旧 head，返回"]
    F -->|失败| H["shouldParkAfterFailedAcquire\n将前驱 waitStatus 设为 SIGNAL"]
    E -->|否| H
    H --> I["parkAndCheckInterrupt()\nLockSupport.park 挂起"]
    I -->|被前驱 unpark 唤醒| E
    G --> J["结束"]
```

整个过程中，`shouldParkAfterFailedAcquire` 可能需要多次自旋：如果前驱节点是 `CANCELLED` 状态（线程超时或被中断放弃），就跳过它往前找一个有效的前驱，再把那个前驱的 `waitStatus` 设为 `SIGNAL`。这个清理过程保证了队列中 `CANCELLED` 节点不会阻塞后续节点的唤醒链。

### 4.2 独占模式的 `release`：只干两件事

```java
public final boolean release(int arg) {
    if (tryRelease(arg)) {                 // state 归零？
        Node h = head;
        if (h != null && h.waitStatus != 0)
            unparkSuccessor(h);            // 唤醒后继
        return true;
    }
    return false;
}
```

`tryRelease` 由子类决定"归零"的条件。`ReentrantLock` 里必须减到 0 才算真释放——重入了三次要 `unlock` 三次。归零后，`unparkSuccessor` 找到队列里第一个未取消的节点，`LockSupport.unpark`。被唤醒的线程从 `acquireQueued` 的 `park` 处返回，回到自旋，再次 `tryAcquire`。

```mermaid
flowchart TD
    A["release(arg)"] --> B["tryRelease(arg)\n子类实现，修改 state"]
    B -->|state 归零| C["锁完全释放"]
    C --> D{"head != null 且\nwaitStatus != 0？"}
    D -->|是| E["unparkSuccessor(head)\n从 tail 往回找有效后继"]
    D -->|否| F["无需唤醒"]
    E --> G["LockSupport.unpark(后继线程)\n后继从 parkAndCheckInterrupt 返回"]
    G --> H["后继再次 tryAcquire\n回到 acquireQueued 自旋"]
    B -->|state 仍 > 0| I["锁仍被持有（重入未完全释放）\n不唤醒任何人"]
```

`unparkSuccessor` 里藏着一个反直觉的细节：找后继时**从 tail 往回遍历**。原因是入队的顺序是"先设 prev，再 CAS tail，最后设 prev.next"——`next` 指针可能是过时的，`prev` 链才是可靠的。

### 4.3 共享模式：唤醒之后还要接力

`Semaphore.acquire(1)` / `CountDownLatch.await` 走共享路径：

```java
public final void acquireShared(int arg) {
    if (tryAcquireShared(arg) < 0)
        doAcquireShared(arg);
}
```

`tryAcquireShared` 返回值语义与独占版不同：**负数=失败，非负数=成功且剩余资源=返回值**。剩余资源大于 0 时，被唤醒的线程要**继续把这个"仍有资源"的信号传给后继**。

举一个 `CountDownLatch` 的场景：

```txt
CountDownLatch(3)：三条线程 A / B / C 都在 await
队列： head → NodeA → NodeB → NodeC ← tail

外部调用 countDown 三次，state = 0。
最后一次 countDown 唤醒 NodeA。
```

如果只唤醒 A，B 和 C 就永远睡下去了。共享模式必须让 A 醒来后**继续 unpark B**、B 醒来后**继续 unpark C**——这就是传播（propagation）。

实现集中在 `doReleaseShared`：

```java
private void doReleaseShared() {
    for (;;) {
        Node h = head;
        if (h != null && h != tail) {
            int ws = h.waitStatus;
            if (ws == Node.SIGNAL) {
                if (!compareAndSetWaitStatus(h, Node.SIGNAL, 0))
                    continue;
                unparkSuccessor(h);
            } else if (ws == 0 &&
                       !compareAndSetWaitStatus(h, 0, Node.PROPAGATE))
                continue;
        }
        if (h == head) break;    // head 没变，链条走完
    }
}
```

`PROPAGATE` 状态的用途就在这里：即便当前节点已经把 `SIGNAL` 消费掉，只要 `state` 里还有资源，链条上的下一个节点也应当被叫醒。

### 4.4 独占 vs 共享的核心差异

| 维度 | 独占模式 | 共享模式 |
| :-- | :-- | :-- |
| 同一时刻持有者 | 1 | 多个 |
| `state` 语义 | 是否被占 / 重入计数 | 剩余许可 / 未完成计数 |
| 获取失败判据 | `tryAcquire` 返回 false | `tryAcquireShared` 返回负数 |
| 释放后唤醒 | 只唤醒队首后继 | 唤醒后继并沿链传播 |
| 典型工具 | `ReentrantLock` / `ReadWriteLock` 写锁部分 | `Semaphore` / `CountDownLatch` / 读锁部分 |

## 5. 本页小结

| 问题 | 根源 | 解决方案 |
| :-- | :-- | :-- |
| 需要超时、中断或公平获取 | `synchronized` 把选择权留在 JVM 内部 | `LockSupport` 将挂起与唤醒暴露给 Java 层 |
| 唤醒可能早于挂起造成丢失 | `notify` 没有许可证语义 | `LockSupport.unpark` 保留许可证 |
| 每种同步器都要重复实现等待队列 | 队列与业务语义耦合 | AQS 抽出 `state + CLH + park/unpark` 骨架 |
| 独占与共享的唤醒规则不同 | 单持有者与多持有者的传播方式不同 | 共享模式通过 `PROPAGATE` 继续传播 |

下一页从 `Condition` 的条件队列开始，再集中比较基于 AQS 的常用同步工具。

> **下一页：** [Condition 与同步工具](./chapter-09-condition-lock-tools.md)
