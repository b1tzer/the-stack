# Java 内存模型（JMM）：线程如何看到数据

> 线程 A 写完 `x = 42`，线程 B 却读到 `0`——出错的是 CPU、编译器、还是 Java？`volatile`、`synchronized`、`final` 到底各自保证了什么？没有 JMM，"多线程正确"这件事就没有可推理的地基。

前面三章解决了"线程是什么"、"怎么创建"、"线程私有的 `ThreadLocal` 如何回避竞争"。真正无法回避的情况——多个线程访问同一份数据——从这一章开始。JMM 是 Java 给"共享数据"这件事定的规则本身。理解它，才能推理为什么 `volatile` 够用、为什么 `synchronized` 必要、为什么 `final` 也是一种并发工具。

## 1. 为什么需要 JMM

### 1.1 单线程直觉在多核上失效

单线程世界的两条直觉——"代码从上往下执行"、"写入的值立刻能读到"——都在多核硬件上被打破了。

**第一处：CPU 缓存**

现代 CPU 采用多级缓存架构。每个核心有私有的 L1 / L2，多个核心共享 L3，最后才是主内存：

![jmm-memory-model](/java/jmm-memory-model.svg)

Core 0 把 `x = 1` 写到自己的 L1 时，这个修改并不会立刻写回主内存。此时 Core 1 从自己 L1 读到的可能仍是旧值 `0`。**可见性问题的硬件根源就在这里**。

**第二处：编译器和 CPU 的重排序**

```java
int a = 1;       // ①
int b = 2;       // ②
int c = a + b;   // ③
```

编译器和 CPU 会重排序为 ② → ① → ③——单线程下 ① 和 ② 无依赖，交换不影响结果。**这在单线程语义下是安全的（as-if-serial），在多线程环境下则可能产生灾难性后果**（DCL 案例见 §4.3.3）。

### 1.2 JMM 的定位

面对缓存和重排序，Java 需要一份**规范契约**回答三个问题：

- 一个线程的写入，在什么情况下对另一个线程可见
- 什么样的重排序是被允许的，什么不允许
- 通过哪些语言层机制（`volatile`、`synchronized`、`final`）能主动建立保证

这份规范就是 **Java 内存模型（Java Memory Model, JMM）**，由 **JSR-133** 在 Java 5 时代重新定义。它同时约束程序员、JIT 编译器、JVM 实现和 CPU——四方共同遵守才有"多线程正确"这回事。

## 2. JMM 的抽象

### 2.1 JMM 不描述物理内存

一个高频误解：JMM 讨论的是 L1/L2/L3 缓存的组织方式。**并不是**。JMM 描述的是 Java 语言层面的**并发访问规则**——物理内存怎么组织是硬件的事。

JMM 只回答一个问题：

> **在什么条件下，线程 A 对变量 V 的写入，对线程 B 的后续读取是可见的？**

### 2.2 主内存与工作内存

JMM 把执行环境抽象为两个概念：

| 概念 | 对应现实 | 归属 |
| :-- | :-- | :-- |
| **主内存（Main Memory）** | 堆上的实例字段、静态字段、数组元素 | 所有线程共享 |
| **工作内存（Working Memory）** | CPU 缓存 + 寄存器 + 编译器暂存 | 每条线程私有 |

```txt
┌──────────────┐          ┌──────────────┐
│   线程 A      │          │   线程 B     │
│              │          │              │
│  ┌────────┐  │          │  ┌────────┐  │
│  │工作内存 │   │         │  │工作内存  │  │
│  │ x = ?  │  │          │  │ x = ?  │  │
│  └────┬───┘  │          │  └────┬───┘  │
│       │ load │          │       │ load │
└───────┼──────┘          └───────┼──────┘
        │                         │
        │    ┌───────────────┐    │
        └───►│    主内存      │◄───┘
             │   x = 0       │
             └───────────────┘
```

抽象里几条硬规则：

- 线程对变量的读写只能发生在工作内存里，不能越过工作内存直接操作主内存
- 主内存和工作内存之间要走 load / store 传递
- 线程之间无法直接看到彼此的工作内存，数据传递必须经过主内存

这套抽象把"线程 A 的写为什么线程 B 看不到"翻译成一个具体的物理动作缺失：修改还停在 A 的工作内存里，尚未刷回主内存；或者 B 手里是过期副本。

