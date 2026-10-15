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

对于一个简单的计数器场景，[第 1 章](./chapter-01-why-concurrency.md)已经展示过 `count++` 的数据竞争问题，[第 6 章](./chapter-06-synchronized.md)用 `synchronized` 解决了它。但 `count++` 对应的 CPU 指令其实只有三步：

```txt
LOAD count → 寄存器
ADD 1 → 寄存器
STORE 寄存器 → count
```

三步之间如果有其他线程插入，就会出错。锁的方案是把这三步"包裹"起来串行执行。但如果我们能用**一条 CPU 指令**完成"读-改-写"的原子操作呢？

这就是无锁并发的出发点：**利用硬件提供的原子指令，避免线程阻塞，提升吞吐量**。

## 2. CAS 原理

### 2.1 Compare And Swap：硬件级的乐观锁

CAS（Compare And Swap）是一种原子比较并更新操作：只有当前值仍等于期望值时，才将其更新为新值。Java 的原子类和 VarHandle 提供了这一操作的 API，JVM 会根据目标处理器和具体实现，将它映射为相应的原子指令或其他实现路径。其语义可以用伪代码描述：

```java
// CAS 伪代码
boolean cas(内存地址 V, 期望值 A, 新值 B) {
    if (V 当前的值 == A) {
        V = B;       // 更新成功
        return true;
    } else {
        return false; // 更新失败，说明执行 CAS 时的当前值不等于期望值
    }
}
```

关键点：**"比较"和"交换"是原子地完成的**，不存在中间状态，调用方观察到的要么是更新前的值、要么是更新后的值。

### 2.2 用 CAS 实现无锁计数器

```java
import java.lang.invoke.MethodHandles;
import java.lang.invoke.VarHandle;

public class CasCounter {
    private volatile int count = 0;
    private static final VarHandle COUNT;

    static {
        try {
            COUNT = MethodHandles.lookup()
                    .findVarHandle(CasCounter.class, "count", int.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    public void increment() {
        int oldVal;
        do {
            oldVal = count;                        // 1. 读取当前值
        } while (!COUNT.compareAndSet(this, oldVal, oldVal + 1)); // 2. 原子 CAS
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

在 x86 平台上，JVM 常使用带 LOCK 前缀的 CMPXCHG 指令实现 CAS。这是 x86 上的一种典型实现，不代表 Java CAS 在所有平台上都对应同一条指令：

```asm
; x86 汇编示意代码（伪汇编操作数，非完整指令语法）
lock cmpxchg [mem], new_val
; lock 前缀：保证相应内存操作的原子性
```

`lock` 前缀的实际机制取决于 CPU 型号和缓存状态：

- 对满足条件的普通缓存内存访问，现代处理器通常利用缓存一致性机制完成操作，不必锁住整个系统总线
- 跨缓存行等特殊情况下，处理器可能采用更昂贵的总线锁定机制

### 3.2 JDK 层面：Unsafe → VarHandle

JDK 内部通过两种方式暴露 CAS 能力：

| API | JDK 版本 | 说明 |
| :-- | :-- | :-- |
| `Unsafe.compareAndSwapInt()` | JDK 1.5+ | JDK 内部使用的底层 API；普通应用不应依赖其内部实现接口 |
| `VarHandle.compareAndSet()` | JDK 9+ | 标准变量访问 API，类型安全，支持原子更新和多种内存访问模式 |

```java
// Unsafe 方式（JDK 内部实现示意，普通应用通常无法直接通过 Unsafe.getUnsafe() 获取实例）
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

这些访问模式的差异不仅在于是否原子更新，还在于它们提供的内存排序保证。`getVolatile` 和 `setVolatile` 具有 volatile 读写语义；`setRelease` 用于发布此前的操作，`getAcquire` 用于获取此前发布的数据。若要通过 release/acquire 传递数据，需要读取方实际观察到相应发布值，不能只因为两边分别调用了这两个方法，就认为任意数据都自动建立了可见性关系。`getAndAdd` 则是原子读改写操作，并具有该访问模式规定的内存语义。

JDK 9+ 的 AtomicInteger 简化实现（JDK 8 及之前使用 Unsafe 实现）：

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

