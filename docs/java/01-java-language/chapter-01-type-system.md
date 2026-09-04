# Java 基础与类型系统

> Java 为什么要分基本类型和引用类型？这不是语法问题——是性能和安全在打架。`int` 在栈上，4 字节，直接存值，一次 CPU 指令搞定加减乘除；`Integer` 在堆上，16 字节对象头 + 4 字节 value，多一次内存解引用。差的不只是能不能传 `null`——差的是一个数量级的访问开销和 GC 压力。选了 `int` 还是 `Integer`，不只是"能不能存 null"的选择——是 CPU 周期和 GC 压力的选择。

## 1. Java 的设计目标

每一种编程语言的诞生都是为了解决特定的问题。理解 Java，首先要理解它想解决什么。

### 1.1 软件世界为什么需要 Java

20 世纪 90 年代，C 和 C++ 统治着系统编程和应用开发。它们强大，但也带来了巨大的痛苦：

**C 的问题：** 手动管理内存。`malloc` 分配，`free` 释放，忘了就内存泄漏，释放两次就程序崩溃。指针可以指向任意内存地址，一个越界写入可能破坏整个程序的状态，而且错误往往在运行很久之后才暴露——调试成本极高。

**C++ 的问题：** 试图用面向对象来管理复杂性，但引入了新的复杂性。多重继承导致菱形继承问题，模板编译错误信息晦涩难懂，内存管理依然是手动的。C++ 给了开发者太多自由，也给了太多犯错的机会。

更根本的问题是**跨平台**。同一份 C/C++ 代码，在 Windows 上编译一次，在 Linux 上要重新编译，在 macOS 上又要编译一次。每个平台有不同的系统调用、不同的库、不同的二进制格式。对于需要在多种设备上运行的软件（想想 90 年代的机顶盒、嵌入式设备），这意味着巨大的移植成本。

Java 的出现就是为了解决这些问题。

### 1.2 Java 的核心设计目标

Java 的设计者 James Gosling 和他的团队在设计 Java（最初叫 Oak）时，确立了几个核心目标：

**1. Write Once, Run Anywhere（一次编写，到处运行）**

这是 Java 最重要的设计目标。解决方案是在源码和机器码之间插入一层抽象——字节码（Bytecode）和虚拟机（JVM）。源码编译成字节码，字节码在 JVM 上运行，JVM 屏蔽了底层操作系统的差异。

```txt
C/C++：Source → Machine Code → 只能在特定平台运行
Java：  Source → Bytecode → JVM → 任何平台都能运行
```

**2. 自动内存管理（GC）**

Java 不让开发者手动 `free` 内存，而是由垃圾回收器（Garbage Collector）自动识别和回收不再使用的对象。这消除了一整类 bug：内存泄漏、野指针、Use-After-Free、Double Free。

代价是什么？GC 需要消耗 CPU 时间，偶尔会产生 Stop-The-World 停顿。但对于绝大多数应用来说，这个代价远小于手动内存管理带来的 bug 和调试成本。

**3. 强类型系统**

Java 是静态强类型语言——每个变量在编译期就有确定的类型，编译器会在代码运行之前就检查类型错误。这意味着 `String s = 123;` 这样的错误在编译时就会被发现，而不是等到运行时才崩溃。

**4. 安全沙箱**

Java 的字节码在执行前要经过验证器（Verifier）检查，确保不会执行非法操作（如访问越界内存、绕过访问控制）。这使得 Java 可以安全地运行不受信任的代码——比如浏览器中的 Applet（虽然 Applet 已经被淘汰，但安全沙箱的思想延续到了 Android 等平台）。

**5. 面向对象**

Java 强制使用面向对象范式——所有代码都必须写在类里面。这不是限制，而是一种工程约束：面向对象提供了封装、继承、多态三种机制来管理软件复杂性。

**6. 向后兼容**

