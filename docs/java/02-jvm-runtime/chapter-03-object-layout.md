# HotSpot 对象布局

一个 Java 对象由对象头、实例字段和对齐填充组成。本文以 **64 位 OpenJDK 21.0.12.1 HotSpot** 为基线，解释如何计算对象大小、字段为什么不会按声明顺序排列，以及 Mark Word 如何复用同一批位来保存哈希、分代年龄和锁状态。

以下计算固定使用 `-XX:+UseCompressedClassPointers`、`-XX:+UseCompressedOops` 和 `-XX:ObjectAlignmentInBytes=8`。不同 JVM、CPU 架构或启动参数会得到不同结果，实际值以目标 JVM 的输出为准。

## 1. new 一个对象发生了什么 {#object-creation}

```java
User user = new User();
```

执行 `new User()` 时，HotSpot 需要保证 `User` 已完成创建实例所需的类准备工作，并遵守类初始化规则（详见[类加载与初始化](./chapter-01-bytecode-classloading.md#initialization)）。对象分配完成后，实例字段必须具有 Java 规定的默认值（`int` 为 0、`boolean` 为 false、引用为 null），运行时还要写入对象头中的 Mark Word 和 Klass Pointer。随后执行构造方法 `<init>`，完成实例字段的显式初始化。

常见的 TLAB 快速路径只需推进线程本地分配指针，但这不意味着所有对象都只走这一条路径。TLAB 耗尽后，HotSpot 可能申请新的 TLAB，也可能走慢路径；较大的对象还可能绕过 TLAB 直接分配。具体路径取决于对象大小、当前堆状态和 JVM 实现。TLAB 和 Eden 分配机制见[运行时数据区与内存结构](./chapter-02-runtime-data-areas.md)。

## 2. new Object() 为什么是 16 字节 {#object-size}

在本文的基线配置下，`new Object()` 没有实例字段，大小由对象头和最终填充决定：

```txt
Mark Word             8 字节
压缩后的 Klass Pointer 4 字节
实例字段              0 字节
尾部填充              4 字节
--------------------------------
对象总大小            16 字节
```

先按字段对齐规则确定每个字段的起始偏移，计算字段布局的结束位置，字段之间的空洞也要计入；最后将整个对象大小向上对齐到 `ObjectAlignmentInBytes` 的整数倍：

```txt
对象大小 = align_up(字段布局结束位置, ObjectAlignmentInBytes)
```

关闭压缩类指针后，Klass Pointer 变为 8 字节，`new Object()` 仍是 16 字节。这说明压缩指针改变的是头部结构，不一定改变每一种对象的最终大小；真正是否减少内存，要看字段和填充是否一起减少。

## 3. 普通对象如何排布

64 位 HotSpot 中，普通实例的基本结构如下：

```txt
字节偏移
0            8                 12                 16
+------------+-----------------+------------------+
| Mark Word  | Klass Pointer   | 实例字段或填充     |
|  8 字节     | 4 字节（压缩）    | 从偏移 12 开始    |
+------------+-----------------+------------------+
                                   ↑
                     字段自身仍要满足类型对齐
```

### 3.1 对象头保存什么

对象头包含两部分：

- **Mark Word**：64 位 HotSpot 固定占 8 字节，保存 identity hash、分代年龄和锁状态等可复用信息。
- **Klass Pointer**：指向类元数据，让 HotSpot 判断对象的实际类型。启用压缩类指针时占 4 字节，否则占 8 字节。

类的 `static` 字段不属于对象实例，因此不会出现在这里。实例对象只保存当前类和父类的非静态字段。

### 3.2 压缩类指针与压缩引用不是一回事

两个开关压缩的是不同数据：

| 开关 | 压缩对象 | 对布局的影响 |
| :-- | :-- | :-- |
| `-XX:+UseCompressedClassPointers` | 对象头中的 `Klass*` | Klass Pointer 从 8 字节变为 4 字节 |
| `-XX:+UseCompressedOops` | 引用字段和引用数组元素 | `Object` 引用从 8 字节变为 4 字节 |

在常见的 64 位 HotSpot 配置中，压缩类指针和压缩普通对象指针通常会启用，但实际值受 JVM 版本、堆配置和启动参数影响。不要根据操作系统位数或参数名称推断当前进程的布局；以目标 JVM 的 `-XX:+PrintFlagsFinal` 输出为准。

压缩类指针留下的 4 字节并不总是尾部填充：

- 普通实例可以把一个 `int` 或压缩引用放入偏移 12 的位置。
- 数组头本身包含 `length` 字段。在本文的压缩类指针配置下，Klass Pointer 占 4 字节、`length` 紧随其后，因此元素区从偏移 16 开始。这是布局结果，不是运行时把原本空闲的字段临时拿来复用。

### 3.3 实例字段按对齐和空洞排列

以下对齐要求用于理解本文讨论的 HotSpot 布局示例，不是 Java 语言规范规定的跨 JVM 对象布局协议；具体字段偏移应以目标 JVM 的实际布局为准。

| 字段类型 | 大小 | 对齐要求 |
| :-- | :-- | :-- |
| `boolean`、`byte` | 1 字节 | 1 字节 |
| `char`、`short` | 2 字节 | 2 字节 |
| `int`、`float`、压缩引用 | 4 字节 | 4 字节 |
| `long`、`double`、未压缩引用 | 8 字节 | 8 字节 |

HotSpot 会根据字段类型、大小和继承布局安排实例字段，并可能利用父类布局中的空洞。字段在内存中的顺序不必与源码声明顺序一致，父类字段也不保证全部位于子类字段之前。需要知道某个类的准确偏移时，应查看目标 JVM 的布局结果，而不是仅根据字段声明顺序或类型大小推算。`@Contended` 可以用于减少特定字段之间的伪共享，但其布局效果受 HotSpot 实现及相关参数影响，不能仅凭注解出现在源码中就推断最终增加的填充字节数。

以基线配置为例：

```java
class Empty {}
class OneInt { int value; }
class OneLong { long value; }
class TwoInts { int first; int second; }
class OneRef { Object value; }
```

| 类 | 布局计算 | 大小 |
| :-- | :-- | --: |
| `Empty` | 12 字节头部 + 4 字节尾部填充 | 16 字节 |
| `OneInt` | 12 字节头部 + 4 字节 `int` | 16 字节 |
| `OneLong` | 12 字节头部 + 4 字节对齐空洞 + 8 字节 `long` | 24 字节 |
| `TwoInts` | 12 字节头部 + 2 × 4 字节 `int` + 4 字节尾部填充 | 24 字节 |
| `OneRef` | 12 字节头部 + 4 字节压缩引用 | 16 字节 |

如果关闭压缩引用，`OneRef` 的引用字段占 8 字节，大小变为 24 字节。具体偏移属于 HotSpot 实现细节，不能作为跨版本 API；需要核对偏移时，应在目标 JVM 上测量。

### 3.4 对齐填充解决什么问题

在本文配置下，HotSpot 将对象大小按 8 字节对齐。这个限制决定了对象尾部可能出现填充；字段自身的对齐要求则决定了字段之间是否需要空洞。两种填充发生的位置不同，计算时都必须考虑。

因此，两个字段的声明大小之和通常不等于实例数据区大小。例如，`OneLong` 的头部结束于偏移 12，而 `long` 必须从 8 的倍数开始，所以偏移 12 到 16 之间必须填充。

## 4. 数组对象如何排布

数组对象在普通对象头之后还要保存 `length`。在本文的压缩类指针配置下：

```txt
0            8          12       16
+------------+----------+--------+----------------------+
| Mark Word  | Klass    | length | 元素 0, 元素 1, ...   |
|  8 字节     | 4 字节   | 4 字节  | 从偏移 16 开始        |
+------------+----------+--------+----------------------+
```

在本文的压缩类指针配置下，数组元素从偏移 16 开始，数组总大小按下式计算：

```txt
数组大小 = align_up(16 + 数组长度 × 元素大小, ObjectAlignmentInBytes)
```

这个简化公式只适用于本文给定的数组头布局。切换压缩类指针、对象对齐参数或 JVM 实现后，应重新确认数组头大小与元素起始偏移再计算总大小，不要直接沿用常数 16。

基线配置下的例子：

| 表达式 | 计算 | 大小 |
| :-- | :-- | --: |
| `new byte[1]` | `align_up(16 + 1, 8)` | 24 字节 |
| `new int[3]` | `align_up(16 + 12, 8)` | 32 字节 |
| `new long[3]` | `align_up(16 + 24, 8)` | 40 字节 |
| `new Object[3]` | `align_up(16 + 3 × 4, 8)` | 32 字节 |

关闭压缩引用时，`Object[]` 的每个元素由 4 字节变为 8 字节，`new Object[3]` 变为 40 字节；基本类型数组不变。关闭压缩类指针会改变数组头，所有数组都需要重新计算。

## 5. Mark Word 如何编码锁状态 {#mark-word-states}

Mark Word 不是一块固定字段，而是一组按状态复用的位。本节只解释对象头如何编码状态，不展开线程竞争、锁膨胀和解锁的完整过程；这些过程需要结合锁记录、Monitor 和具体 JDK 版本理解。OpenJDK 21 的 64 位普通对象格式为：

```txt
位范围       63..39       38..8       7       6..3       2       1..0
字段         unused:25    hash:31     gap     age:4      gap     lock:2
```

- `hash` 区域用于保存对象的 identity hash。该值尚未生成或尚未写入对象头时，对应位可以为 0。调用对象重写后的 `hashCode()` 不一定会生成 identity hash；需要获取对象身份哈希时，使用 `System.identityHashCode(obj)`。身份哈希与业务哈希值不是同一个概念。
- `age` 占 4 位，保存对象的分代年龄，取值范围 0～15。在采用分代回收的收集器中，对象在年轻代回收中存活后，年龄通常会增长；达到有效晋升阈值后，对象可能晋升到老年代。`MaxTenuringThreshold=15` 是上限，实际阈值还受收集器配置和 Survivor 区使用情况影响，不保证所有对象都恰好在同一年龄晋升。
- 最低两位 `lock` 标识对象头当前采用的状态，它是状态的标记，不是完整的锁实现说明：

| `lock` | 状态 | 含义 |
| :-- | :-- | :-- |
| `01` | 普通对象头 | 未处于轻量级锁定或 Monitor 膨胀状态，保存 identity hash、分代年龄 |
| `00` | 轻量级锁定状态 | 传统栈锁实现中，对象头关联线程栈上的锁记录，原 Mark Word 保存在 displaced header 中；其他实现以对应版本为准 |
| `10` | Monitor 膨胀状态 | Mark Word 中保存与 `ObjectMonitor` 关联的信息 |
| `11` | 标记状态 | 用于 GC 等运行时操作，不是对象保持的普通业务状态 |

Mark Word 的位会随对象状态改变含义，因此不能把普通状态下的位布局直接套用到锁定状态。HotSpot 必须在轻量级锁记录或膨胀后的 Monitor 等结构中保留必要的对象头信息，才能在解锁或恢复对象头时维持对象原有的身份哈希等语义。具体信息保存在哪里，取决于所用 JDK 的锁实现。

偏向锁属于历史实现，不进入本文的 OpenJDK 21 基线。旧版 HotSpot 的 Mark Word 格式可能包含偏向锁标记，并在偏向状态下保存线程标识和 Epoch。OpenJDK 8u504 的 64 位格式含 `biased_lock` 位；OpenJDK 17 仍接受 `-XX:+UseBiasedLocking`，但会提示该选项自 15 起已弃用；OpenJDK 21.0.12.1 的 HotSpot 源码不再包含偏向锁格式。

锁记录、Monitor 膨胀和锁升级的运行过程见 [`synchronized` 锁优化](../03-java-concurrency/chapter-06-synchronized.md#synchronized-lock-optimization)。

## 6. 如何核对目标 JVM 的布局 {#verify-layout}

先核对决定布局的参数：

```bash
java -XX:+PrintFlagsFinal -version
```

重点检查以下输出是否与预期一致：

```txt
bool  UseCompressedClassPointers  = true
bool  UseCompressedOops           = true
int   ObjectAlignmentInBytes      = 8
```

需要查看具体偏移和字段间距时，使用 [OpenJDK JOL](https://github.com/openjdk/jol)：

```bash
java -jar /path/to/jol-cli-full.jar internals java.lang.Object
java -jar /path/to/jol-cli-full.jar internals com.example.User
```

查看自定义类之前，先编译该类并确保它位于当前 classpath 或 JOL 能访问的类路径中。`com.example.User` 是示例类名，需替换成实际类名；如果类依赖其他类型，也要确保相应依赖可用。

JOL 必须运行在与目标布局一致的 JVM 配置上，它输出的是当前进程的测量结果，不是跨版本保证。同理，`-XX:+PrintFlagsFinal` 要对应目标应用实际使用的 JVM 参数；单独运行不带应用参数的 `java -XX:+PrintFlagsFinal -version`，只能说明这次命令启动的 JVM 配置，不一定代表线上进程。

`-XX:+PrintFieldLayout` 只存在于 HotSpot 的 debug 或 notproduct 构建中；普通发行版会提示该选项不可用，不能把它当作通用布局检查命令。

> 版本依据：布局计算核对 OpenJDK `jdk-21.0.12.1-ga` 中的 `markWord.hpp`、`instanceOop.hpp`、`arrayOop.hpp`、`fieldLayoutBuilder.cpp` 和 `globals.hpp`；偏向锁历史格式对照 `jdk8u504-ga` 中的 `markOop.hpp`，核对日期为 2026-10-09。

> 本章解释对象在堆中的实际排布。对象分配区域和 TLAB 见[运行时数据区与内存结构](./chapter-02-runtime-data-areas.md)，Mark Word 如何服务 GC 见[垃圾回收](./chapter-04-gc.md)，锁状态的运行方式见 [`synchronized` 锁优化](../03-java-concurrency/chapter-06-synchronized.md#synchronized-lock-optimization)。
