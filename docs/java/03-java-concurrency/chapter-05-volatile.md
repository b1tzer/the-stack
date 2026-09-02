# `volatile`：最轻的同步

> 修饰一个变量到底修饰了什么？它凭什么能让 DCL 恢复正确？为什么它明明有"可见性 + 有序性"，却还是撑不起一个 `count++`？

第 4 章的 JMM 定义了规则——线程之间怎么看到彼此的数据、什么样的重排允许发生。`volatile` 是这份规则里最小的执行工具：**只作用于单个变量的读写边界**。它比 `synchronized` 便宜得多，也比 `synchronized` 弱得多。这一章讨论它到底在什么位置、能做什么、不能做什么。

## 1. `volatile` 解决的问题

### 1.1 从一个停不下来的循环开始

先看这段代码。它试图用一个 `boolean` 字段做"停机标志"：

```java
public class Worker {
    private boolean running = true;

    public void start() {
        new Thread(() -> {
            while (running) {
                doSomething();
            }
            System.out.println("worker stopped");
        }).start();
    }

    public void stop() {
        running = false;
    }
}
```

调用方期望的是：`stop()` 一被调用，工作线程读到 `running = false`，循环退出。

现实里这段代码可能**永远停不下来**。两条独立失败路径：

- **JIT 提升**：Server 编译器发现 `running` 在循环体内没有被修改，认为它是"循环不变量"，把读取从循环里提出去——等价于把代码改成 `if (running) while (true) doSomething();`。此后无论外部谁改 `running`，工作线程都不会重新读。
- **缓存驻留**：即便没有 JIT 优化，`stop()` 那次写入可能只落在主线程的 CPU 缓存里，还没刷到主内存；工作线程的缓存副本仍然是 `true`。

改法只有一步：

```java
private volatile boolean running = true;
```

**这一步 `volatile` 建立的语义是**：每次 `running` 的读必须从主内存重新拿；每次写必须立刻刷回主内存。JIT 也不再允许把这次读提升出循环。

### 1.2 `volatile` 明面上的两个保证

`volatile` 给单个变量的读写建立了两条硬承诺：

1. **可见性**：写发生后，其他线程后续对同一变量的读一定能看到这个新值
2. **有序性**：`volatile` 变量相关的读写不允许被重排到"它应该在的位置"之外

一句更精确的表述：**`volatile` 建立的是变量读写边界上的 happens-before 关系**——第 4 章 §4.4.2 的规则 2。理解这一点，`volatile` 剩下所有行为都能推理出来。

### 1.3 与 JMM 的位置关系

再回顾第 4 章的三层图，`volatile` 处在语言层：

```text
Java 层 ─── volatile / synchronized / final ─── 由程序员显式使用
              │
JVM 层 ─── 在读写两侧插入合适的内存屏障
              │
CPU 层 ─── 屏障映射到具体架构的一致性协议行为
```

`volatile` 的能力和边界都由 JVM 在读写两侧插入的屏障决定。所以要理解 `volatile` "为什么能"和"为什么不能"，接下来要拆开的就是屏障。

## 2. 四类屏障与 `volatile` 的读写语义

### 2.1 屏障的作用回顾

第 4 章 §4.6 完整定义了四类内存屏障（LoadLoad / LoadStore / StoreStore / StoreLoad）及其作用。`volatile` 用到其中三类，位置固定：

| 屏障 | 在 `volatile` 中的插入点 |
| :-- | :-- |
| **StoreStore** | `volatile` 写**之前** |
| **StoreLoad** | `volatile` 写**之后** |
| **LoadLoad** + **LoadStore** | `volatile` 读**之后** |

`LoadStore` 在其他屏障组合中也有出现，但 `volatile` 的核心行为只由这四种插入位置决定。下面分别看写侧和读侧。

### 2.2 写侧：`StoreStore` + `StoreLoad`

`volatile` 写周围插入的屏障：

```text
     普通写 1
     普通写 2
   ─────────── StoreStore（前面的写要先完成）
     volatile 写
   ─────────── StoreLoad（这次写要先对其他线程可见）
     后续读
     后续写
```