Java 非常重视向后兼容——用 Java 5 编译的代码，在 Java 21 的 JVM 上通常还能运行。这对企业级应用至关重要：没人愿意每次 JDK 升级都重写所有代码。

### 1.3 Java 不是为了追求最快

这是一个重要的认知。Java 的设计哲学从来不是"追求极致性能"，而是**在性能、安全性、可维护性和开发效率之间寻找平衡**。

C/C++ 可以比 Java 更快，因为它们可以直接操作内存、使用内联汇编。但这种"更快"的代价是更高的 bug 风险和更长的开发周期。

Java 选择了"足够快"——通过 JVM 的即时编译（JIT），Java 在长期运行的服务端场景下，性能可以接近甚至超过手写的 C++ 代码（因为 JIT 可以根据运行时信息做激进优化，这是 AOT 编译做不到的）。

这个设计选择决定了 Java 的命运：它没有成为游戏引擎或操作系统内核的首选语言，但它成为了企业级应用、Web 后端、大数据处理、Android 开发的主流语言。在这些领域，开发效率和可维护性比极致性能更重要。

### 1.4 一段 Java 代码是如何运行起来的

在深入细节之前，先建立全局视角：

```java
public class Hello {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
```

这段代码从源码到 CPU 执行，经历了这些步骤：

![java-compile-pipeline](/java/java-compile-pipeline.svg)

后面的每一章，都是在解释这条链路中的某一个环节。现在只需要建立这个整体认知，知道"Java 代码不是直接在 CPU 上跑的"就够了。

### 1.5 Java 世界的组成

整本书，就是沿着以下维度一步一步拆解 Java：

- **Java Language**：语言规范，定义了语法和语义
- **Compiler（javac）**：将源码编译成字节码
- **Class File**：字节码的载体，跨平台的核心契约
- **ClassLoader**：将 class 文件加载进 JVM
- **JVM Runtime**：执行字节码的引擎，包含内存管理、GC、JIT
- **JDK 标准库**：集合、IO、并发、网络等基础能力
- **生态框架**：Spring、MyBatis、Netty 等

你现在读的第一卷，覆盖的是 Java Language。第二卷覆盖 JVM Runtime。后面每一卷，都在填充这张地图中的一块。

## 2. 基本类型与引用类型

Java 的类型世界分为两大阵营：基本类型（Primitive）和引用类型（Reference）。理解这个划分，是理解 JVM 运行时内存结构、对象模型、泛型的前提。

### 2.1 类型体系总览

![type-hierarchy](/java/type-hierarchy.svg)

### 2.2 Enum：编译器魔法加持的引用类型

Enum 是引用类型家族中一个特殊的存在。说它是类，它确实有字段、有方法、可以实现接口；说它不是类，它的实例在类加载时就固定了，不能 new，不能继承。编译器对 Enum 有一整套特殊支持，理解这些“魔法”才能用好它。

```java
public enum Color {
    RED, GREEN, BLUE
}
```

编译器将这段代码生成为：

```java
public final class Color extends Enum<Color> {
    public static final Color RED = new Color("RED", 0);
    public static final Color GREEN = new Color("GREEN", 1);
    public static final Color BLUE = new Color("BLUE", 2);

    private Color(String name, int ordinal) { ... }

    public static Color[] values() { ... }  // 编译器生成
    public static Color valueOf(String name) { ... }  // 编译器生成
}
```

几个关键特性：

**1. 天然单例。** 枚举常量在类加载时创建，JVM 保证唯一。这就是为什么 Effective Java 推荐用 Enum 实现单例模式——比 `private static final` 更安全，且天然防反射和序列化攻击。

**2. 可以有字段和方法。** Enum 本质是类，可以有构造方法、字段、方法：

```java
public enum HttpStatus {
    OK(200, "Success"),
    NOT_FOUND(404, "Not Found"),
    INTERNAL_ERROR(500, "Server Error");

    private final int code;
    private final String message;

    HttpStatus(int code, String message) {
        this.code = code;
        this.message = message;
    }

    public int getCode() { return code; }
}
```

