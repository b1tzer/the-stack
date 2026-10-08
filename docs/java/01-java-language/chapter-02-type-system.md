# Java 类型系统

> Java 区分基本类型和引用类型，主要影响值表示、默认值、集合/泛型使用和对象分配。局部 `int` 变量通常由 JVM 以 32 位值保存；字段作为对象的一部分，其布局由对象头、对齐和 JVM 实现决定。`Integer` 表示可空的对象引用，对象头尺寸也取决于 JVM 与架构，因此不能用一个固定对象大小推算整体性能差距。

## 1. 基本类型与引用类型

Java 的类型世界分为两大阵营：基本类型（Primitive）和引用类型（Reference）。理解这个划分，是理解 JVM 运行时内存结构、对象模型、泛型的前提。

### 1.1 类型体系总览

![type-hierarchy](/java/type-hierarchy.svg)

### 1.2 Enum：编译器魔法加持的引用类型

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

### 1.3 ordinal() 的陷阱

每个枚举常量有一个 `ordinal()` 方法，返回它在声明中的位置（从 0 开始）。**不要用 ordinal 做业务逻辑**：

```java
public enum Size { SMALL, MEDIUM, LARGE }

Size.SMALL.ordinal()  // 0
Size.MEDIUM.ordinal() // 1
Size.LARGE.ordinal()  // 2
```

如果在 `MEDIUM` 和 `LARGE` 之间插入一个 `EXTRA_LARGE`，所有后续的 ordinal 都变了——依赖 ordinal 的代码会出 bug。用枚举常量本身或自定义字段来表示业务值。

### 1.4 EnumSet 与 EnumMap

Java 提供了两个专门针对 Enum 优化的集合：

- **`EnumSet`**：用位向量实现的 Set，比 `HashSet` 更高效（每个枚举常量对应一个 bit）
- **`EnumMap`**：用数组实现的 Map，key 是枚举常量，比 `HashMap` 更高效

```java
EnumSet<Color> warmColors = EnumSet.of(Color.RED, Color.ORANGE, Color.YELLOW);
EnumMap<Color, String> colorNames = new EnumMap<>(Color.class);
```

如果 key 是枚举类型，优先用 `EnumMap` 而非 `HashMap`。

### 1.5 基本类型：性能与抽象之间的取舍

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

### 1.6 引用类型：变量、引用与对象

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

### 1.7 自动装箱与拆箱

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

`Integer.valueOf()` 默认缓存部分小整数，缓存范围受 JVM 属性配置影响。比较数值时使用 `equals()` 可直接表达数值相等；`==` 对包装对象比较引用，容易受缓存和装箱时机影响。


## 2. 类型转换与编译期检查

Java 的类型系统在编译期和运行期都有检查机制，这使得很多错误在代码运行之前就被发现。

### 2.1 基本类型转换

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

### 2.2 引用类型转换

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

### 2.3 编译器如何利用类型

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

**3. 泛型检查**——在编译期保证类型安全（[泛型](./chapter-05-generics.md)详细展开）

编译器在字节码生成之前就阻止了错误。这是静态类型语言的核心优势：错误发现得越早，修复成本越低。

> 本章建立了 Java 的世界观和类型系统的完整认知。下一章《面向对象》将回答：Java 如何利用这套类型系统来组织复杂的软件世界——封装、继承、多态、接口，这些不是语法概念，而是解决软件复杂性的工程方法。