### 2.3 JMM 是谁的契约

JMM 不是给程序员参考的软性约定，是四方都要遵守的硬规则：

- **JIT 编译器**：不允许把有 happens-before 关系的操作重排到破坏语义的位置
- **JVM 实现**：必须在合适的位置插入相应的内存屏障指令
- **CPU**：屏障指令映射到硬件的缓存一致性行为
- **程序员**：正确使用 `volatile`、`synchronized`、`final`、`java.util.concurrent` 建立语义

四方协同才能让 happens-before 规则跨过 JVM 边界，最终在多核硬件上落地。

## 3. 三个核心问题

JMM 处理的所有并发问题都可以归到三类：**原子性**、**可见性**、**有序性**。

### 3.1 原子性

一个操作或一组操作要么全部完成、要么全部不发生，中间不能被打断。

第 1 章展示过 `count++` 的失败——它在字节码层面是三步 `LOAD → ADD → STORE`，两条线程同时读到同一个旧值，各自加 1 后写回，丢一次自增。"读-改-写"这类复合操作的非原子性，是 JMM 从规范层要回答的第一件事。

JMM 保证的原子性范围：

- 除 `long` 和 `double` 之外的基本类型读写是原子的（`long` / `double` 的读写在 32 位 JVM 上可能撕裂成两次 32 位操作；64 位 JVM 上一般都是原子的，但规范本身不强制）
- `synchronized` 块内的操作，对持有同一把锁的线程而言是原子的
- `java.util.concurrent.atomic` 里的原子类通过 CAS 提供无锁原子操作（第 7 章展开）

### 3.2 可见性

一个线程改了共享变量，其他线程能否立刻看到。

反例的常见形状：

```java
boolean flag = false;
int value = 0;

// 线程 A
value = 42;
flag = true;

// 线程 B
while (!flag) {}     // 可能死循环
print(value);        // 即便跳出，也可能打印 0
```

两个失败点叠加：

- **写入未刷新**：线程 A 改了 `flag` 但还留在 CPU 缓存里，B 看不到
- **读取未刷新**：即便 `flag` 已刷回主内存，B 手里的 `value` 副本仍是 `0`

再叠加一层编译器优化：`while (!flag) {}` 的 flag 读取可能被 JIT 提升到循环外（因为它在单线程视角看是"循环不变量"），一次也不再重新读——变成真死循环。

JMM 提供的可见性工具：

- `volatile`：写入立即刷回主内存，读取时强制从主内存加载
- `synchronized`：解锁时刷回主内存，加锁时从主内存重新加载
- `final`：构造完成后的 `final` 字段对所有线程可见（见 §4.5）

三者从不同粒度解决同一件事。具体机制在第 5、6 章分别展开。

### 3.3 有序性

程序执行顺序和代码书写顺序是否一致。

单线程视角下重排序无害（as-if-serial）；多线程视角下才暴露。经典案例是 DCL：

```java
public class Singleton {
    private static Singleton instance;         // ⚠️ 没有 volatile

    public static Singleton getInstance() {
        if (instance == null) {
            synchronized (Singleton.class) {
                if (instance == null) {
                    instance = new Singleton();   // ← 问题在这
                }
            }
        }
        return instance;
    }
}
```

`instance = new Singleton()` 在字节码层面并非一步，而是三步：

```txt
a. 分配内存
b. 执行构造函数，初始化字段
c. 把引用赋值给 instance
```

编译器可能把顺序重排成 **a → c → b**（这在单线程 as-if-serial 下是合法的——反正没别的线程能看到）。**如果发生了这个重排，第二条线程从外层 `if` 拿到的 `instance` 就是"引用已赋值、字段还没初始化"的半成品**：读它的字段会读到默认值（`null` / `0`）。

修复方法只有一步：把 `instance` 声明为 `volatile`。`volatile` 通过内存屏障禁止步骤 b 和 c 的重排。完整机制在第 5 章 §5.3 展开。

有序性的工具和可见性完全重合：

- `volatile`：内存屏障禁止其前后的重排
- `synchronized`：临界区内的顺序对持锁线程稳定
- `final`：构造函数中对 `final` 字段的写不允许重排到"引用发布"之后

