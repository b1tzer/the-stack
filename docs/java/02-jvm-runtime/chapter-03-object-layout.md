# HotSpot 对象布局

一个 Java 对象由对象头、实例字段和对齐填充组成。本文以 **64 位 OpenJDK 21.0.12.1 HotSpot** 为基线，解释如何计算对象大小、字段为什么不会按声明顺序排列，以及 Mark Word 如何复用同一批位来保存哈希、分代年龄和锁状态。

以下计算固定使用 `-XX:+UseCompressedClassPointers`、`-XX:+UseCompressedOops` 和 `-XX:ObjectAlignmentInBytes=8`。不同 JVM、CPU 架构或启动参数会得到不同结果，实际值以目标 JVM 的输出为准。

## 1. new 一个对象发生了什么 {#object-creation}

```java
User user = new User();
```

HotSpot 执行 `new` 时主要完成五步：

1. 检查 `User` 是否已经加载，必要时先完成类加载。
2. 计算实例大小，在堆中分配内存。TLAB 内通常只移动分配指针；TLAB 耗尽后才进入共享区竞争。
3. 将实例字段设置为零值：`int` 为 0、`boolean` 为 false、引用为 null。
4. 写入对象头，包括 Mark Word 和 Klass Pointer。
5. 执行构造方法 `<init>`，把字段初始化为程序指定的值。

第 3 步保证字段在构造方法执行前已有确定值，避免读取到未初始化的内存；第 5 步才执行开发者编写的初始化逻辑。TLAB 和 Eden 分配机制见[运行时数据区与内存结构](./chapter-02-runtime-data-areas.md)。

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

计算可以概括为：

```txt
对象大小 = align_up(字段布局结束位置, ObjectAlignmentInBytes)
```

字段布局决定字段的起始偏移和结束位置，`ObjectAlignmentInBytes` 再把对象总大小补齐到 8 的整数倍。

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

64 位 HotSpot 默认启用压缩类指针。压缩引用会根据堆地址空间等条件自动选择，因此不能只看参数名称就推断最终状态。使用 `java -XX:+PrintFlagsFinal -version` 查看目标 JVM 的实际值。

压缩类指针留下的 4 字节并不总是尾部填充：

- 普通实例可以把一个 `int` 或压缩引用放入偏移 12 的位置。
- 数组可以用这 4 字节保存 `length`，因此数组元素从偏移 16 开始。

### 3.3 实例字段按对齐和空洞排列

字段类型决定自身占用空间和对齐要求：

| 字段类型 | 大小 | 对齐要求 |
| :-- | :-- | :-- |
| `boolean`、`byte` | 1 字节 | 1 字节 |
| `char`、`short` | 2 字节 | 2 字节 |
| `int`、`float`、压缩引用 | 4 字节 | 4 字节 |
| `long`、`double`、未压缩引用 | 8 字节 | 8 字节 |

HotSpot 会先排列基本类型字段，再排列引用字段，并尝试复用继承布局中的空洞。因此，**字段声明顺序不是内存偏移顺序，父类字段也不保证全部位于子类字段之前**。`@Contended` 等注解还会主动插入填充。

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

HotSpot 默认要求对象起始地址和总大小按 8 字节对齐，原因是堆分配器、GC 和访问宽度都依赖稳定的字长边界。填充可能出现在字段之间，也可能位于对象末尾。

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

数组总大小按下式计算：

```txt
数组大小 = align_up(16 + 数组长度 × 元素大小, ObjectAlignmentInBytes)
```

基线配置下的例子：

| 表达式 | 计算 | 大小 |
| :-- | :-- | --: |
| `new byte[1]` | `align_up(16 + 1, 8)` | 24 字节 |
| `new int[3]` | `align_up(16 + 12, 8)` | 32 字节 |
| `new long[3]` | `align_up(16 + 24, 8)` | 40 字节 |
| `new Object[3]` | `align_up(16 + 3 × 4, 8)` | 32 字节 |

关闭压缩引用时，`Object[]` 的每个元素由 4 字节变为 8 字节，`new Object[3]` 变为 40 字节；基本类型数组不变。关闭压缩类指针会改变数组头，所有数组都需要重新计算。

## 5. Mark Word 如何编码锁状态 {#mark-word-states}

Mark Word 不是一块固定字段，而是一组按状态复用的位。OpenJDK 21 的 64 位普通对象格式为：

```txt
位范围       63..39       38..8       7       6..3       2       1..0
字段         unused:25    hash:31     gap     age:4      gap     lock:2
```

- `hash` 保存最多 31 位的 identity hash。尚未调用 `hashCode()` 时，对应位可以为 0。
- `age` 占 4 位，记录对象经历的年龄归档次数。`MaxTenuringThreshold=15` 是上限，不保证每次 GC 都晋升到阈值；GC 还可能根据 Survivor 容量选择更低的有效阈值。
- 最低两位 `lock` 标识对象状态：

| `lock` | 状态 | Mark Word 中的主要内容 |
| :-- | :-- | :-- |
| `01` | 普通、未锁定 | identity hash、分代年龄和保留位 |
| `00` | 已锁定 | 保存锁记录、displaced header 或带锁定标记的 header，具体取决于锁定模式 |
| `10` | Monitor 已膨胀 | 指向 `ObjectMonitor` |
| `11` | GC 标记 | GC 运行期间使用的标记信息 |

对象被锁定时，哈希、年龄和锁信息不能同时占据原来的全部位。HotSpot 会在执行 `hashCode()` 或恢复对象头时保留或重建这些信息，而不是简单丢弃。

偏向锁属于历史实现，不进入本文的 OpenJDK 21 基线：

- OpenJDK 8u504 的 64 位 Mark Word 包含 `biased_lock` 位，偏向状态下还保存 ThreadID 和 Epoch。
- OpenJDK 17 仍接受 `-XX:+UseBiasedLocking`，但会提示该选项自 15 起已弃用。
- OpenJDK 21.0.12.1 的 HotSpot 源码不再包含偏向锁格式。

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

JOL 必须运行在与目标布局一致的 JVM 配置上。它输出的是当前进程的测量结果，不是跨版本保证。

`-XX:+PrintFieldLayout` 只存在于 HotSpot 的 debug 或 notproduct 构建中；普通发行版会提示该选项不可用，不能把它当作通用布局检查命令。

> 版本依据：布局计算核对 OpenJDK `jdk-21.0.12.1-ga` 中的 `markWord.hpp`、`instanceOop.hpp`、`arrayOop.hpp`、`fieldLayoutBuilder.cpp` 和 `globals.hpp`；偏向锁历史格式对照 `jdk8u504-ga` 中的 `markOop.hpp`，核对日期为 2026-10-09。

> 本章解释对象在堆中的实际排布。对象分配区域和 TLAB 见[运行时数据区与内存结构](./chapter-02-runtime-data-areas.md)，Mark Word 如何服务 GC 见[垃圾回收](./chapter-04-gc.md)，锁状态的运行方式见 [`synchronized` 锁优化](../03-java-concurrency/chapter-06-synchronized.md#synchronized-lock-optimization)。
