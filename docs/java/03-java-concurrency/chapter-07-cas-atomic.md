# CAS 与原子类：无锁并发思想

> 锁是并发编程的"重武器"——可靠，但代价高昂。有没有一种方式，能在不阻塞线程的情况下完成共享变量的安全更新？答案是 CPU 级别的原子指令，而 JDK 将其封装为 CAS 和 Atomic 系列类。本章将从 CAS 的底层原理讲起，逐步揭示无锁并发的实现机制、适用场景和固有局限。

## 1. 为什么需要无锁技术

`synchronized` 与 `ReentrantLock` 走的是悲观路线：假设冲突一定会发生，先拿锁再操作、操作完再释放。安全，但代价明确。

### 1.1 锁的三大痛点

| 问题 | 描述 | 影响 |
| :-- | :-- | :-- |
| **阻塞开销** | 线程被挂起和唤醒涉及用户态/内核态切换，代价高昂 | 高并发场景下吞吐量下降 |
| **死锁风险** | 多把锁交叉持有形成循环等待 | 程序完全卡死，难以排查 |
| **优先级反转** | 低优先级线程持锁，高优先级线程被迫等待 | 实时性要求高的系统中表现恶劣 |

对于一个简单的计数器场景，第 1 章已经展示过 `count++` 的数据竞争问题，第 6 章用 `synchronized` 解决了它。但 `count++` 对应的 CPU 指令其实只有三步：

```txt
LOAD count → 寄存器
ADD 1 → 寄存器
STORE 寄存器 → count
```

三步之间如果有其他线程插入，就会出错。锁的方案是把这三步"包裹"起来串行执行。但如果我们能用**一条 CPU 指令**完成"读-改-写"的原子操作呢？

这就是无锁并发的出发点：**利用硬件提供的原子指令，避免线程阻塞，提升吞吐量**。

## 2. CAS 原理

### 2.1 Compare And Swap：硬件级的乐观锁

CAS（Compare And Swap）是一条 CPU 原子指令，其语义可以用伪代码描述：

```java
// CAS 伪代码
boolean cas(内存地址 V, 期望值 A, 新值 B) {
    if (V 当前的值 == A) {
        V = B;       // 更新成功
        return true;
    } else {
        return false; // 更新失败，说明其他线程已经修改了 V
    }
}
```

关键点：**"比较"和"交换"是一条不可分割的 CPU 指令**，不存在中间状态。

### 2.2 用 CAS 实现无锁计数器

```java
public class CasCounter {
    private volatile int count = 0;

    public void increment() {
        int oldVal;
        do {
            oldVal = count;                        // 1. 读取当前值
        } while (!compareAndSwap(oldVal, oldVal + 1)); // 2. CAS 重试
    }

    // 模拟 CAS 操作（实际由 Unsafe/VarHandle 提供）
    private boolean compareAndSwap(int expected, int newVal) {
        if (count == expected) {   // 比较
            count = newVal;        // 交换
            return true;
        }
        return false;
    }
}
```

流程图如下：

```txt
Thread A                          Thread B
   |                                 |
   ├── 读取 count = 0                ├── 读取 count = 0
   |                                 |
   ├── CAS(0, 1) ✓ 成功             ├── CAS(0, 1) ✗ 失败
   |   count = 1                     |   （count 已变为 1，不是期望的 0）
   |                                 |
   |                                 ├── 重新读取 count = 1
   |                                 ├── CAS(1, 2) ✓ 成功
   |                                 |   count = 2
```

这就是**自旋（spin）**：失败了不阻塞，重新读取再试。当竞争不激烈时，这种方式比锁的效率高得多。

## 3. CAS 的底层支持

CAS 并非 Java 发明的概念，它是从硬件到 JDK 层层封装的结果。

### 3.1 CPU 层面：cmpxchg 指令

在 x86 架构上，CAS 对应的是 `cmpxchg` 指令。单核 CPU 上这条指令天然原子，但在多核环境下，需要加 `lock` 前缀来保证总线锁或缓存一致性：

```asm
; x86 汇编伪代码
lock cmpxchg [mem], new_val
; lock 前缀：锁定缓存行或总线，确保整个操作的原子性
```

`lock` 前缀的实际机制取决于 CPU 型号和缓存状态：

- 早期处理器：锁定总线（成本高）
- 现代处理器：缓存一致性协议（MESI），锁定缓存行即可