## 4. happens-before：JMM 的判断规则

原子性、可见性、有序性只是问题的分类。JMM 给出的**判断工具**是 happens-before。

### 4.1 定义

来自 JLS §17.4.5：

> 如果操作 A happens-before 操作 B，那么 A 的结果对 B 可见，且 A 排在 B 之前发生。

一句提醒：**happens-before 不是"时间上先执行"**。它是 JMM 定义的一种偏序关系，用于推理可见性——即使两个操作在物理时间上重叠，只要它们不存在 happens-before 关系，JMM 也不保证一个能看到另一个的写入。

### 4.2 六条主要规则

**规则 1 · 程序顺序**：同一条线程里，代码书写顺序前的操作 happens-before 后的操作。

```java
int x = 1;         // A
int y = x + 1;     // B  —— A hb B
```

保证了单线程内的语义一致性。你写单线程代码不用担心 JMM。

**规则 2 · volatile 规则**：对 volatile 变量的写 happens-before 后续对同一变量的读。

```java
volatile boolean flag = false;
int value = 0;

// 线程 A
value = 42;
flag  = true;    // A · volatile 写

// 线程 B
while (!flag) {} // B · volatile 读     —— A hb B
print(value);    // 一定看到 42
```

结合规则 1 的传递性，`value = 42` 的可见性也被 A 那次 volatile 写"顺带"带到了 B。

**规则 3 · 锁规则**：一个锁的解锁 happens-before 后续对同一把锁的加锁。

```java
synchronized (lock) {
    sharedVar = 100;
}                        // A · unlock

synchronized (lock) {    // B · lock  —— A hb B
    print(sharedVar);    // 一定是 100
}
```

**规则 4 · 线程启动**：`Thread.start()` happens-before 该线程运行的第一条指令。

```java
int x = 1;
Thread t = new Thread(() -> print(x));  // 一定看到 x = 1
t.start();
```

**规则 5 · 线程终止**：一条线程内所有操作 happens-before 其他线程感知到它已终止（`join` 返回、`isAlive` 变 false）。

```java
int result = 0;
Thread t = new Thread(() -> result = 42);
t.start();
t.join();
print(result);   // 一定看到 42
```

**规则 6 · 传递性**：A hb B、B hb C，则 A hb C。

传递性是 happens-before 真正强大的地方——它让你可以跨多个操作串出可见性链条。

### 4.3 用规则推导 DCL 的正确性

回到 §4.3.3 的 DCL，把 `volatile` 加上：

```java
private static volatile Singleton instance;
```

推导过程：

```txt
线程 A（首次创建）：
  内存分配 & 字段初始化   ── 程序顺序 hb ──►  instance = new Singleton()（volatile 写）

线程 B（后续获取）：
  if (instance != null)（volatile 读）  ── 程序顺序 hb ──►  访问 instance 字段

由 volatile 规则：A 的 volatile 写 hb B 的 volatile 读
由传递性：A 的字段初始化 hb B 对字段的访问
结论：B 看到的 instance 一定是完成构造的
```

`volatile` 在这里做的事，是让"新对象初始化完成"这个事实沿着 happens-before 链条传给读端。这个推导过程也是理解"为什么 `volatile` 能修复 DCL"的正统路径——不是"因为 volatile 强制刷缓存"这类模糊说法。

## 5. `final` 的并发语义与安全发布

原子性、可见性、有序性都可以由 `volatile` 和 `synchronized` 显式建立。JMM 还有第三根支柱：**`final` 字段的初始化安全保证**。它常被忽略，却是 `String`、`Integer`、`ImmutableList` 这类不可变类线程安全的根基。

### 5.1 `final` 的两条硬规则

JSR-133 给 `final` 字段两条硬规则：

1. **构造函数中对 `final` 字段的写**，不允许被重排到"构造函数之后"
2. **发布对象引用**（把 `this` 或新对象赋给共享变量）**不允许被重排到"构造函数之前"**

这两条规则组合起来的效果是：**任何线程只要拿到构造完成后的对象引用，就一定能看到该对象所有 `final` 字段的正确初始化值**——不需要 `volatile`、不需要加锁。

### 5.2 有 `final` 与没有 `final` 的差异

