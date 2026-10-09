# HotSpot 对象布局

`new Object()` 占多少字节，取决于对象头、实例字段和对齐填充。本章解释 HotSpot 如何组织这三部分，以及对象头中的 Mark Word 如何随锁状态变化。目标不是记住一组随 JVM 版本和配置变化的数字，而是看到对象布局后能说明每个字段的用途。

## 1. new 一个对象发生了什么 {#object-creation}

```java
User user = new User();
```

JVM 执行的操作：

1. 检查 `User` 类是否已经加载，必要时先完成类加载。
2. 在堆中分配对象内存。TLAB 内使用指针碰撞分配；TLAB 耗尽后可能需要 CAS。
3. 将实例字段初始化为零值：`int` 为 0，`boolean` 为 false，引用为 null。
4. 写入对象头，包括 Mark Word 和 Klass Pointer。
5. 执行构造方法 `<init>`，把字段初始化为程序指定的值。

![new User() 的五步对象创建流程](/java/jvm-object-creation.svg)

第 3 步保证字段在使用前已有确定的零值，避免读到未初始化的内存；第 5 步才执行开发者编写的构造逻辑。

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
- **锁状态**：无锁、偏向锁（启用时）、轻量级锁、重量级锁

### 2.2 Klass Pointer

指向方法区中该类的元数据。JVM 通过 Klass Pointer 知道"这个对象是哪个类的实例"。

64 位 HotSpot 中，开启 `-XX:+UseCompressedClassPointers` 后，Klass Pointer 只占 4 字节；OpenJDK 21 默认启用该开关。它与压缩对象引用的 `-XX:+UseCompressedOops` 是两个不同开关，实际生效值可用 `-XX:+PrintFlagsFinal` 核对。

### 2.3 实例字段与字段排列

实例数据区保存当前类和父类的字段值。字段占用空间由字段类型决定：`int`、`float` 和引用通常占 4 字节，`long`、`double` 占 8 字节；引用是否压缩还受 `-XX:+UseCompressedOops` 和堆地址范围影响。字段顺序和最终偏移量属于 HotSpot 实现细节，不应把某个示例对象的字段偏移当作跨版本保证。

### 2.4 对齐填充与数组对象

HotSpot 默认按 8 字节对齐对象总大小，因此字段区末尾可能增加填充字节，使对象大小成为 8 的整数倍。数组对象除对象头外还要保存数组长度和元素数据，具体头大小与压缩指针、元素类型有关；元素区同样按 HotSpot 的对齐规则排列。

## 3. Mark Word 与锁状态

Mark Word 不是固定不变的。当对象被同步操作时，Mark Word 的内容会根据锁状态变化。

64 位 HotSpot JVM 在**启用偏向锁**时的 Mark Word 位布局：

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
| 无锁（默认） | hashCode + 分代年龄，`biased_lock=0` | 01 |
| 偏向锁（启用时） | ThreadID(54bit) + Epoch(2bit) + 分代年龄 | 01 |
| 轻量级锁 | 指向栈中锁记录的指针 | 00 |
| 重量级锁 | 指向 Monitor 的指针 | 10 |
| GC 标记 | 空 | 11 |

这是 [`synchronized` 锁升级机制](../03-java-concurrency/chapter-06-synchronized.md)的关键前置知识。是否经过偏向锁取决于 JVM 版本和配置；JDK 17 已默认关闭 `-XX:+UseBiasedLocking`。Mark Word 的变化过程如下：

```txt
启用偏向锁：无锁 → 偏向锁 → 轻量级锁 → 重量级锁
JDK 17 默认：无锁 → 轻量级锁 → 重量级锁
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

### 3.2 wait/notify 与 Monitor 队列

`wait()` 让持有锁的线程释放 Monitor 并进入等待集，`notify()` 只是把一个等待线程移回入口集；该线程仍要重新竞争锁后才能从 `wait()` 返回。因此调用方必须持有对象锁，并用 `while` 重新检查条件。队列转换、虚假唤醒和锁升级的完整流程见 [`synchronized` 与 Monitor](../03-java-concurrency/chapter-06-synchronized.md)。

Monitor 是重量级数据结构，通常依赖操作系统 Mutex。只有竞争持续存在时，JVM 才会把它升级到重量级锁；启用偏向锁的配置还会经历额外阶段。

> 本章解释了对象的内存布局和对象头在锁状态下的变化。下一章进入[垃圾回收](./chapter-04-gc.md)，解释 JVM 如何识别和回收不再使用的对象；线程分配与逃逸优化分别见[运行时数据区](./chapter-02-runtime-data-areas.md)和[JIT 编译](./chapter-05-jit.md)，Monitor 的使用方式可继续对照 [`synchronized`](../03-java-concurrency/chapter-06-synchronized.md)。