两条屏障各自的用途：

- **`StoreStore` 前置**：保证 `volatile` 写之前的所有普通写不会被重排到 `volatile` 写之后。这就是"你在 `volatile` 变量写之前埋下的所有普通字段，会一起被这次 `volatile` 写发布出去"的机制来源。
- **`StoreLoad` 后置**：保证 `volatile` 写完成后，后续任何读不会绕过这次写去读取旧值。四类屏障里 **`StoreLoad` 是最贵的**——它既要处理写入的对外可见，又要阻止后续读越过屏障重排，几乎所有 CPU 上都是最重的一条。

"`volatile` 写比 `volatile` 读贵得多"的成本差距就在 `StoreLoad`。

### 2.3 读侧：`LoadLoad` + `LoadStore`

`volatile` 读周围插入的屏障：

```text
     前面的读写
   ─────────── （无屏障）
     volatile 读
   ─────────── LoadLoad（后续读不能提前到这次读之前）
   ─────────── LoadStore（后续写不能提前到这次读之前）
     后续读
     后续写
```

两条屏障保证的事：**只要 `volatile` 读拿到了新值，后面所有普通读写都必须发生在这次读之后**。也就是说，读端拿到 `volatile` 变量的新值后，还能"顺带"看到写端在这次 `volatile` 写之前完成的所有普通写。

### 2.4 一张时序图收尾

把两侧屏障串起来看：

```text
线程 A：写侧                       线程 B：读侧
─────────                          ─────────
普通写：data       = 42
普通写：readyExtra = true
                                   
[ StoreStore ]                     
volatile 写：ready = true          
[ StoreLoad ]                      
                                   volatile 读：ready == true
                                   [ LoadLoad + LoadStore ]
                                   
                                   普通读：data       → 42（一定）
                                   普通读：readyExtra → true（一定）
```

一旦 B 看到 `ready = true`，A 在 `volatile` 写之前完成的 `data` 和 `readyExtra` 也一并对 B 可见。这套模式在 JDK 源码里反复出现，一般被称为 **发布-订阅模式**——`volatile` 变量本身只是发布信号，携带的信息是它周围的普通字段。

### 2.5 缓存一致性协议帮 `volatile` 落到硬件

屏障解决顺序问题。可见性还要靠 CPU 的**缓存一致性协议**——最常见的形式是 MESI：

| 状态 | 含义 |
| :-- | :-- |
| **M**odified | 当前核心修改过，尚未同步回主内存，其他核心的副本已失效 |
| **E**xclusive | 当前核心独占，值与主内存一致 |
| **S**hared | 多核心共享同一缓存行 |
| **I**nvalid | 缓存行已失效，下次读必须重新加载 |

`volatile` 写触发的一致性动作：

```text
Core 0（线程 A）                 Core 1（线程 B）
────────────────                 ────────────────
缓存行：Shared                    缓存行：Shared
       │                                  │
       │ volatile 写 ready = true          │
       │──── 一致性总线：Invalidate ──────►│
       │                                  │
缓存行：Modified                    缓存行：Invalid
                                          │
                                          │ volatile 读 ready
                                          ▼
                                     重新从主内存/L3 加载
```

JMM 定义 Java 层语义，JVM 用屏障翻译语义，MESI 让屏障在硬件上真正生效。三者协作，`volatile` 的可见性才成立。

### 2.6 x86 与 ARM 的差异

不同 CPU 架构下屏障成本差别很大：

- **x86 / x86-64（TSO，较强顺序）**：`volatile` 读几乎没有额外成本，`volatile` 写通常翻译成一条 `lock addl $0, (%rsp)`（`StoreLoad` 屏障）
- **ARM / AArch64（较弱顺序）**：需要显式的 `dmb ish` 指令，屏障成本明显高于 x86

一段没加 `volatile` 的代码在 x86 上"看着能跑"，只是 x86 帮忙兜住了部分顺序；换到 ARM 常常立刻暴露。真正稳定的保证只有一个来源：**JMM 语义 + JVM 插入的屏障**，不是"这台机器恰好帮我兜住了"。

