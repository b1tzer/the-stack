# JVM 运行时数据区与内存结构

> `-Xmx4g` 设完，你以为安全了。`docker stats` 一看，容器 RSS 已经 7.2G——堆才用了 3G。多出来的 4.2G 在哪？线程栈（一个线程 1MB，800 个就是 800MB）、Metaspace（类元数据不归堆管）、CodeCache（JIT 编译后的机器码）、堆外内存（Direct Buffer）。OOM Killer 杀进程时你在查堆——方向错了。JVM 内存不只堆和栈，记不住这一点，线上排查必走弯路。堆外内存不在本页的规范数据区范围内，分配与释放机制见 [堆外内存](./chapter-06-offheap-memory.md)。

## 1. 全景图

```txt
JVM 运行时数据区
 ├── 线程共享
 │    ├── Heap（堆）—— 对象实例、数组
 │    └── Method Area（方法区 / Metaspace）—— 类信息、常量、静态变量
 └── 线程私有
      ├── VM Stack（虚拟机栈）—— 栈帧
      ├── Native Method Stack —— 本地方法栈
      └── PC Register（程序计数器）
```

页面按“规范数据区 → 方法区实现 → CodeCache → 字符串常量池”连续展开：先建立线程私有与共享区域的全景，再理解 Metaspace、CodeCache 和 StringTable 如何补充进程内存视图。堆外内存不属于本页的规范数据区范围，见[堆外内存](./chapter-06-offheap-memory.md)。

这些区域不是孤立存在的。一行 Java 代码的执行，会同时涉及多个区域。以 `User user = new User("Tom")` 为例：

```txt
1. 方法区：加载 User 类的元数据（类名、字段、方法字节码）
2. 堆：分配 User 对象的内存空间
3. 虚拟机栈：当前方法的栈帧中，user 变量指向堆中的对象
4. 程序计数器：记录当前执行到哪一行字节码
```

这个例子没有进入本地方法栈，因为它没有调用 `native` 方法；一旦执行到 `Thread.start0()`、`Object.hashCode()` 这类本地实现路径，线程还会用到本地方法栈。

## 2. 虚拟机栈：方法执行的舞台

### 2.1 栈帧是什么

每调用一个方法，JVM 就在当前线程的虚拟机栈上压入一个**栈帧**。方法返回时弹出。栈帧是方法执行的"工作台"，包含四个组成部分：

```txt
栈帧
├── 局部变量表 —— 存放方法参数和局部变量
├── 操作数栈   —— 字节码指令的运算中转站
├── 动态链接   —— 指向运行时常量池中该方法的符号引用
└── 返回地址   —— 方法返回后继续执行的位置
```

### 2.2 局部变量表与 Slot

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

这也解释了 **Lambda 表达式为什么能访问外部变量但不能修改**：Lambda 捕获的是变量的**值的拷贝**（Slot 中的值），不是引用。如果允许修改，会导致 Lambda 内部的修改对调用方不可见——违反了 Java 的值传递语义。

### 2.3 动态链接的作用

每个栈帧里都有一个"指针"指向运行时常量池——这就是动态链接。它的作用很直接：方法执行时，JVM 通过它找到目标方法的字节码入口。没有它，多态就无法工作。