**3. 可以实现接口。** `enum Color implements Serializable { ... }`

**4. 天然线程安全。** 枚举常量是 `static final` 的，不可变，不需要同步。

**5. 可以用于 switch。** 这是 Enum 最常见的使用场景之一。

### 2.3 ordinal() 的陷阱

每个枚举常量有一个 `ordinal()` 方法，返回它在声明中的位置（从 0 开始）。**不要用 ordinal 做业务逻辑**：

```java
public enum Size { SMALL, MEDIUM, LARGE }

Size.SMALL.ordinal()  // 0
Size.MEDIUM.ordinal() // 1
Size.LARGE.ordinal()  // 2
```

如果在 `MEDIUM` 和 `LARGE` 之间插入一个 `EXTRA_LARGE`，所有后续的 ordinal 都变了——依赖 ordinal 的代码会出 bug。用枚举常量本身或自定义字段来表示业务值。

### 2.4 EnumSet 与 EnumMap

Java 提供了两个专门针对 Enum 优化的集合：

- **`EnumSet`**：用位向量实现的 Set，比 `HashSet` 更高效（每个枚举常量对应一个 bit）
- **`EnumMap`**：用数组实现的 Map，key 是枚举常量，比 `HashMap` 更高效

```java
EnumSet<Color> warmColors = EnumSet.of(Color.RED, Color.ORANGE, Color.YELLOW);
EnumMap<Color, String> colorNames = new EnumMap<>(Color.class);
```

如果 key 是枚举类型，优先用 `EnumMap` 而非 `HashMap`。

### 2.5 基本类型：性能与抽象之间的取舍

Java 有 8 种基本类型：

| 类型 | 大小 | 范围 | 默认值 |
| :-- | :-- | :-- | :-- |
| `byte` | 1 字节 | -128 ~ 127 | 0 |
| `short` | 2 字节 | -32768 ~ 32767 | 0 |
| `int` | 4 字节 | -2^31 ~ 2^31-1 | 0 |
| `long` | 8 字节 | -2^63 ~ 2^63-1 | 0L |
| `float` | 4 字节 | IEEE 754 单精度 | 0.0f |
| `double` | 8 字节 | IEEE 754 双精度 | 0.0d |
| `char` | 2 字节 | 0 ~ 65535 | '\u0000' |
| `boolean` | 1 位/1 字节 | true / false | false |

**为什么 Java 要有基本类型？** 两个字：**性能**。

如果所有东西都是对象：

```java
Integer i = new Integer(10);
```

每次创建一个整数，都需要：

1. 在堆上分配内存（对象头 + 实例数据 + 对齐填充）
2. 创建对象引用
3. GC 最终需要回收这个对象

对于一个简单的循环计数器 `for (int i = 0; i < 1000000; i++)`，如果每次都创建一个 Integer 对象，会产生巨大的内存分配压力和 GC 负担。

基本类型直接在栈上存储值，没有对象头，没有 GC 开销，CPU 缓存友好。这是 Java 在"纯面向对象"和"实际性能"之间做出的务实妥协。

### 2.6 引用类型：变量、引用与对象

这是很多开发者理解不清的地方。看这行代码：

```java
User user = new User();
```

很多人认为"变量 `user` 就是对象"。实际上：

![stack-heap](/java/stack-heap.svg)

- **变量 `user`** 存在栈上，保存的是一个**引用**（本质上是一个内存地址）
- **对象本身** 存在堆上，包含对象头和实例数据
- `user` 不是对象，它是**指向对象的引用**

这个区分非常重要，因为它直接影响你对赋值、传参、相等性判断的理解：

```java
User a = new User();
User b = a;          // b 和 a 指向同一个对象
b.name = "Tom";
System.out.println(a.name);  // 输出 "Tom"——因为 a 和 b 是同一个对象
```

