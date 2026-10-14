# JVM 运行时数据区与内存结构

> `-Xmx4g` 设完，你以为安全了。`docker stats` 一看，容器 RSS 已经 7.2G——堆才用了 3G。多出来的 4.2G 在哪？线程栈（一个线程 1MB，800 个就是 800MB）、Metaspace（类元数据不归堆管）、CodeCache（JIT 编译后的机器码）、堆外内存（Direct Buffer）。OOM Killer 杀进程时你在查堆——方向错了。JVM 内存不只堆和栈，记不住这一点，线上排查必走弯路。堆外内存不在本页的规范数据区范围内，分配与释放机制见 [堆外内存](./chapter-06-offheap-memory.md)。

## 1. 全景图

```txt
JVM 运行时数据区（规范概念）
 ├── 线程共享
 │    ├── Heap（堆）—— 对象实例、数组
 │    └── Method Area（方法区）—— 类级结构信息、运行时常量池
 └── 线程私有
      ├── VM Stack（虚拟机栈）—— 栈帧
      ├── Native Method Stack —— 本地方法栈
      └── PC Register（程序计数器）
```

方法区是 JVM 规范定义的逻辑数据区，Metaspace 是 HotSpot 对它的实现，两者不是同一个概念。静态字段的引用、`java.lang.Class` 镜像对象实际存放在堆中，不放进方法区。CodeCache、StringTable 属于 HotSpot 的补充结构，见下文第 4 节。

页面按“线程私有数据区 → 线程共享数据区 → HotSpot 补充结构”连续展开：先建立规范定义下的区域全景，再理解 CodeCache 和 StringTable 如何补充实际进程内存视图。堆外内存不属于本页的规范数据区范围，见[堆外内存](./chapter-06-offheap-memory.md)。

这些区域不是孤立存在的。一行 Java 代码的执行，会同时涉及多个区域。以 `User user = new User("Tom")` 为例：

```txt
1. 方法区：加载 User 类的元数据（类名、字段、方法字节码）
2. 堆：分配 User 对象的内存空间
3. 虚拟机栈：当前方法的栈帧中，user 变量指向堆中的对象
4. 程序计数器：记录当前执行到哪一行字节码
```

这个例子没有进入本地方法栈，因为它没有调用 `native` 方法。Java 调用某些由 JVM 或本地库实现的 native 方法时，会进入相应的本地执行路径；JVM 规范把这部分执行环境抽象为本地方法栈，但 HotSpot 的实际线程栈布局不一定对应两块独立的物理内存。

## 2. 线程私有数据区

### 2.1 虚拟机栈：方法执行的舞台

#### 2.1.1 栈帧是什么

每调用一个方法，JVM 就在当前线程的虚拟机栈上压入一个**栈帧**。方法返回时弹出。栈帧是方法执行的"工作台"，包含四个组成部分：

```txt
栈帧
├── 局部变量表 —— 存放方法参数和局部变量
├── 操作数栈   —— 字节码指令的运算中转站
├── 动态链接   —— 指向运行时常量池中该方法的符号引用
└── 返回地址   —— 方法返回后继续执行的位置
```

#### 2.1.2 局部变量表与 Slot

局部变量表以 **Slot（变量槽）** 为单位。32 位类型（`int`、`float`、引用）占 1 个 Slot，64 位类型（`long`、`double`）占 2 个 Slot。

实例方法的 Slot 0 固定是 `this`：

```java
public class UserService {
    public User findUser(int id, String name) {
        // Slot 0 = this（隐式参数）
        // Slot 1 = id
        // Slot 2 = name
        User user = new User(id, name);  // Slot 3 = user
        return user;
    }
}
```

静态方法不能访问 `this`，因为静态方法的局部变量表中没有 Slot 0——它没有隐式参数。

局部变量表描述的是单个方法帧如何保存局部变量。**Lambda 能否修改捕获变量则由 Java 语言规则决定**：被捕获的局部变量和参数必须是 `final` 或 effectively final。捕获值在 Lambda 实现中如何存储属于 JVM 和运行库的实现细节，不能用 Slot 布局直接解释。

