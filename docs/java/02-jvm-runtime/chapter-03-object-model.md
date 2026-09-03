# 对象模型

> 面试官问：`new Object()` 占多少字节？你说 16 字节——说得不错。但加上 `int` 字段就是 16 还是 24？加上引用字段呢？数组头比对象头多了哪 4 个字节？对齐填充什么时候触发？HotSpot 默认 8 字节对齐——你的 Object 到 new Object() 之间，有一整套内存布局规则。这章的目标不是让你背数字，是让你能对着 JOL 输出说清楚每一 bit 在干什么。

## 1. new 一个对象发生了什么

```java
User user = new User();
```

JVM 执行的操作：

![jvm-object-layout](/java/jvm-object-layout.svg)

步骤 3 保证了 Java 的安全特性——字段在使用前一定有确定的值，不会读到脏数据。

## 2. 对象内存布局

HotSpot JVM 中，一个 Java 对象在堆中的结构：

```txt
┌──────────────────┐
│     对象头        │
│  ├─ Mark Word     │  8 字节（64 位 JVM）
│  └─ Klass Pointer │  4 或 8 字节（压缩指针开启时 4 字节）
├──────────────────┤
│     实例数据      │  各个字段的值（父类字段在前，子类在后）
├──────────────────┤
│     对齐填充      │  保证对象大小是 8 字节的整数倍
└──────────────────┘
```

### 2.1 Mark Word

Mark Word 是对象头的核心，存储了：

- **hashCode**：对象的哈希码（首次调用 `hashCode()` 时计算并存储）
- **GC 年龄**：对象经历的 Minor GC 次数（达到阈值晋升老年代）
- **锁状态**：无锁、偏向锁、轻量级锁、重量级锁

### 2.2 Klass Pointer

指向方法区中该类的元数据。JVM 通过 Klass Pointer 知道"这个对象是哪个类的实例"。

开启压缩指针（`-XX:+UseCompressedOops`，64 位 JVM 默认开启）时，Klass Pointer 只占 4 字节。

## 3. Mark Word 与锁状态

Mark Word 不是固定不变的。当对象被同步操作时，Mark Word 的内容会根据锁状态变化。

64 位 JVM 中 Mark Word 的位布局：

```txt
64 位 Mark Word（共 64 bit）:
┌───────────────────────────────────────────────────────────────┐
│  unused:25 │ hash:31 │ age:4 │ biased_lock:1 │ lock:2        │
│  (25 bit)  │ (31 bit)│(4 bit)│   (1 bit)     │ (2 bit)       │
└───────────────────────────────────────────────────────────────┘

lock 标志位: 01=无锁/偏向, 00=轻量级锁, 10=重量级锁, 11=GC 标记
biased_lock: 1=启用偏向锁, 0=未启用
age: 对象经历的 Minor GC 次数, 达到阈值(默认15)晋升老年代
hash: 对象的 hashCode (首次调用 hashCode() 时计算并存储)
```

注意：当对象被加锁后，Mark Word 的内容会被覆盖——hashCode 和分代年龄的空间被用来存储锁信息。这就是为什么**加锁的对象调用 hashCode() 时需要特殊处理**（轻量级锁从栈帧的锁记录中恢复，重量级锁存储在 Monitor 中）。

不同锁状态下 Mark Word 的内容：

| 锁状态 | Mark Word 内容 | 标志位 |
| :-- | :-- | :-- |
| 无锁 | hashCode + 分代年龄 | 01 |
| 偏向锁 | ThreadID(54bit) + Epoch(2bit) + 分代年龄 | 01 |
| 轻量级锁 | 指向栈中锁记录的指针 | 00 |
| 重量级锁 | 指向 Monitor 的指针 | 10 |
| GC 标记 | 空 | 11 |

这是第三卷 `synchronized` 锁升级机制的关键前置知识。锁升级的过程就是 Mark Word 内容不断变化的过程：