这和[第一章的解析阶段](./chapter-01-bytecode-classloading.md#resolution)直接相关。静态方法、final 方法在类加载时就解析为直接引用（静态解析），但虚方法和接口方法的解析是延迟的——每次调用时通过动态链接查找实际目标。这就是多态在栈帧层面的支撑：

```txt
// 编译时：invokevirtual 的目标是父类方法的符号引用
// 运行时：通过动态链接，找到子类重写后的方法入口

class Animal { void speak() { } }
class Dog extends Animal { void speak() { } }

Animal a = new Dog();
a.speak();
// 栈帧的动态链接指向 Dog.speak() 的字节码，而非 Animal.speak()
```

如果方法被 JIT 编译，动态链接会直接指向编译后的机器码入口，跳过字节码解释。

### 2.4 栈溢出的真实场景

每个线程的栈大小由 `-Xss` 控制（默认因平台而异，通常 512KB~1MB）。栈溢出不只是"无限递归"这么简单——在实际项目中，更常见的触发场景是：

**1. 深度递归处理大数据**

```java
// 处理一棵深度为 10000 的树
public void traverse(TreeNode node) {
    if (node == null) return;
    process(node);
    traverse(node.left);   // 深度递归 → StackOverflowError
    traverse(node.right);
}
```

**2. 过深的方法调用链**

Spring + MyBatis 应用中，一次请求可能经过：Filter → DispatcherServlet → Controller → Service → Mapper → MyBatis 拦截器 → JDBC → ...，调用链本身就可能很深。

**3. JSP 编译后的超长方法**

JSP 页面编译成 Servlet 后，整个页面的逻辑在一个 `_jspService()` 方法中。复杂的 JSP 页面可能生成超长的方法，导致栈帧过大。

### 2.5 `StackOverflowError` vs `OutOfMemoryError`

栈区域可能抛出两种异常，触发条件不同：

| 异常 | 触发条件 | 含义 |
| :-- | :-- | :-- |
| `StackOverflowError` | 栈深度超过 `-Xss` 限制 | 单个线程的方法调用太深 |
| `OutOfMemoryError` | 无法分配新的线程栈 | 创建了太多线程，操作系统内存耗尽 |

第二种更隐蔽。每个线程的栈需要独立的内存空间，1000 个线程 × 1MB 栈 = 1GB 内存。在高并发场景下，线程数过多会直接导致 OOM，而不是 StackOverflow。

## 3. 程序计数器：线程切换后为什么还能接着跑

可以把程序计数器理解为 **当前线程下一条将要执行的字节码位置**。线程切换后，JVM 正是依靠它恢复执行位置。

### 3.1 程序计数器存的是字节码偏移量

程序计数器记录的是当前线程正在执行的**字节码偏移量**。没有程序计数器，线程切换之后就不知道该从哪里恢复。多线程看上去是"同时运行"，但底层经常是在 CPU 时间片之间不断切换；每个线程都必须有自己独立的执行位置记录。

```txt
线程 A：PC = 12   → 当前执行到第 12 个字节码偏移量
线程 B：PC = 87   → 当前执行到第 87 个字节码偏移量

CPU 从 A 切到 B
  保存 A 的 PC = 12
  恢复 B 的 PC = 87

再切回 A
  从 12 对应的位置继续执行
```

### 3.2 为什么每个线程都要有自己的 PC

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

这里也能看出它和虚拟机栈的关系：**虚拟机栈负责保存"当前方法要用什么数据"，程序计数器负责保存"当前方法执行到哪里"。** 一个管执行现场，一个管执行位置，少一个都不行。

### 3.3 执行 native 方法时，PC 为什么是未定义

如果当前执行的是 `native` 方法，线程不再按 Java 字节码逐条解释执行，而是进入了本地代码。此时程序计数器就**不再表示某个 Java 字节码位置**，规范里通常表述为"值未定义"。

这也是为什么程序计数器和本地方法栈要一起理解：一个记录 Java 字节码位置，一个对应 native 调用阶段的执行现场。

### 3.4 为什么它几乎从不成为故障主角

程序计数器占用的内存极小，而且生命周期和线程一致。JVM 规范里，它也是**唯一一个明确不会规定抛出 `OutOfMemoryError` 的运行时数据区**。

这并不意味着它不重要；恰恰相反，它太基础了，以至于平时感受不到它的存在。线程恢复、异常回溯、调试断点、单步执行，这些能力背后都离不开程序计数器。

## 4. 本地方法栈：连接 Java 世界与本地世界的执行环境

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

### 4.1 和虚拟机栈的区别

一句话说清楚：**虚拟机栈负责 Java 方法的执行现场，本地方法栈负责 `native` 方法的执行现场。**

JVM 规范把虚拟机栈和本地方法栈定义成两个不同的运行时数据区，是为了区分 **Java 方法** 和 **本地方法** 两种不同的执行语义。

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

### 4.2 本地方法栈可能出现的异常

从 JVM 规范来看，本地方法栈和虚拟机栈一样，都可能因为栈空间不足而出现异常：

- **`StackOverflowError`**：本地调用层次过深，导致线程栈耗尽
- **`OutOfMemoryError`**：系统无法为新的线程分配足够的栈空间

不过，在 HotSpot 中，由于 Java 方法和本地方法通常共享同一个线程栈，线上更常看到的是线程栈耗尽、线程数量过多等问题，而不会看到一个单独标注为 `Native Method Stack` 的监控指标。

## 5. 堆：对象的生命周期

### 5.1 分代不是理论，是工程经验

堆分为新生代（Eden + S0 + S1）和老年代（Old）。分代的依据是**弱分代假说**（Weak Generational Hypothesis）：绝大多数对象在创建后很快就会被回收。一个 Web 应用中，一次请求创建的大量临时对象（DTO、StringBuilder、各种中间变量）在请求结束后就变成垃圾。分代的设计就是利用这个特征：频繁回收新生代（少量存活对象），偶尔回收老年代（长期存活对象）。

### 5.2 对象分配的落点

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

### 5.3 堆内存的监控

```bash
# 查看堆内存使用情况
jstat -gcutil <pid> 1000

# 输出示例:
#   S0     S1     E      O      M     CCS    YGC     YGCT    FGC    FGCT     GCT
#   0.00  25.31  45.67  32.18  95.32  92.15   125    1.234     3    0.456    1.690
```

| 列 | 含义 | 关注点 |
| :-- | :-- | :-- |
| S0/S1 | Survivor 区使用率 | 一个为 0，一个有数据（复制算法） |
| E | Eden 区使用率 | 接近 100% 时即将触发 Young GC |
| O | 老年代使用率 | 持续增长 → 可能有内存泄漏 |
| YGC/YGCT | Young GC 次数/总耗时 | 频繁但每次应该很快（< 50ms） |
| FGC/FGCT | Full GC 次数/总耗时 | 次数应该很少，每次较慢 |

如果 FGC 频繁（每分钟多次），通常意味着老年代空间不足或有内存泄漏。先检查 O 区使用率是否持续增长，再用 `jmap -histo` 看哪些对象占用了大量内存。

## 6. 方法区：类的元数据仓库

### 6.1 方法区存了什么

方法区不是"存方法的地方"——它存的是**类的元数据**：

```txt
方法区（HotSpot 实现为 Metaspace）
├── 类元数据（Klass）
│   ├── 类名、访问修饰符、父类、接口列表
│   ├── 字段定义（名称、类型、修饰符、偏移量）
│   └── 方法定义（名称、参数、返回值、字节码、异常表）
├── 运行时常量池
│   ├── 字面量（字符串、数字常量）
│   └── 符号引用（类名、方法名、字段名 → 解析后变成直接引用）
└── 字段与方法的静态结构信息
```

JDK 7 之后，`static Object obj = new Object()` 中，`obj` 这个引用本身在**堆**中，不在方法区。方法区主要保存类的结构信息；CodeCache 是与 Metaspace 分开管理的本地内存区域，不放进上述结构图。

### 6.2 PermGen → Metaspace 的演进

JDK 7 及以前，方法区的实现叫**永久代（PermGen）**，是堆的一部分，大小固定（`-XX:MaxPermSize`）。

JDK 8 将永久代彻底移除，替换为 **Metaspace**，使用本地内存（Native Memory）。

| | 永久代 | Metaspace |
| :-- | :-- | :-- |
| 内存位置 | 堆内 | 本地内存 |
| 大小限制 | 固定（默认 64MB~82MB） | 默认不设上限 |
| OOM 表现 | `PermGen space` | `Metaspace` |
| 字符串常量池 | 在永久代 | 移到堆中 |
| 静态变量 | 在永久代 | 移到堆中 |

**为什么要改？** 永久代有两个致命问题：

1. **大小难以预估**。类的数量取决于加载的 JAR 数量、反射使用程度、动态代理数量。一个使用大量框架的应用可能需要 256MB 永久代，另一个只需要 64MB。开发者必须手动调整 `MaxPermSize`，调大了浪费，调小了 OOM。

2. **Full GC 才能回收**。永久代的垃圾回收和老年代绑定——只有 Full GC 才会顺带回收永久代。如果永久代满了但还没触发 Full GC，就会直接 OOM。

Metaspace 用本地内存，默认不设上限，由操作系统管理。类卸载时自动回收。这解决了预估困难的问题。

### 6.3 Metaspace OOM 的真实场景

Metaspace 不是无限的。以下场景会导致 Metaspace OOM：

**场景一：CGLIB 动态代理失控**

```java
// Spring AOP 每次创建代理都会生成新类
// 如果代理类没有被正确缓存，Metaspace 会持续增长
while (true) {
    Enhancer enhancer = new Enhancer();
    enhancer.setSuperclass(Target.class);
    enhancer.setCallback((MethodInterceptor) (obj, method, args, proxy) -> 
        proxy.invokeSuper(obj, args));
    enhancer.create();  // 每次生成一个新类 → Metaspace 增长
}
```

**场景二：Groovy 脚本反复编译**

```java
// Groovy 的 GroovyShell 每次 eval 都会编译生成新类
GroovyShell shell = new GroovyShell();
while (true) {
    shell.evaluate("println 'hello'");  // 每次生成一个新的 Script 类
}
```

**场景三：大量 JSP 页面**

Tomcat 部署了大量 JSP 应用，每个 JSP 编译成一个 Servlet 类。如果应用有数千个 JSP，Metaspace 需要数百 MB。

**监控 Metaspace：**

```bash
# 查看 Metaspace 使用情况
jstat -gcmetacapacity <pid>

# 更详细的 Metaspace 分解
jcmd <pid> VM.metaspace
```

## 7. CodeCache：JIT 编译代码的独立存储 {#codecache}

CodeCache 保存 C1、C2 等编译器生成的机器码以及部分本地代码。它是独立的本地内存区域，不归 Metaspace 管理，也不受 `-Xmx` 直接控制。容量上限和缺省值取决于 JDK 版本、CPU 与配置；容量耗尽后的症状、排查和调参见 [CodeCache 满](./chapter-05-jit.md#codecache-full)。

容量不足时，HotSpot 会停止接受新的编译，已有编译代码通常仍可继续执行。CodeCache 不足时未必出现 OOM，但服务可能持续变慢。

## 8. StringTable：字符串驻留的代价

### 8.1 字符串常量池的工作原理

```java
String a = "hello";
String b = "hello";
// a == b 为 true——两者指向常量池中同一个对象
```

JVM 维护一个**字符串常量池（StringTable）**，存储所有字面量字符串。相同的字符串只存一份，所有引用共享。

StringTable 本质上是一个 HashTable，通过字符串的 hashCode 定位桶。`-XX:StringTableSize` 控制桶数（默认 60013），桶数越多，哈希冲突越少，查找越快。

### 8.2 intern() 的行为与陷阱

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
| `intern()` 发现字符串不存在时 | 在永久代创建新对象 | 在堆中记录引用（不创建新对象） |
| 内存影响 | 永久代空间有限，容易 OOM | 使用堆空间，可被 GC 回收 |

JDK 7+ 的变化意味着：`intern()` 不再往永久代塞数据，而是把堆中已有对象的引用记录到 StringTable。这大幅降低了 `intern()` 的内存风险。

### 8.3 G1 字符串去重

G1 收集器提供了一个专门的字符串去重优化：`-XX:+UseStringDeduplication`。它的原理是在 GC 过程中，发现多个 `String` 对象的 `char[]` 内容相同，就让它们共享同一个 `char[]`。

```txt
去重前：
  String@0x1001 → char[]{'h','e','l','l','o'}  （20 字节）
  String@0x1002 → char[]{'h','e','l','l','o'}  （20 字节）

去重后：
  String@0x1001 → char[]{'h','e','l','l','o'}  （20 字节）
  String@0x1002 → char[]{'h','e','l','l','o'}  （同一个 char[]）
```

与 `intern()` 的区别：`intern()` 去重的是 `String` 对象本身（指向同一个 String），G1 去重的是底层 `char[]` 数组（String 对象还是不同的，但共享 char[]）。G1 去重是自动的，不需要修改代码，开销很低。

适合场景：应用中存在大量重复字符串（如从数据库读取的枚举值、城市名、状态码），且使用 G1 收集器。

### 8.4 intern() 的正确使用场景

**适合：大量重复字符串的去重**

```java
// 从 CSV 读取 1000 万行，大量重复的城市名
// 不用 intern(): 1000 万个 String 对象，其中 90% 是重复的
// 用 intern():   1000 个不重复的城市名 + 1000 万个引用

String city = getCityFromCsv();
return city.intern();  // 相同城市名共享同一个对象
```

**不适合：大量不重复的字符串**

```java
// 每个字符串都不同 → intern() 浪费内存（StringTable 本身也需要空间）
for (int i = 0; i < 1_000_000; i++) {
    String s = UUID.randomUUID().toString().intern();  // 错误用法！
}
```

### 8.5 字符串常量池的内存模型

```txt
堆（Heap）
├── StringTable（HashTable，桶数组）
│   ├── [0] → "hello" → "world"  （链表处理哈希冲突）
│   ├── [1] → null
│   ├── [2] → "foo"
│   └── ...
├── String 对象（value 字符数组）
│   ├── String@0x1001 → char[]{'h','e','l','l','o'}
│   ├── String@0x1002 → char[]{'w','o','r','l','d'}
│   └── ...
└── 其他对象
```

`String a = "hello"` 的查找过程：

1. 计算 `"hello".hashCode()` → 得到桶索引
2. 在桶中遍历链表，找到值为 `"hello"` 的 String 对象
3. 返回该对象的引用

如果没找到，创建一个新的 String 对象，放入 StringTable。

> 本章覆盖了 JVM 各内存区域的职责、内部工作方式和出问题时的表现。[HotSpot 对象布局](./chapter-03-object-layout.md)继续解释对象创建、字段排列和 Mark Word，这些知识直接服务于 [GC](./chapter-04-gc.md) 和并发锁。