赋值 `b = a` 不是复制对象，而是复制引用。两个引用指向堆上的同一个对象。

### 2.7 自动装箱与拆箱

Java 5 引入了自动装箱（Autoboxing），让基本类型和包装类型之间可以自动转换：

```java
int a = 10;
Integer b = a;        // 自动装箱：int → Integer
int c = b;            // 自动拆箱：Integer → int
```

装箱的本质是调用 `Integer.valueOf(a)`，拆箱的本质是调用 `b.intValue()`。

自动装箱带来了一些隐蔽的性能问题：

```java
// ❌ 性能陷阱：每次循环都创建一个新的 Integer 对象
Long sum = 0L;
for (long i = 0; i < 10000000L; i++) {
    sum += i;  // 每次 += 都涉及拆箱 → 加法 → 装箱
}

// ✅ 正确做法：使用基本类型
long sum = 0L;
for (long i = 0; i < 10000000L; i++) {
    sum += i;
}
```

还有一个经典的面试坑：

```java
Integer a = 127;
Integer b = 127;
System.out.println(a == b);  // true（IntegerCache 缓存了 -128 ~ 127）

Integer c = 128;
Integer d = 128;
System.out.println(c == d);  // false（超出缓存范围，创建了两个不同对象）
```

`Integer.valueOf()` 对 -128 到 127 之间的值做了缓存。这是 JDK 的实现细节，但面试经常考。记住：**比较包装类型永远用 `equals()`，不要用 `==`**。

## 3. 对象模型：引用 vs 对象

深入理解 Java 的对象模型，是理解 JVM 内存布局、GC、并发锁机制的前提。

### 3.1 对象在哪里

Java 中，对象实例存储在**堆（Heap）**上，局部变量和对象引用存储在**栈（Stack）**上。

```java
public void process() {
    int count = 10;              // count 在栈上
    User user = new User();      // user 引用在栈上，User 对象在堆上
    user.name = "Tom";           // 通过引用操作堆上的对象
}
```

当方法 `process()` 执行完毕：

- 栈帧被弹出，`count` 和 `user` 引用消失
- 堆上的 User 对象变成"不可达"（没有引用指向它了）
- GC 在某个时刻回收这个对象

### 3.2 null 的含义

```java
User user = null;
```

`null` 表示"这个引用不指向任何对象"。它不是对象，不是空字符串，不是零——它是一个**空引用**。

对 `null` 调用任何方法都会抛出 `NullPointerException`（NPE）：

```java
User user = null;
user.getName();  // NPE!
```

NPE 是 Java 中最常见的运行时异常之一。后面的 Lambda 章节会讲 `Optional` 如何用类型系统来表达"值可能不存在"，从而减少 NPE。

### 3.3 对象的创建过程

当你写 `new User()` 时，JVM 做了什么？

![jvm-object-creation](/java/jvm-object-creation.svg)

现在只需要知道：对象创建不是一瞬间的事，JVM 做了很多幕后工作。第二卷"对象模型"一章会详细展开。

### 3.4 对象的内存布局

HotSpot JVM 中，一个 Java 对象在堆中的结构：

![jvm-object-layout](/java/jvm-object-layout.svg)

对象头中的 **Mark Word** 非常重要——它不仅存储 hashCode 和 GC 年龄，还存储锁状态信息。当对象被 `synchronized` 锁住时，Mark Word 的内容会发生变化（偏向锁 → 轻量级锁 → 重量级锁）。这是第三卷 `synchronized` 的关键前置知识。

## 4. equals / hashCode / identity

对象相等性是 Java 中最容易出错的概念之一。很多 bug 的根源就是对 `==` 和 `equals()` 的混淆。

### 4.1 三个层次