### 3.2 JDK 层面：Unsafe → VarHandle

JDK 内部通过两种方式暴露 CAS 能力：

| API | JDK 版本 | 说明 |
| :-- | :-- | :-- |
| `Unsafe.compareAndSwapInt()` | JDK 1.5+ | 早期方案，直接操作内存，仅供 JDK 内部使用（应用代码不应调用） |
| `VarHandle.compareAndSet()` | JDK 9+ | 官方替代方案，类型安全，支持多种内存访问模式，替代大部分 Unsafe 操作 |

```java
// Unsafe 方式（仅供 JDK 内部，应用代码不应直接使用）
Unsafe unsafe = Unsafe.getUnsafe();
Field field = MyClass.class.getDeclaredField("value");
long offset = unsafe.objectFieldOffset(field);
unsafe.compareAndSwapInt(obj, offset, expected, newVal);

// VarHandle 方式（JDK 9+，推荐）
VarHandle handle = MethodHandles.lookup()
    .in(MyClass.class)
    .findVarHandle(MyClass.class, "value", int.class);
handle.compareAndSet(obj, expected, newVal);
```

`VarHandle` 不仅支持 CAS，还支持多种内存访问模式：

```java
public class VarHandleDemo {
    private volatile int state = 0;
    private static final VarHandle STATE;

    static {
        try {
            STATE = MethodHandles.lookup()
                .findVarHandle(VarHandleDemo.class, "state", int.class);
        } catch (Exception e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    // CAS 操作
    public boolean casState(int expected, int newVal) {
        return STATE.compareAndSet(this, expected, newVal);
    }

    // 原子加法（类似 AtomicInteger.getAndAdd）
    public int getAndAdd(int delta) {
        return (int) STATE.getAndAdd(this, delta);
    }

    // volatile 读（等价于直接读 volatile 字段，但可编程使用）
    public int getState() {
        return (int) STATE.getVolatile(this);
    }

    // 带内存语义的写（release 语义）
    public void releaseWrite(int val) {
        STATE.setRelease(this, val);
    }
}
```

`VarHandle` 相比 `Unsafe` 的优势：

- **类型安全**：编译时检查类型，而非运行时
- **官方支持**：是 JDK 标准 API，不依赖内部实现
- **更丰富的语义**：支持 `getVolatile`、`setRelease`、`getAcquire` 等多种内存访问模式
- **数组和静态字段**：同样支持 `ArrayVarHandle` 和静态字段的访问

AtomicInteger 内部的简化实现：

```java
public class AtomicInteger {
    private static final VarHandle VALUE;
    static {
        try {
            VALUE = MethodHandles.lookup()
                .findVarHandle(AtomicInteger.class, "value", int.class);
        } catch (Exception e) {
            throw new ExceptionInInitializerError(e);
        }
    }
    private volatile int value;

    public final int incrementAndGet() {
        int oldVal;
        do {
            oldVal = get();
        } while (!VALUE.compareAndSet(this, oldVal, oldVal + 1));
        return oldVal + 1;
    }
}
```

> **为什么 AtomicInteger 的字段必须是 `volatile`？**
> CAS 只保证单次操作的原子性。如果 `value` 不是 `volatile`，线程 A 的写入可能对线程 B 不可见——B 看到的仍是旧值，CAS 的"比较"就失去了意义。`volatile` 保证了可见性，配合 CAS 实现了原子性 + 可见性。

## 4. CAS 的三大问题

CAS 并非万能灵药。它有三个已知的经典问题。

### 4.1 问题一：ABA 问题

```txt
线程 A：读取 V = A
线程 B：将 V 从 A 改为 B，再从 B 改回 A
线程 A：CAS(V, A, 新值) → 成功 ✗
```

虽然 CAS 成功了，但 V 的"语义"已经变了（可能是一个链表节点被替换后又换回来）。在某些场景（如无锁栈）中这会导致严重错误。

解决方案：**AtomicStampedReference 加版本号**

```java
AtomicStampedReference<Node> ref =
    new AtomicStampedReference<>(nodeA, 0); // 初始值 + 初始版本号

int[] stampHolder = new int[1];
Node current = ref.get(stampHolder);  // 同时获取值和版本号
int stamp = stampHolder[0];

// CAS 同时比较值和版本号
boolean success = ref.compareAndSet(
    current,       // 期望值
    newNode,       // 新值
    stamp,         // 期望版本号
    stamp + 1      // 新版本号
);
```