```txt
无锁 → 偏向锁（同一线程反复获取）
     → 轻量级锁（CAS 竞争失败但自旋可期）
     → 重量级锁（自旋超时，依赖 OS Mutex）
```

### 3.1 Monitor（监视器）

当锁升级到重量级锁时，Mark Word 中存储的是指向 **Monitor** 对象的指针。Monitor 是 JVM 实现互斥同步的底层数据结构，每个 Java 对象都可以关联一个 Monitor：

```txt
┌─────────────────────────────────┐
│          Object Monitor         │
│                                 │
│  _owner: Thread   (持有锁的线程) │
│  _count: int      (重入次数)     │
│  _EntryList: [Thread...]        │
│             (等待获取锁的线程队列) │
│  _WaitSet: [Thread...]          │
│            (调用了 wait() 的线程) │
└─────────────────────────────────┘
```

工作流程：

1. **获取锁**（monitorenter）：如果 `_owner` 为空，当前线程成为 `_owner`，`_count` 设为 1。如果已经是 `_owner`，`_count++`（可重入）。
2. **释放锁**（monitorexit）：`_count--`。当 `_count` 为 0 时，释放 Monitor，`_EntryList` 中的一个线程被唤醒。
3. **等待/通知**（wait/notify）：线程调用 `wait()` 后进入 `_WaitSet` 并释放 Monitor。`notify()` 从 `_WaitSet` 唤醒一个线程，该线程需重新竞争 Monitor。

### 3.2 wait/notify 的完整流程

很多人觉得 `wait/notify` 就是“等一下”和“醒一醒”。没那么简单。它们是 Monitor 机制的一部分，操作路径比大多数人想的要复杂——线程从 `wait()` 到真正重新执行，中间要经过三个队列的转换。

```txt
线程 A 调用 obj.wait():
  1. 线程 A 必须是 obj 的 Monitor 的 _owner（必须持有锁）
  2. 线程 A 释放 Monitor（_owner = null, _count = 0）
  3. 线程 A 进入 _WaitSet（等待被 notify）
  4. 线程 A 变为 WAITING 状态

线程 B 调用 obj.notify():
  1. 线程 B 必须是 obj 的 Monitor 的 _owner
  2. 从 _WaitSet 中取出一个线程（如线程 A）
  3. 线程 A 从 _WaitSet 移到 _EntryList
  4. 线程 A 变为 BLOCKED 状态（等待重新获取锁）
  5. 线程 B 释放 Monitor 后，_EntryList 中的线程竞争锁
  6. 线程 A 重新成为 _owner，从 wait() 返回
```

关键点：`notify()` 后线程不会立即执行——它从 `_WaitSet` 移到 `_EntryList`，需要重新竞争锁。这就是为什么 `wait()` 必须在 `synchronized` 块中调用，并且通常用 `while` 循环检查条件：

```java
synchronized (obj) {
    while (!condition) {   // 用 while 而非 if，防止虚假唤醒
        obj.wait();
    }
    // 条件满足，继续执行
}
```

Monitor 是重量级的数据结构，依赖操作系统的 Mutex 实现。这就是为什么 JVM 默认不直接使用它，而是先尝试偏向锁和轻量级锁——只有在竞争激烈时才升级到重量级锁。第三卷 `synchronized` 章节会详细展开锁升级的完整过程。

## 4. TLAB（线程本地分配缓冲）

多线程环境下，多个线程同时在 Eden 区分配对象需要同步。TLAB 解决了这个问题：

- 每个线程在 Eden 区有一块**私有缓冲区**
- TLAB 内分配只需要移动指针，**无需 CAS**
- TLAB 用完才需要同步申请新缓冲区

```txt
Eden 区
├── TLAB for Thread A  [已用: 3KB / 总共: 8KB]
├── TLAB for Thread B  [已用: 1KB / 总共: 8KB]
└── TLAB for Thread C  [已用: 5KB / 总共: 8KB]
```