## 3. 用 `volatile` 完整修复 DCL

第 4 章 §4.3.3 提到过 DCL 需要 `volatile` 修复。这一节把机制彻底剖开——它是理解"`volatile` 有序性到底防了什么"的最好案例。

### 3.1 `new Singleton()` 不是原子的

一行 `instance = new Singleton()` 在字节码层面有三步：

```text
a. 分配内存空间
b. 执行构造函数，初始化字段
c. 把引用赋值给 instance
```

编译器 / CPU 在**单线程视角**看，b 和 c 之间没有数据依赖（`instance` 的值早已确定，b 只是往新分配的对象上填字段）。as-if-serial 规则允许它们被重排为：

```text
a. 分配内存空间
c. 把引用赋值给 instance   ← instance 已非 null
b. 执行构造函数            ← 字段还没写完
```

### 3.2 半初始化对象是怎么被别的线程看到的

有了 c → b 重排后的 DCL：

```java
public class Singleton {
    private static Singleton instance;   // ⚠️ 没加 volatile

    public static Singleton getInstance() {
        if (instance == null) {
            synchronized (Singleton.class) {
                if (instance == null) {
                    instance = new Singleton();   // a → c → b 重排
                }
            }
        }
        return instance;
    }
}
```

失败时序：

```text
时间 →
线程 A（正在创建）                    线程 B（后来者）
──────────────                       ──────────────
a. 分配内存
c. instance = 新地址                
                                     外层 if (instance == null)
                                     → 判 false
                                     return instance   ← 半成品！
b. 执行构造函数                       访问 instance 字段 → 全部是 0 / null
```

关键在于**外层 `if` 的读根本没有进临界区**。线程 B 从 `instance` 读到的引用是"已赋值、未构造"的中间状态。

### 3.3 `volatile` 关掉这一段重排

给 `instance` 加 `volatile`：

```java
private static volatile Singleton instance;
```

`volatile` 写前会插入 `StoreStore` 屏障（§5.2.2）。这条屏障禁止"构造函数中的普通写"重排到"引用赋值"之后——**步骤 b 必须早于步骤 c 完成**。同时 `volatile` 写的 `StoreLoad` 让这次写的结果对其他线程立刻可见。

推导修复后的正确性用 §4.4 的 happens-before：

```text
线程 A（写端）：
  b. 字段初始化   ──程序顺序 hb──►   c. volatile 写 instance

线程 B（读端）：
  外层 if (instance == null)（volatile 读）  ──程序顺序 hb──►  访问 instance 字段

由 volatile 规则：A 的 volatile 写  hb  B 的 volatile 读
由传递性：           b. 字段初始化   hb   B 访问字段
结论：B 拿到的 instance 一定构造完成
```

修复的本质不是"volatile 强制刷缓存"这种模糊说法，而是**用 `StoreStore` 关掉了 b/c 之间的重排，用 volatile 写-读的 happens-before 把这个顺序传递给了读端**。

## 4. `volatile` 的能力边界

上面全部展示了 `volatile` 能做什么。生产上更容易踩坑的是它做不到的事。

### 4.1 `count++` 为什么撑不住

`count++` 在字节码层面是三步：

```text
getstatic  count      // 1. 读
iconst_1              // 2. 常量 1
iadd                  // 3. 加
putstatic  count      // 4. 写
```

`volatile` 保证的是**每一步单独的可见性**——不是三步一起的原子性。两条线程并发执行时：

```text
时间 →
线程 A:  [读 count=0] ───────────────── [算 0+1=1] ─ [写 count=1]
线程 B:  ─── [读 count=0] ─ [算 0+1=1] ─ [写 count=1] ─────────

主内存:  count=0 ─────────────────────────────────── count=1
```

两条线程都读到 `0`，各自加 1 后写回 `1`。最终 `count` 只加了 1，丢了一次自增。`volatile` 的可见性反而放大了问题——两条线程读到的都是"最新的相同值"，都以为自己做的是正确的自增。

结论：**`volatile` 支撑不了任何"读-改-写"复合操作**。