| 方案 | 比较内容 | 适用场景 |
| :-- | :-- | :-- |
| `AtomicReference` | 只比较引用 | 不关心中间变化 |
| `AtomicStampedReference` | 引用 + 版本号 | 需要检测 ABA |
| `AtomicMarkableReference` | 引用 + boolean 标记 | 只需知道"是否被修改过" |

### 4.2 问题二：自旋消耗

竞争激烈时，CAS 可能长时间自旋却不成功，白白消耗 CPU。

```java
// 模拟高竞争下的自旋
while (!cas(expected, newVal)) {
    expected = get();    // 每次都失败 → CPU 空转
    newVal = expected + 1;
}
```

**应对策略：**

1. **`LongAdder` / `LongAccumulator`**（JDK 8+）：将单个计数器拆分为多个 cell，每个线程写自己的 cell，最后汇总。用空间换时间。
2. **竞争激烈时退化为锁**：这是 `synchronized` 在 JDK 6+ 中的策略——自旋几次后仍然拿不到锁，就升级为重量级锁挂起线程。

### 4.3 问题三：单变量限制

CAS 一次只能保证一个变量的原子性。如果需要同时更新两个变量呢？

解决方案：**封装为对象 + AtomicReference**

```java
class IntPair {
    final int x;
    final int y;
    IntPair(int x, int y) { this.x = x; this.y = y; }
}

AtomicReference<IntPair> pairRef = new AtomicReference<>(new IntPair(0, 0));

// 原子地同时更新 x 和 y
IntPair oldPair, newPair;
do {
    oldPair = pairRef.get();
    newPair = new IntPair(oldPair.x + 1, oldPair.y + 1);
} while (!pairRef.compareAndSet(oldPair, newPair));
```

## 5. Atomic 系列演进

CAS 自旋只是基石。真正让业务代码能直接用上的，是建在 CAS 之上的 `java.util.concurrent.atomic` 一系列封装。按使用形态横向归类：

### 5.1 分类一览

| 类别 | 代表类 | 说明 |
| :-- | :-- | :-- |
| 基本类型 | `AtomicInteger`, `AtomicLong`, `AtomicBoolean` | 对 int/long/boolean 的原子操作 |
| 引用类型 | `AtomicReference`, `AtomicStampedReference`, `AtomicMarkableReference` | 对对象引用的原子操作 |
| 数组类型 | `AtomicIntegerArray`, `AtomicLongArray`, `AtomicReferenceArray` | 对数组元素的原子操作 |
| 字段更新器 | `AtomicIntegerFieldUpdater`, `AtomicReferenceFieldUpdater` | 对 volatile 字段的 CAS 操作，节省内存 |
| 累加器 | `LongAdder`, `LongAccumulator`, `DoubleAdder`, `DoubleAccumulator` | 高并发累加，分段汇总 |

### 5.2 LongAdder vs AtomicLong

这是理解"从单点 CAS 到分段 CAS"的典型例子。

```txt
AtomicLong（单点 CAS）：
┌─────────────┐
│   value=42  │  ← 所有线程竞争同一个变量
└─────────────┘
Thread A: CAS(42, 43) ✗ 重试
Thread B: CAS(42, 43) ✗ 重试
Thread A: CAS(42, 43) ✓
Thread B: CAS(43, 44) ✓

LongAdder（分段 CAS）：
┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
│cell0│ │cell1│ │cell2│ │cell3│  ← 每个线程写自己的 cell
│ =10 │ │ =12 │ │ =8  │ │ =12 │
└─────┘ └─────┘ └─────┘ └─────┘
   sum = 10 + 12 + 8 + 12 = 42（最终汇总）
```

```java
// LongAdder 的使用
LongAdder adder = new LongAdder();
adder.increment();
adder.add(5);
long total = adder.sum(); // 汇总所有 cell

// LongAccumulator：自定义累加逻辑
LongAccumulator acc = new LongAccumulator(Long::max, Long.MIN_VALUE);
acc.accumulate(10);
acc.accumulate(20);
long max = acc.get(); // 20
```

### 5.3 性能对比

```txt
场景：16 线程并发自增，100 万次

AtomicLong:   ~1200ms   （所有线程竞争同一变量，大量 CAS 失败重试）
LongAdder:    ~180ms    （分散到 cell，几乎无竞争）
```