```java
// 场景 1：普通字段，需要外部同步
public class NonFinalHolder {
    int value;                      // 普通字段

    public NonFinalHolder(int v) {
        this.value = v;
    }
}

// 场景 2：final 字段，JMM 提供发布保证
public class FinalHolder {
    final int value;                // final 字段

    public FinalHolder(int v) {
        this.value = v;
    }
}
```

用一个共享引用发布：

```java
NonFinalHolder h1;   // 未加 volatile
FinalHolder    h2;

// 线程 A
h1 = new NonFinalHolder(42);
h2 = new FinalHolder(42);

// 线程 B（在 A 发布之后读）
print(h1.value);   // 可能读到 0！
print(h2.value);   // 一定读到 42
```

`h1.value` 的失败路径和 §4.3.3 的 DCL 一样：**"引用赋值"和"字段初始化"之间的重排**，让读端在 `h1 != null` 时仍可能看到 `value = 0`。`h2.value` 因为 `final` 的两条规则被 JMM 直接排除了这种可能。

### 5.3 安全发布：把"对象可见"讲清楚

**安全发布（safe publication）** 是并发编程的常用术语，指"让另一条线程能安全地看到一个正确构造的对象"。JMM 认可的安全发布方式有四种：

| 发布方式 | 语义来源 | 使用形态 |
| :-- | :-- | :-- |
| 通过 `static` 初始化器 | 类初始化的锁 | `private static final Holder INSTANCE = new Holder();` |
| 通过 `volatile` 字段发布 | volatile 写-读的 happens-before | `volatile Config current;` |
| 通过锁保护的字段发布 | 解锁-加锁的 happens-before | 在 `synchronized` 里写、在 `synchronized` 里读 |
| 通过并发容器发布 | 容器自身的内部同步 | `ConcurrentHashMap.put` → `get` |

**注意**：`final` 字段的初始化安全保证是 "构造完成后引用被拿到的那一刻可见"，而不是"对象在任意时刻都能被任意线程安全访问"。如果构造后又通过普通字段发布对象引用，中间没有任何同步——发布本身仍然是不安全的。

### 5.4 `final` 保证的边界

`final` 提供的初始化安全**不是万能盾**。它有明确的边界：

- **只保护 `final` 字段本身**：非 `final` 字段没有这层保证
- **不保护构造期间 `this` 逸出的场景**：如果构造函数里把 `this` 传出去，另一条线程可能拿到"构造未完成"的引用，此时 `final` 保证同样落空
- **不保护 `final` 引用指向的可变对象**：`final List<String> tags = new ArrayList<>();` 里的 `tags` 引用是安全发布的，但 `tags` 内部的元素依然是可变的、不受 `final` 保护

```java
// ❌ this 逸出：final 也救不了
public class UnsafeThisEscape {
    final int value;

    public UnsafeThisEscape(EventBus bus) {
        bus.register(this);   // ← 构造尚未完成，this 就发布出去了
        this.value = 42;      // 其他线程可能在这一行之前访问 value
    }
}

// ✅ 构造完成后再发布
public class SafeThisEscape {
    final int value;

    private SafeThisEscape() {
        this.value = 42;
    }

    public static SafeThisEscape createAndRegister(EventBus bus) {
        SafeThisEscape self = new SafeThisEscape();
        bus.register(self);   // 构造已完成才发布
        return self;
    }
}
```

`this` 逸出是并发场景里非常隐蔽的一类 bug——构造函数看上去很正常，问题却出在被调用的外部方法里。识别方法很直接：**构造函数里不要调用可能把 `this` 传给其他线程的任何方法**（`register`、`addListener`、`start` 一条新线程且线程内引用 `this`）。

### 5.5 为什么不可变对象天然线程安全

结合 §4.5.1–4.5.4，可以给出"不可变对象为什么线程安全"的完整推导：

- 所有字段都是 `final` → 初始化安全保证生效
- 构造完成后字段不再变化 → 不需要为"后续修改"建立同步
- 引用发布本身通过合适的通道（`static final`、`volatile`、`ConcurrentHashMap`）完成安全发布 → 引用的可见性也解决了

这三条一起构成了 `String`、`Integer`、`LocalDate`、Guava `ImmutableList` 等不可变类无需加锁、无需 `volatile`、任意线程随便共享的语义地基。

## 6. JMM 与硬件的连接