### 4.2 `check-then-act` 同样不行

不止 `count++`。所有形如"先读一下，根据读的结果再写"的模式都不能只靠 `volatile`：

```java
// ❌ 判断和赋值分成两步，中间可能被打断
volatile Config config;

public void updateIfNull(Config c) {
    if (config == null) {         // check
        config = c;                // then act
    }
    // 两个线程同时通过 check，各自做了一次 act
}
```

修复要么用 `synchronized`、要么用 `AtomicReference.compareAndSet`（第 7 章展开）。

### 4.3 `volatile` 只保护引用本身，不保护指向的对象

```java
// ❌ 引用是 volatile，指向的 ArrayList 不是线程安全的
volatile List<String> list = new ArrayList<>();

// 线程 A
list.add("hello");        // ArrayList.add 内部不是线程安全

// 线程 B
list.get(0);              // 可能抛 IndexOutOfBoundsException
```

`volatile List` 只保证"`list` 这个引用变量被替换时"新引用对其他线程立刻可见——比如 `list = new ArrayList<>()` 这样的重新赋值。它**完全不管** `list` 内部的字段并发访问。要线程安全的列表：`CopyOnWriteArrayList` 或 `Collections.synchronizedList`（第 9 章展开）。

### 4.4 能力边界总表

| 能力 | 结论 | 说明 |
| :-- | :-- | :-- |
| 单变量可见性 | ✅ | 一线程写，其他线程立即看到最新值 |
| 单变量有序性 | ✅ | 屏障禁止相关重排 |
| 复合操作原子性 | ❌ | `i++` / `check-then-act` 仍会竞态 |
| 临界区互斥 | ❌ | 不能替代锁保护一段代码 |
| 引用指向对象内部的并发安全 | ❌ | 只保护引用变量本身 |
| 数组元素的可见性 | ❌ | `volatile int[] arr` 只保护 `arr` 引用，不保护 `arr[i]`（要用 `AtomicIntegerArray`） |

### 4.5 `long` / `double` 的特殊性

JMM 规范里有一条容易被忽略的细节：**普通 `long` / `double` 的读写在 32 位 JVM 上不保证原子**——它可能被拆成两次 32 位的操作，读端读到"高位来自旧值、低位来自新值"的撕裂结果。

`volatile long` / `volatile double` 明确要求原子读写，即便在 32 位平台上也不会撕裂。在 64 位 JVM 上这两种类型的普通读写虽然事实上是原子的，但**规范并不强制**——写代码时依赖 JMM 明确保证的路径最稳。

## 5. `volatile` 的三个正确场景

理解了边界，正确使用场景就自然浮现。三种都是 JDK 源码里反复出现的形态。

### 5.1 停机标志（一写多读）

§5.1.1 的 `running` 就是这类：

```java
private volatile boolean running = true;
```

判断标准很直接：**只有一条线程写，多条线程读**。此时不存在"多个线程同时写导致竞态"的问题，`volatile` 天然够用。

### 5.2 DCL 单例（防重排 + 安全发布）

§5.3 的完整案例。这里 `volatile` 同时承担两件事：

- 防止 `new Singleton()` 的构造重排到引用发布之后
- 让完成构造的对象通过 volatile 写-读的 happens-before 传递给读端

现代 JDK 里更简洁的替代是 **静态内部类** 模式（借助类初始化锁完成安全发布，见第 4 章 §4.5.3）。但 DCL 仍是理解 `volatile` 语义的最佳案例。

### 5.3 安全发布配置对象

热更新场景常用：

```java
public class ConfigHolder {
    private volatile Config current;

    public void update(Config newConfig) {
        current = newConfig;             // volatile 写发布
    }

    public Config snapshot() {
        return current;                   // volatile 读订阅
    }
}
```

前提是 **`Config` 是不可变对象**——所有字段 `final`、构造完成后不再修改。这样：

- `Config` 的字段由 `final` 语义保证初始化安全（第 4 章 §4.5.1）
- 引用发布由 `volatile` 保证可见性
- 后续所有线程通过 `snapshot()` 拿到的都是"完整构造 + 立刻可见"的对象