| 层次 | 含义 | 运算符/方法 |
| :-- | :-- | :-- |
| **identity** | 是否同一个对象（内存地址相同） | `==` |
| **equality** | 逻辑上是否相等 | `equals()` |
| **hash** | 对象的哈希指纹 | `hashCode()` |

```java
String a = new String("hello");
String b = new String("hello");

a == b        // false——两个不同的对象
a.equals(b)   // true——逻辑上相等
```

### 4.2 == 运算符

对于基本类型，`==` 比较的是**值**：

```java
int x = 10;
int y = 10;
x == y  // true
```

对于引用类型，`==` 比较的是**引用地址**（是否同一个对象）：

```java
User u1 = new User("Tom");
User u2 = new User("Tom");
u1 == u2  // false——两个不同的对象，虽然内容相同
```

### 4.3 equals() 方法

`equals()` 是 `Object` 类定义的方法，默认实现就是 `==`：

```java
// Object 类的默认实现
public boolean equals(Object obj) {
    return (this == obj);
}
```

如果想让"内容相同"的对象被视为相等，就需要**重写** `equals()`：

```java
public class User {
    private String name;
    private int age;

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        User user = (User) o;
        return age == user.age && Objects.equals(name, user.name);
    }
}
```

### 4.4 hashCode() 的契约

Java 规范要求：

1. **如果 `a.equals(b)` 为 true，那么 `a.hashCode()` 必须等于 `b.hashCode()`**
2. 如果 `a.hashCode()` 等于 `b.hashCode()`，`a.equals(b)` 不一定为 true（哈希碰撞）

为什么？因为 `HashMap`、`HashSet` 等哈希容器先用 `hashCode()` 定位桶，再用 `equals()` 判断是否是同一个 key。如果两个 `equals()` 相等的对象有不同的 `hashCode()`，`HashMap` 会把它们放到不同的桶里——你 `put` 了一个，`get` 另一个却找不到。

```java
// ❌ 经典 bug：重写了 equals 但没重写 hashCode
User u1 = new User("Tom", 25);
User u2 = new User("Tom", 25);

Map<User, String> map = new HashMap<>();
map.put(u1, "value");

map.get(u2);  // 可能返回 null！因为 u1 和 u2 的 hashCode 不同
```

**规则：重写 `equals()` 必须同时重写 `hashCode()`。** 现代 IDE 可以一键生成这两个方法，没有理由手写犯错。

### 4.5 Objects 工具类

Java 7 引入的 `Objects` 工具类简化了 `equals()` 和 `hashCode()` 的实现：

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof User)) return false;
    User user = (User) o;
    return age == user.age && Objects.equals(name, user.name);
}

@Override
public int hashCode() {
    return Objects.hash(name, age);
}
```

## 5. String 与不可变对象

`String` 是 Java 中使用最频繁的类，也是理解不可变对象（Immutable Object）的最佳案例。

### 5.1 String 为什么是不可变的

```java
public final class String {
    private final char[] value;  // JDK 8 及之前
    // JDK 9+ 改为 byte[] + coder，节省内存
}
```

`String` 类是 `final` 的（不能被继承），内部的 `value` 数组也是 `final` 的（不能被重新赋值），而且没有提供任何修改 `value` 内容的方法。

**为什么要设计成不可变？**

**1. 字符串常量池共享**

```java
String a = "hello";
String b = "hello";
// a 和 b 指向常量池中同一个 "hello" 对象
```

如果 String 是可变的，`a.append("!")` 就会把 `b` 的值也改了——因为它们是同一个对象。不可变保证了共享是安全的。

**2. 线程安全**

不可变对象天然线程安全——没有任何线程可以修改它的状态，所以不需要同步。这是第三卷并发编程的重要基础。

**3. 哈希缓存**

String 的 `hashCode()` 只需要计算一次，之后缓存起来。因为值不会变，hashCode 也不会变。这让 String 作为 `HashMap` 的 key 非常高效。

### 5.2 字符串拼接的陷阱

```java
String result = "";
for (int i = 0; i < 10000; i++) {
    result += i;  // 每次 += 都创建一个新的 String 对象
}
```

每次 `+=` 都会：

1. 创建一个 `StringBuilder`
2. append 当前字符串和新值
3. 调用 `toString()` 创建一个新的 String 对象

10000 次循环 = 10000 个临时 StringBuilder + 10000 个临时 String。

```java
// ✅ 正确做法
StringBuilder sb = new StringBuilder();
for (int i = 0; i < 10000; i++) {
    sb.append(i);
}
String result = sb.toString();
```

### 5.3 String.intern()

```java
String a = new String("hello");  // 堆上新对象
String b = a.intern();           // 放入常量池，返回常量池中的引用
String c = "hello";              // 直接引用常量池