`-XX:+UseTLAB` 默认开启。这就是为什么 Java 多线程创建对象这么快——大部分情况下不需要真正的同步。

### 4.1 TLAB 的关键参数

| 参数 | 默认值 | 说明 |
| :-- | :-- | :-- |
| `-XX:+UseTLAB` | 开启 | 是否使用 TLAB |
| `-XX:TLABSize` | 自适应 | 单个 TLAB 的初始大小 |
| `-XX:MinTLABSize` | 2KB | TLAB 最小大小 |
| `-XX:TLABRefillWasteFraction` | 64 | TLAB 浪费比例阈值 |
| `-XX:+ResizeTLAB` | 开启 | 允许 JVM 动态调整 TLAB 大小 |

TLAB 有一个"碎片化"问题：TLAB 内部用指针碰撞分配对象，当剩余空间不够下一个对象时，剩余空间被浪费（padding 填充）。`TLABRefillWasteFraction` 控制浪费的容忍度——如果浪费比例超过阈值，JVM 会申请一个新的 TLAB，而不是在剩余空间中硬塞。`-XX:+ResizeTLAB` 让 JVM 根据线程的分配速率动态调整 TLAB 大小，分配速率高的线程获得更大的 TLAB。

## 5. 逃逸分析

逃逸分析是 JIT 编译器的一种分析技术，判断对象是否"逃逸"出方法或线程的范围。

### 5.1 什么是逃逸

```java
// 未逃逸：对象只在方法内部使用
public void process() {
    User user = new User("Tom");  // user 不会离开这个方法
    System.out.println(user.getName());
}

// 逃逸：对象被外部引用
public User createUser() {
    User user = new User("Tom");
    return user;  // user 逃逸到了方法外部
}
```

### 5.2 未逃逸对象的三种优化

**1. 栈上分配。** 如果对象不逃逸，可以在栈帧上创建，方法结束时自动销毁，不需要 GC 回收。

**2. 标量替换。** 将对象拆散为基本类型标量：

```java
// 原始代码
Point p = new Point(1, 2);
int sum = p.x + p.y;

// 标量替换后（JIT 优化）
int x = 1, y = 2;
int sum = x + y;
// Point 对象完全消除了
```

**3. 锁消除。** 如果对象不逃逸出方法，不可能被其他线程访问，那么对它的同步操作可以安全去除。

这三种优化都依赖逃逸分析的结果。JIT 编译器会在编译时分析对象的使用范围，决定是否应用这些优化。

### 5.3 逃逸分析的局限

逃逸分析并非万能，有几个实际局限：

1. **栈上分配在 HotSpot 中实现不完善。** HotSpot 的 C2 编译器做逃逸分析后，真正走"栈上分配"路径的情况很少——大部分优化走的是标量替换（更彻底，连栈上的对象都不创建）。栈上分配需要 GC 配合（对象头需要特殊标记以区分栈上对象和堆对象），实现复杂度高。

2. **分析本身有开销。** 逃逸分析需要遍历方法的 IR（中间表示），对于大型方法可能增加编译时间。JVM 只对热点方法做逃逸分析。

3. **逃逸是保守估计。** 如果分析器无法确定对象是否逃逸（比如通过数组间接引用），会保守地认为逃逸，放弃优化。

4. **跨方法逃逸分析有限。** HotSpot 的逃逸分析主要在方法内进行，跨方法的分析能力有限。如果对象在方法 A 创建、传给方法 B 使用，即使方法 B 也不逃逸，也可能无法优化。

`-XX:+DoEscapeAnalysis` 默认开启，`-XX:+EliminateAllocations`（标量替换）默认开启，`-XX:+EliminateLocks`（锁消除）默认开启。一般不需要手动调整。

> 本章覆盖了对象从创建到消亡的完整生命周期。下一章将进入垃圾回收——JVM 如何自动识别和回收不再使用的对象。