前面五节都在讨论 Java 层面的规范。规范最终要靠机器指令执行——**内存屏障**就是把 JMM 语义落到硬件的翻译层。

### 6.1 内存屏障要做的四件事

内存屏障（memory barrier / memory fence）本质是 CPU 指令，作用可以概括成四点：

- 约束某些读写不能跨越屏障重排
- 约束某些写入必须先完成再执行后续操作
- 让部分写入更快地对其他处理器可见
- 让部分读取从可靠的位置重新获取数据

没有这层约束，happens-before 规则很难真正落到硬件上——语言层要求"前面的写对后面的读可见"，硬件层却可能因为缓存和乱序，让另一个核心暂时看不到这次写入。

### 6.2 四类内存屏障

JMM 讨论底层实现时，通常用四类屏障描述重排边界：

| 屏障类型 | 作用 | 对应的 JMM 场景 |
| :-- | :-- | :-- |
| **LoadLoad** | 屏障前的读完成后，才能执行屏障后的读 | 确保读取顺序 |
| **StoreStore** | 屏障前的写完成后，才能执行屏障后的写 | `volatile` 写之前、`final` 字段构造完成时 |
| **LoadStore** | 屏障前的读完成后，才能执行屏障后的写 | 较少单独使用 |
| **StoreLoad** | 屏障前的写完成后，才能执行屏障后的读 | `volatile` 写之后（开销最大） |

开销最大的是 **StoreLoad**：它既要处理写入的可见性刷新，又要阻止后续读越过屏障——绝大多数 CPU 上都最昂贵。这也是"`volatile` 写比 `volatile` 读贵得多"的硬件根源。

### 6.3 屏障约束的边界示意

```txt
线程中的操作流

读 A ── 读 B ── 写 C ── 写 D
          ↑
       插入屏障后
          ↓

读 A ── [Barrier] ── 读 B ── 写 C ── 写 D
```

屏障本身不承担业务逻辑——它做的是**约束边界**：告诉编译器和 CPU，某些读写不能跨过这条线乱跑。

约束落下去后带来的结果：前面的操作按要求先完成、后面的操作按要求后执行、某些写入会按同步语义对外可见、某些读取会在正确的同步点之后发生。

### 6.4 CPU 架构差异

不同 CPU 架构对内存一致性的默认保证差别很大，这也是 JMM 必须存在的原因：

| CPU 架构 | 内存模型强度 | 特点 |
| :-- | :-- | :-- |
| **x86 / x86-64** | 较强（TSO） | 硬件默认已经处理了一部分顺序问题，但不是全部 |
| **ARM / AArch64** | 较弱 | 更依赖显式屏障 |
| **RISC-V** | 较弱（可配置） | 通过显式 `fence` 指令控制约束 |

并发 bug 容易出现平台差异的原因也在这里：同一段代码在 x86 上看起来稳定，迁到 ARM 后可能立刻暴露。稳定的、可推理的保证只来自 JMM 语义与 JVM 插入的屏障，不来自"这台机器恰好帮你兜住了"。

### 6.5 三层关系一图收尾

![jmm-happens-before](/java/jmm-happens-before.svg)

JMM 定义并发语义、JVM 翻译为屏障、CPU 执行屏障——三层协作是"Java 并发能被推理"的物理基础。

## 7. 本章小结

| 问题 | 根源 | 解决方案 |
| :-- | :-- | :-- |
| 原子性缺失 | 复合操作可被中断 | `synchronized` / `AtomicXxx` / CAS |
| 可见性缺失 | CPU 缓存 + 编译器优化 | `volatile` / `synchronized` / `final` |
| 有序性缺失 | 编译器与 CPU 的重排 | `volatile`（屏障）/ `synchronized` |
| 单线程内可见性 | 程序顺序规则 | 天然保证 |
| 跨线程可见性 | happens-before 链 | volatile 规则 / 锁规则 / 传递性 |
| 对象发布不安全 | 构造与发布之间可能重排 | `final` 字段的初始化安全 + 安全发布通道 |
| 构造未完成引用逸出 | `this` 提前发布 | 构造函数里禁止 `this` 逸出 |
| CPU 架构导致的平台差异 | 内存模型强度不同 | 依赖 JVM 插入的屏障，不依赖硬件默认 |