如果 `Config` 内部字段还会被修改，`volatile` 就守不住了——`Config` 内部的修改不在 `volatile` 的保护范围里。

### 5.4 `volatile` + CAS：`AtomicInteger` 的组合

`volatile` 在 `java.util.concurrent.atomic` 里几乎无处不在。它和 CAS 的分工非常清晰：

```java
public class AtomicInteger {
    private volatile int value;                     // 可见性

    public final int incrementAndGet() {
        return U.getAndAddInt(this, VALUE, 1) + 1;  // 原子性来自 CAS
    }
}
```

- **`volatile`**：让 `value` 的最新写立即被其他线程看到——CAS 才能读到当前值
- **CAS**：把"读当前值 + 判等 + 写新值"合并成一步硬件级原子操作，弥补 `volatile` 不解决的复合原子性

`AtomicInteger` 的完整机制在第 7 章展开。

## 6. `volatile` 与 `synchronized` 的选型

`volatile` 和 `synchronized` 常被拿来对比。它们不在同一层。

### 6.1 三维对比

| 维度 | `volatile` | `synchronized` |
| :-- | :-- | :-- |
| 保护粒度 | 单个变量的读写 | 一段临界区 |
| 可见性 | ✅ | ✅ |
| 有序性 | ✅（周围重排被约束） | ✅（happens-before by unlock/lock） |
| 原子性 | ❌ 仅单次读或单次写 | ✅ 整段代码 |
| 阻塞 | ❌ 不阻塞 | ✅ 竞争时阻塞 |
| 死锁风险 | ❌ | ✅ 需要小心持锁顺序 |
| 单次操作成本 | 低（一条屏障或几条屏障） | 中 → 高（走 JVM 锁升级路径） |

### 6.2 什么时候用 `volatile`

- 只有一个线程写，其他线程读
- 需要发布一个不可变对象或状态变化的信号
- 需要防止 DCL 里的构造重排
- 作为原子类的可见性基础（`AtomicXxx` 内部）

### 6.3 什么时候用 `synchronized`

- 需要复合操作原子性（读-改-写）
- 多个线程同时写同一个字段
- 保护一段临界区，而不是单个变量
- 需要在临界区内做条件等待（配合 `wait/notify`）

选型规则的一条简短版本：**只发布不修改，用 `volatile`；要修改，用 `synchronized` 或原子类**。

### 6.4 两个都用的常见组合

生产代码里两者经常同时出现：

```java
public class TokenBucket {
    private final Object lock = new Object();
    private volatile long lastRefillNanos;         // 最近一次填充时间
    private long tokens;                            // 当前令牌（在锁保护下）

    public boolean tryAcquire() {
        synchronized (lock) {
            refill();
            if (tokens > 0) { tokens--; return true; }
            return false;
        }
    }

    // 只用于监控读，不参与竞争
    public long readLastRefillNanos() {
        return lastRefillNanos;
    }
}
```

`tokens` 需要复合更新，走 `synchronized`；`lastRefillNanos` 只作为一个"发布点"给监控读，走 `volatile` 让监控不必抢锁。这种"临界区管修改，volatile 管旁路读"的模式，在框架代码里非常常见。

## 7. 本章小结

| 问题 | 根源 | 解决方案 |
| :-- | :-- | :-- |
| 停机标志被 JIT 提升出循环 | 编译器优化 + 缓存驻留 | `volatile` 强制每次从主内存读 |
| DCL 半初始化对象泄漏 | 构造与引用赋值的重排 | `volatile` 的 `StoreStore` 屏障关掉这段重排 |
| `count++` 用 `volatile` 仍出错 | 复合操作非原子 | 换 `synchronized` 或 `AtomicInteger` |
| `volatile List` 内部不安全 | 只保护引用变量本身 | 用并发容器 |
| 32 位平台 `long` 撕裂 | 普通 `long` 非原子 | `volatile long` 或 `AtomicLong` |
| 高频写变量竞争严重 | `StoreLoad` 屏障成本高 | 分散写热点（`LongAdder`）或缩窄临界区 |