b == c  // true
```

`intern()` 将字符串放入 JVM 的字符串常量池（StringTable）。JDK 7 之后，StringTable 从永久代移到了堆中，由 GC 管理。适度使用 `intern()` 可以节省内存（重复字符串只存一份），但过度使用会导致 StringTable 膨胀，反而增加 GC 压力。

### 5.4 其他不可变对象

String 不是 Java 中唯一的不可变对象。`Integer`、`Long`、`Double` 等包装类型也是不可变的。`LocalDate`、`BigDecimal` 等也是。

设计不可变对象的原则：

1. 类声明为 `final`（或所有方法为 `final`）
2. 所有字段为 `private final`
3. 不提供修改状态的方法
4. 构造时深拷贝可变参数，返回时深拷贝可变字段

## 6. 类型转换与编译期检查

Java 的类型系统在编译期和运行期都有检查机制，这使得很多错误在代码运行之前就被发现。

### 6.1 基本类型转换

**自动扩大（Widening）**——安全，编译器自动完成：

```txt
byte → short → int → long → float → double
         char →
```

```java
int a = 10;
long b = a;     // OK，int 自动扩大为 long
double c = b;   // OK，long 自动扩大为 double
```

**强制缩小（Narrowing）**——可能丢失精度，需要显式转换：

```java
double d = 3.14;
int i = (int) d;  // i = 3，小数部分丢失

long big = 130L;
byte b = (byte) big;  // b = -126，溢出（byte 范围是 -128~127）
```

### 6.2 引用类型转换

**向上转型（Upcasting）**——安全，自动完成：

```java
String s = "hello";
Object o = s;  // String 是 Object 的子类，自动向上转型
```

**向下转型（Downcasting）**——需要运行时检查：

```java
Object o = "hello";
String s = (String) o;  // OK，运行时 o 确实是 String

Object o2 = 123;
String s2 = (String) o2;  // ClassCastException！运行时 o2 是 Integer
```

向下转型在字节码层面对应 `checkcast` 指令——JVM 在运行时检查对象的实际类型，如果不匹配就抛出 `ClassCastException`。

### 6.3 编译器如何利用类型

Java 编译器利用类型信息做三件事：

**1. 类型检查**——在编译期拒绝非法操作：

```java
String s = 123;  // 编译错误：int 不能赋值给 String
"hello" - 1;     // 编译错误：String 不支持减法
```

**2. 方法重载解析**——根据参数类型选择正确的方法：

```java
void print(String s) { ... }
void print(int i) { ... }

print("hello");  // 编译器选择 print(String)
print(42);       // 编译器选择 print(int)
```

**3. 泛型检查**——在编译期保证类型安全（[第三章](./chapter-03-generics)详细展开）

编译器在字节码生成之前就阻止了错误。这是静态类型语言的核心优势：错误发现得越早，修复成本越低。

> 本章建立了 Java 的世界观和类型系统的完整认知。下一章《面向对象》将回答：Java 如何利用这套类型系统来组织复杂的软件世界——封装、继承、多态、接口，这些不是语法概念，而是解决软件复杂性的工程方法。