> **选型规则**：需要精确的单点值读取（如序列号生成器）用 `AtomicLong`；只需要最终汇总结果（如统计计数器）用 `LongAdder`。

### 5.4 字段更新器：节省内存的利器

当一个类有大量实例，每个实例都需要一个原子字段时，用 `AtomicInteger` 作为字段会导致每个实例多一个对象头。字段更新器可以避免这个问题：

```java
public class Node {
    // 用 volatile 字段 + 更新器，而非 AtomicInteger 对象
    volatile int state = 0;

    private static final AtomicIntegerFieldUpdater<Node> STATE =
        AtomicIntegerFieldUpdater.newUpdater(Node.class, "state");

    public boolean casState(int expected, int newVal) {
        return STATE.compareAndSet(this, expected, newVal);
    }
}
```

每个 `Node` 实例只多了一个 `volatile int` 字段（4 字节），而不是一个 `AtomicInteger` 对象（16+ 字节）。ConcurrentHashMap 的 `Node` 节点正是用这种方式来实现桶内节点的 CAS 更新。

## 6. CAS vs 锁：何时选择哪种

CAS 与锁各有适用边界。选型的核心变量只有两个：**竞争激烈度**与**操作复杂度**。

| 维度 | CAS（无锁） | 锁（synchronized / ReentrantLock） |
| :-- | :-- | :-- |
| **阻塞** | 不阻塞，自旋重试 | 阻塞线程，挂起/唤醒 |
| **单变量操作** | 非常高效 | 过度保护，浪费性能 |
| **复合操作** | 需要封装对象 + AtomicReference | 天然支持，锁住整个代码块 |
| **高竞争** | 大量自旋，CPU 空转 | 线程挂起，CPU 可以做其他事 |
| **低竞争** | 一次 CAS 成功，开销极低 | 获取锁 + 释放锁，开销相对较高 |
| **代码复杂度** | 循环 + CAS，逻辑分散 | 同步块，逻辑清晰 |
| **公平性** | 不保证（可能饥饿） | 可选公平锁（`new ReentrantLock(true)`） |

### 6.1 决策指南

```txt
需要更新的变量数量？
├── 单个变量
│   ├── 竞争低 → CAS（AtomicInteger 等）
│   ├── 竞争高 → LongAdder / LongAccumulator
│   └── 需要 ABA 检测 → AtomicStampedReference
├── 多个变量需要原子更新
│   ├── 可以封装为不可变对象 → AtomicReference + 不可变对象
│   └── 逻辑复杂 → 锁
└── 复合操作（检查再执行）
    ├── 简单的 check-then-act → CAS + 重试
    └── 复杂业务逻辑 → 锁
```

### 6.2 实际案例：无锁栈

```java
public class LockFreeStack<T> {
    private final AtomicReference<Node<T>> top = new AtomicReference<>();

    public void push(T value) {
        Node<T> newNode = new Node<>(value);
        Node<T> oldTop;
        do {
            oldTop = top.get();
            newNode.next = oldTop;
        } while (!top.compareAndSet(oldTop, newNode));
    }

    public T pop() {
        Node<T> oldTop;
        Node<T> newTop;
        do {
            oldTop = top.get();
            if (oldTop == null) return null;
            newTop = oldTop.next;
        } while (!top.compareAndSet(oldTop, newTop));
        return oldTop.value;
    }

    private static class Node<T> {
        final T value;
        Node<T> next;
        Node(T value) { this.value = value; }
    }
}
```

> 注意：这个栈的 `pop` 操作存在 ABA 问题——如果节点被弹出后又压入一个相同值的新节点，CAS 会错误地成功。实际生产中需要使用 `AtomicStampedReference` 来解决。

## 7. 本章小结

| 概念 | 核心要点 |
| :-- | :-- |
| CAS | 一条 CPU 指令完成"比较并交换"，是无锁并发的基石 |
| 自旋 | CAS 失败后重试而非阻塞，适合低竞争场景 |
| ABA 问题 | 用 `AtomicStampedReference` 加版本号解决 |
| LongAdder | 高竞争下的分段 CAS，用空间换时间 |
| 字段更新器 | 大量实例场景下节省内存 |
| CAS vs 锁 | 低竞争单变量用 CAS，复杂逻辑用锁 |

无锁并发覆盖"低竞争 + 单变量"这条主线；一旦跨过这条线，锁与 AQS 仍然是更合适的工具。理解 CAS 的原理与局限，才能在正确的场景做出正确的选择。