> **为什么 AtomicInteger 的字段声明为 `volatile`？**
> AtomicInteger 不只是提供 CAS，还提供 `get()`、`set()` 等普通读写方法，`value` 声明为 `volatile`，使这些方法遵循相应的 volatile 内存语义。与此同时，`compareAndSet()` 本身也具有 API 规定的原子性和内存语义，不能简单理解成"CAS 负责原子性，volatile 负责可见性"的拼装。VarHandle 可以针对非 volatile 字段执行支持的原子访问模式，具体保证取决于调用的访问模式；AtomicInteger 的字段声明方式是它自身实现和 API 语义的一部分，不应推广成所有 CAS 操作的硬性要求。

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
| `AtomicMarkableReference` | 引用 + boolean 标记 | 只需维护一个标记状态，例如逻辑删除标记 |

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

1. **`LongAdder` / `LongAccumulator`**（JDK 8+）：维护基础值并在竞争时动态扩展 cell 数组，将更新分散到多个 cell，降低单点争用，最后汇总。用空间换时间。
2. **竞争激烈时转用锁**：`synchronized` 的具体竞争处理属于 JVM 实现细节，会随 JDK 版本和运行时状态变化。HotSpot 在某些竞争场景下会尝试自旋，以避免线程立即阻塞；是否自旋、何时进入阻塞路径，并不是固定次数的统一规则。

### 4.3 问题三：单变量限制

单次 CAS 针对一个目标变量进行原子比较与更新。如果需要同时更新两个变量呢？若多个业务字段被封装在一个不可变对象中，并通过 CAS 原子替换对象引用，可以让这些字段作为一个整体切换状态。

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
│cell0│ │cell1│ │cell2│ │cell3│  ← 更新分散到多个 cell
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

`LongAdder.sum()` 逐个读取 `base` 和所有 `cell`，**不是原子快照**。并发更新期间调用可能观察到不同步的中间状态，因此它适合最终统计和监控，不适合序列号、余额校验等要求瞬时值严格一致的场景。

### 5.3 性能取舍

`AtomicLong` 始终更新同一个值，高竞争下容易发生 CAS 失败重试；`LongAdder` 把写入分散到 `cell`，通常能降低热点竞争，但汇总时需要扫描更多状态。两者没有脱离负载的固定性能倍数，选型应结合争用程度、读取频率、一致性要求和目标 JDK 实测。

> **选型方向**：需要稳定的原子读改写或严格瞬时值时用 `AtomicLong`；高写竞争且主要在空闲期汇总时用 `LongAdder`。

### 5.4 字段更新器：减少每个实例的对象开销

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

字段更新器要求目标字段具有相应类型并声明为 `volatile`，上例只能更新 `volatile int state`。这种写法让多个实例共享一个更新器对象，不再为每个实例创建独立的 `AtomicInteger`；具体内存收益取决于 JVM 对象布局，不能只按字段宽度推算。

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

> 关于 ABA：当前实现每次 push 都创建新节点，pop 只返回节点值，也没有复用已弹出的节点，因此这里并没有展示出同一节点被移除后又重新成为栈顶的执行路径。如果实现引入节点复用（例如节点池），或允许同一个节点引用被重新压入，其他线程就可能在读取栈顶后观察到 ABA：栈顶引用恢复原值，但该节点的 `next` 已发生变化，旧线程基于过期的 `next` 执行 CAS 仍可能成功，从而破坏栈结构。此类算法需要考虑版本戳、节点生命周期和内存回收等问题。`AtomicStampedReference` 能帮助检测引用与版本戳的变化，但不能当作所有问题的一键修复。

## 7. 本章小结

| 概念 | 核心要点 |
| :-- | :-- |
| CAS | 一条 CPU 指令完成"比较并交换"，是无锁并发的基石 |
| 自旋 | CAS 失败后重试而非阻塞，适合低竞争场景 |
| ABA 问题 | 用 `AtomicStampedReference` 加版本号解决 |
| LongAdder | 高竞争下分散写入，用空间和非原子汇总换写入吞吐 |
| 字段更新器 | 大量实例场景下节省内存 |
| CAS vs 锁 | 低竞争单变量用 CAS，复杂逻辑用锁 |

无锁并发覆盖"低竞争 + 单变量"这条主线；一旦跨过这条线，锁与 AQS 仍然是更合适的工具。理解 CAS 的原理与局限，才能在正确的场景做出正确的选择。

## 8. 下一步

CAS 是 AQS 状态转移和无锁容器的基础。下一步进入 [`LockSupport` 与 AQS](./chapter-08-locksupport-aqs.md)；确认争用是否真的值得优化时，可从[并发性能优化](../06-diagnostics/02-concurrency/chapter-02-concurrency-optimization.md)选择策略。