#### 2.1.3 动态链接的作用

动态链接描述的是当前方法与运行时常量池之间的联系。字节码中的方法调用指令通过常量池中的符号引用表达调用目标，JVM 在连接和执行过程中解析相关引用。

这和 [Class 文件解析阶段](./chapter-01-bytecode-classloading.md#resolution)直接相关：动态链接让执行代码复用解析结果，而不是在每次执行时重新按名字搜索。对于虚方法调用，解析方法符号引用并不意味着最终实现已经确定：

```txt
class Animal { void speak() { } }
class Dog extends Animal { void speak() { } }

Animal a = new Dog();
a.speak();
// 调用点引用的是 Animal.speak() 对应的符号引用，
// 运行时根据接收者的实际类型选择 Dog.speak()
```

如果 HotSpot 将调用点所在的方法编译成机器码，JIT 还可能根据类型反馈进行去虚化或内联。动态链接负责的符号引用机制，与调用点最终如何分派、编译器如何优化，是相关但不同的问题。

#### 2.1.4 栈溢出的真实场景

每个线程的栈大小由 `-Xss` 控制（默认因平台而异，通常 512KB~1MB）。栈溢出的典型场景是深度递归：

```java
// 没有退出条件的递归，持续累积栈帧
static void recurse(int depth) {
    recurse(depth + 1);
}
```

在常见 HotSpot 配置下，这段代码通常会以 `StackOverflowError` 结束，但具体可递归深度不固定，取决于线程栈大小、单次调用的栈帧大小和 JVM 实现。

**过深的方法调用链**同样常见。Spring + MyBatis 应用中，一次请求可能经过：Filter → DispatcherServlet → Controller → Service → Mapper → MyBatis 拦截器 → JDBC → ...，调用链本身就可能很深。

#### 2.1.5 `StackOverflowError` vs `OutOfMemoryError`

栈区域可能抛出两种异常，触发条件不同：

| 异常 | 触发条件 | 含义 |
| :-- | :-- | :-- |
| `StackOverflowError` | 栈深度超过 `-Xss` 限制 | 单个线程的方法调用太深 |
| `OutOfMemoryError` | 无法为新线程分配所需资源 | 可能涉及本地内存、进程或系统线程数限制、容器限制 |

第二种更隐蔽。每个线程的栈需要独立的内存空间，1000 个线程 × 1MB 栈 = 1GB 内存。`-Xss` 表示每线程 Java 栈的配置参数，实际本地内存消耗还受线程栈实现、保护页、线程本地数据等影响，不能把乘积当成 RSS 的精确预测值。在高并发场景下，线程数过多可能因本地内存或线程数限制而失败，报错未必是 `OutOfMemoryError: Java heap space`，也可能是 `unable to create native thread`。

### 2.2 程序计数器：线程切换后为什么还能接着跑

可以把程序计数器理解为 **当前线程下一条将要执行的字节码位置**。线程切换后，JVM 正是依靠它恢复执行位置。

#### 2.2.1 程序计数器记录当前方法执行位置

程序计数器用于记录当前线程的 Java 方法执行位置。在 JVM 的抽象执行模型中，它对应当前正在执行的 JVM 指令；执行 native 方法时，其值未定义。没有程序计数器，线程切换之后就不知道该从哪里恢复。

```txt
线程 A：当前执行位置 = 方法 m 的第 12 条指令
线程 B：当前执行位置 = 方法 n 的第 87 条指令

CPU 从 A 切到 B
  保存 A 的执行上下文
  恢复 B 的执行上下文

再切回 A
  从 A 的上次位置继续执行
```

这个概念与操作系统保存的 CPU 寄存器状态有关，但不应把两者直接等同。线程被操作系统调度时，需要保存和恢复线程的执行上下文；JVM 还需要维护 Java 方法的执行状态。解释执行和 JIT 编译执行的实现方式不同，不能笼统地说 JVM 的 PC 始终保存 `.class` 文件中的字节码偏移量。

#### 2.2.2 为什么每个线程都要有自己的 PC

因为不同线程执行的方法、执行进度也不同，所以程序计数器是**线程私有**的，独立记录。

```txt
线程私有数据区的协作关系

Thread A
 ├── PC Register      → 当前执行位置
 └── VM Stack         → 当前方法的栈帧

Thread B
 ├── PC Register      → 另一份执行位置
 └── VM Stack         → 另一组栈帧
```

这里也能看出它和虚拟机栈的关系：**虚拟机栈负责保存"当前方法要用什么数据"，程序计数器负责保存"当前方法执行到哪里"。** 调试、单步执行和解释执行都需要这些状态，但它们的具体表示与保存方式取决于 JVM 的执行实现。

#### 2.2.3 执行 native 方法时，PC 为什么是未定义

如果当前执行的是 `native` 方法，线程不再按 Java 字节码逐条解释执行，而是进入了本地代码。此时程序计数器就**不再表示某个 Java 字节码位置**，规范里通常表述为"值未定义"。

这也是为什么程序计数器和本地方法栈要一起理解：一个记录 Java 字节码位置，一个对应 native 调用阶段的执行现场。

#### 2.2.4 为什么它几乎从不成为故障主角

程序计数器占用的内存极小，而且生命周期和线程一致。JVM 规范里，它也是**唯一一个明确不会规定抛出 `OutOfMemoryError` 的运行时数据区**。

这并不意味着它不重要；恰恰相反，它太基础了，以至于平时感受不到它的存在。线程恢复、异常回溯、调试断点、单步执行，这些能力背后都离不开程序计数器。

### 2.3 本地方法栈：连接 Java 世界与本地世界的执行环境

JVM 并不是一个完全封闭的世界。线程创建、文件 I/O、Socket 通信、磁盘读写、系统调用、底层同步原语等能力，最终都必须依赖操作系统提供的接口，而这些接口通常由本地代码实现。如果 JVM 只能执行 Java 字节码，而不能进入本地代码，那么 Java 连刚才提到的功能都无法完成。

因此，本地方法栈存在的意义不是为了提升性能，而是为了让 Java 能够进入本地代码，完成 JVM 自身无法仅靠字节码实现的工作。

这里说的 `native` 方法，是指方法体不是由 Java 字节码实现，而是由 C/C++ 等本地代码实现。例如 JVM 自身、JNI 库以及大量与操作系统交互的能力，都属于这一类。本地方法栈并不是 JNI 开发者才会接触到的东西，而是每一个 Java 程序每天都在间接使用的运行时基础设施

例如：

```java
public native void start0();
```

当 Java 调用 `native` 方法后，执行流程会从 Java 世界切换到本地世界：

```txt
Java 方法
    ↓
JNI / JVM 桥接
    ↓
C/C++ 本地代码
    ↓
操作系统
```

因此，线程不仅需要维护 Java 方法的执行现场，也需要维护本地代码的执行现场，这就是 JVM 规范定义本地方法栈的原因。

#### 2.3.1 和虚拟机栈的区别

JVM 规范把虚拟机栈和本地方法栈定义成两个不同的运行时数据区，是为了区分 **Java 方法** 和 **本地方法** 两种不同的执行语义：虚拟机栈负责 Java 方法的执行现场，本地方法栈负责 `native` 方法的执行现场。

但是，规范只规定必须支持这两个概念，并没有规定它们必须对应两块独立的物理内存。

HotSpot 并没有专门维护一块独立的 `Native Method Stack`，而是直接利用操作系统线程本身的调用栈来执行本地代码。

也就是说，在 HotSpot 中，当线程进入 `native` 方法后，CPU 执行的是已经编译好的 C/C++ 机器码，而调用栈则由操作系统和 CPU 按照本地 ABI 自动维护。

因此，我们通常看不到这样两块完全独立的内存：

```txt
Java VM Stack

Native Method Stack
```

而更接近于：

```txt
线程栈（Thread Stack）
├── Java 方法调用帧
├── Java 方法调用帧
├── JNI 过渡帧
├── Native 方法调用帧
├── libc 调用帧
└── 操作系统调用帧
```

也正因为如此，在 HotSpot 的诊断工具中，很少会看到一个单独标注为 `Native Method Stack` 的区域。

本地方法栈是 JVM 规范定义的**逻辑概念**，而 HotSpot 通过操作系统线程栈完成了它的职责。

#### 2.3.2 本地方法栈可能出现的异常

从 JVM 规范来看，本地方法栈和虚拟机栈一样，都可能因为栈空间不足而出现异常：

- **`StackOverflowError`**：本地调用层次过深，导致线程栈耗尽
- **`OutOfMemoryError`**：系统无法为新的线程分配足够的栈空间

不过，在 HotSpot 中，由于 Java 方法和本地方法通常共享同一个线程栈，线上更常看到的是线程栈耗尽、线程数量过多等问题，而不会看到一个单独标注为 `Native Method Stack` 的监控指标。

## 3. 线程共享数据区

### 3.1 堆：对象的生命周期

#### 3.1.1 分代假说与收集器的堆布局

在采用经典分代布局的 HotSpot 收集器中，堆通常划分为新生代（Eden + S0 + S1）和老年代（Old）。分代的依据是**弱分代假说**（Weak Generational Hypothesis）：绝大多数对象在创建后很快就会被回收。一个 Web 应用中，一次请求创建的大量临时对象（DTO、StringBuilder、各种中间变量）在请求结束后就变成垃圾。分代的设计就是利用这个特征：频繁回收新生代（少量存活对象），偶尔回收老年代（长期存活对象）。

但这不是所有收集器共享的固定物理布局，不同收集器对代际、区域和对象晋升的管理方式不同，Java 21 的 Generational ZGC 就是例子。阅读 GC 日志或排查堆内存问题时，需要结合实际使用的收集器来理解区域与晋升行为。

#### 3.1.2 对象分配的落点

```java
User user = new User("Tom");
```

普通对象首先分配到 Eden。HotSpot 默认使用 TLAB，让每个线程在 Eden 中拥有一块私有缓冲区，从而在缓冲区内通过移动指针完成分配，避免线程间竞争。完整的对象创建步骤见[对象创建流程](./chapter-03-object-layout.md#object-creation)。

TLAB 用完后，线程需要在 Eden 共享区分配对象。这个过程使用 CAS 保证原子性：

```txt
// 伪代码：Eden 共享区的对象分配
while (true) {
    address = freePointer;                    // 读取当前分配指针
    newAddress = address + objectSize;        // 计算新位置
    if (CAS(&freePointer, address, newAddress)) {  // CAS 更新指针
        break;  // 分配成功
    }
    // CAS 失败 → 其他线程先分配了 → 重试
}
```

CAS（Compare-And-Swap）是[并发编程](../03-java-concurrency/chapter-07-cas-atomic.md)的核心概念，这里先建立直觉：多个线程同时移动分配指针，只有一个能成功，失败的重试。TLAB 的价值正在于避免这个 CAS 竞争——大部分对象在 TLAB 内分配，只有 TLAB 耗尽时才需要 CAS。

堆使用量、Full GC 和 Metaspace OOM 的采集方法见 [JVM 线上诊断](../06-diagnostics/01-jvm/chapter-01-jvm-diagnostics.md)。

### 3.2 方法区：类的元数据仓库

#### 3.2.1 方法区存了什么

方法区不是"存方法的地方"——它存的是**类的元数据**。方法区是规范概念，不是一块固定布局的物理内存，它描述类级别的数据和运行时常量池等应当具备的运行时语义。

HotSpot 中，类元数据主要由 Metaspace 管理，`java.lang.Class` 镜像对象位于堆中，字符串对象也位于堆中。不能把这些内容统称为"全部存放在 Metaspace"：

```txt
方法区（规范概念，描述类的运行时语义）
├── 类级结构信息（类名、父类、接口、字段与方法定义）
└── 运行时常量池（字面量、符号引用）

HotSpot 实现补充
├── Metaspace —— 主要存放类元数据
├── Heap —— 对象实例、Class 镜像、字符串对象
└── CodeCache —— JIT 编译代码（独立本地内存）
```

JDK 7 之后，`static Object obj = new Object()` 中，`obj` 这个引用本身在**堆**中，不在方法区。static 字段的声明信息属于类元数据，但字段值的存储不应仅凭"方法区"这个规范概念推断，需要区分类的声明信息、运行时对象以及它们在实现中的实际存放位置。

#### 3.2.2 PermGen 到 Metaspace：存储位置与容量管理的变化

JDK 7 及以前，方法区的实现叫**永久代（PermGen）**，是堆的一部分，容量受专门参数（`-XX:MaxPermSize`）限制。

JDK 8 将永久代移除，替换为 **Metaspace**，使用本地内存（Native Memory）。

| | 永久代 | Metaspace |
| :-- | :-- | :-- |
| 内存位置 | 堆内 | 本地内存 |
| 大小限制 | 受 `-XX:MaxPermSize` 限制 | 默认不设上限，但受进程地址空间与 `-XX:MaxMetaspaceSize` 约束 |
| OOM 表现 | `PermGen space` | `Metaspace` |
| 字符串常量池 | 在永久代 | 移到堆中 |
| 静态变量 | 在永久代 | 移到堆中 |

永久代把类相关数据放在 Java 堆管理的区域中，容量规划与类卸载管理会带来额外调优负担：

1. **大小难以预估**。类的数量取决于加载的 JAR 数量、反射使用程度、动态代理数量。开发者必须手动调整 `MaxPermSize`，调大了浪费，调小了 OOM。

2. **回收与老年代回收相关**。永久代的类卸载和空间回收与老年代的 GC 行为有关联，满了且尚未触发相应回收时可能直接 OOM。

Metaspace 用本地内存，默认不设上限，但并不意味着不受限制：它仍受进程可用地址空间、操作系统或容器资源限制以及 `-XX:MaxMetaspaceSize` 约束。类卸载也需要满足相应条件，不是任何类一旦不再被使用就立刻释放其元数据。

Metaspace OOM 的常见成因、现场采集和修复案例见 [Metaspace OOM 诊断](../06-diagnostics/01-jvm/chapter-02-cases-cpu-memory.md#metaspace-oom)。

## 4. HotSpot 补充结构

### 4.1 CodeCache：JIT 编译代码的独立存储 {#codecache}

CodeCache 保存 C1、C2 等编译器生成的机器码以及部分本地代码。它是独立的本地内存区域，不归 Metaspace 管理，也不受 `-Xmx` 直接控制。容量上限和缺省值取决于 JDK 版本、CPU 与配置；容量耗尽后的症状、排查和调参见 [CodeCache 满](../06-diagnostics/01-jvm/chapter-01-jvm-diagnostics.md#codecache-full)。

容量不足时，HotSpot 会停止接受新的编译，已有编译代码通常仍可继续执行。CodeCache 不足时未必出现 OOM，但服务可能持续变慢。

### 4.2 StringTable：字符串驻留的代价

#### 4.2.1 字符串常量池的工作原理

```java
String a = "hello";
String b = "hello";
// a == b 为 true——两者指向常量池中同一个对象
```

JVM 维护一个**字符串常量池（StringTable）**，存储所有字面量字符串。相同的字符串只存一份，所有引用共享。

StringTable 本质上是一个哈希表，通过字符串的 `hashCode()` 定位桶。`-XX:StringTableSize` 控制桶数；JDK 21 64 位 HotSpot 的默认值是 65536，参数值会向上取到 2 的幂。启动时可用 `-XX:+PrintFlagsFinal` 核对目标 JVM 的实际值。桶数增加通常能减少冲突，但也增加表结构占用的内存。

#### 4.2.2 intern() 的行为与陷阱

```java
String a = new String("hello");  // 堆上新对象（a ≠ "hello"）
String b = a.intern();           // 将 "hello" 放入常量池
String c = "hello";              // 直接引用常量池
b == c  // true
```

`intern()` 的行为在 JDK 6 和 JDK 7+ 有本质区别：

| | JDK 6 | JDK 7+ |
| :-- | :-- | :-- |
| StringTable 位置 | 永久代 | 堆 |
| `intern()` 发现字符串不存在时 | 在永久代创建并保存字符串 | 把传入的 `String` 对象保存到堆中的 StringTable |
| 内存影响 | 永久代空间有限，容易 OOM | 使用堆空间，可被 GC 回收 |

JDK 7 开始，StringTable 从永久代移到堆中，因此调用 `intern()` 不会再因永久代容量受限而抛出同类 `OutOfMemoryError`。对于已经在堆中的 `String` 对象，表中保存的是这个对象本身；字符串字面量仍保证驻留在唯一的字符串池中。

#### 4.2.3 G1 字符串去重

G1 收集器提供了一个专门的字符串去重优化：`-XX:+UseStringDeduplication`。它在 GC 过程中发现多个 `String` 对象的底层数组内容相同后，会让它们共享同一份数组。Java 9 起，`String` 使用 Compact Strings，ASCII 内容通常存放在 `byte[]` 中；因此这里不应把底层数组固定写成 `char[]`。

```txt
去重前：
  String@0x1001 → byte[]{'h','e','l','l','o'}
  String@0x1002 → byte[]{'h','e','l','l','o'}

去重后：
  String@0x1001 → byte[]{'h','e','l','l','o'}
  String@0x1002 → byte[]{'h','e','l','l','o'}（共享数组）
```

与 `intern()` 的区别：`intern()` 让相同字符串共享同一个 `String` 对象，G1 去重则保留不同的 `String` 对象，只合并它们的底层数组。启用该功能不需要修改业务代码，但会增加 GC 期间的后台处理；应结合去重日志和统计信息确认收益。

适合场景：应用中存在大量重复字符串（如从数据库读取的枚举值、城市名、状态码），且使用 G1 收集器。

#### 4.2.4 intern() 的使用场景

**适合：大量重复字符串的去重**

```java
// 从 CSV 读取大量重复的城市名
String raw = getCityFromCsv();
String canonical = raw.intern();  // 相同城市名共享同一个规范化对象
return canonical;
```

只有使用 `intern()` 的返回值，后续引用才指向规范化字符串。如果调用方仍保留所有原始字符串引用，`intern()` 不会自动把它们合并成一个对象；是否节省内存，要看后续代码是否复用返回值、原始对象是否变得不可达，以及驻留表本身的成本。

**不适合：大量不重复的字符串**

```java
// 如果每个字符串都不同，通常没有必要额外调用 intern()
for (int i = 0; i < 1_000_000; i++) {
    String s = UUID.randomUUID().toString();
}
```

对高基数、低重复率的字符串，`intern()` 通常难以带来足够的内存收益，却会增加驻留查找与管理成本。是否使用，应由实际重复率和内存分析结果决定。

#### 4.2.5 字符串常量池的内存模型

```txt
堆（Heap）
├── StringTable（HashTable，桶数组）
│   ├── [0] → "hello" → "world"  （链表处理哈希冲突）
│   ├── [1] → null
│   ├── [2] → "foo"
│   └── ...
├── String 对象（内部 value 数组）
│   ├── String@0x1001 → byte[]{'h','e','l','l','o'}
│   ├── String@0x1002 → byte[]{'w','o','r','l','d'}
│   └── ...
└── 其他对象
```

`String a = "hello"` 的查找过程：

1. 计算 `"hello".hashCode()` → 得到桶索引
2. 在对应桶的冲突链中找到值为 `"hello"` 的 String 对象
3. 返回该对象的引用

加载字符串字面量时，如果没找到，JVM 会创建一个新的 String 对象并放入 StringTable。

> 本章覆盖线程私有数据区、线程共享数据区以及 HotSpot 补充结构的职责和工作方式。[HotSpot 对象布局](./chapter-03-object-layout.md)继续解释对象创建、字段排列和 Mark Word，这些知识直接服务于 [GC](./chapter-04-gc.md) 和并发锁。
