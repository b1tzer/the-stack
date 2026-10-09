# 对象与值语义

引用决定变量如何指向对象，对象自身的状态和值语义则决定比较、缓存与复用行为。本章集中解释这些容易混淆的语言语义。

## 1. 对象模型：引用 vs 对象

深入理解 Java 的对象模型，是理解 JVM 内存布局、GC、并发锁机制的前提。

### 1.1 对象在哪里

JVM 为对象实例分配堆内存；方法执行时，局部变量和引用保存在当前方法帧的局部变量数组中。这里的“堆”和“栈”是逻辑模型：JVMS 不要求方法帧必须以普通进程栈的物理方式分配，也不规定引用必须暴露为内存地址。JIT 还可能把局部值保存在寄存器中。理解 GC 时，更重要的是判断对象是否仍然可达，而不是追踪它位于哪一块物理内存。

```java
public void process() {
    int count = 10;              // 方法帧中的局部变量
    StringBuilder text = new StringBuilder("Tom"); // text 保存引用，对象由堆管理
    text.append("!");            // 通过引用操作堆上的对象
}
```

![引用与对象的逻辑关系：方法帧中的 text 引用指向堆中的 StringBuilder 对象](/java/stack-heap.svg)

当方法 `process()` 执行完毕：

- 方法帧结束，`count` 和 `text` 引用不再存在
- 堆上的 StringBuilder 对象变成"不可达"（没有引用指向它了）
- GC 在某个时刻回收这个对象

引用赋值也不会复制对象：

```java
class ReferenceAssignment {
    public static void main(String[] args) {
        StringBuilder first = new StringBuilder("Tom");
        StringBuilder second = first;

        second.append("!");
        System.out.println(first); // Tom!
    }
}
```

`second = first` 复制的是引用，因此两个变量指向同一个对象。对对象状态的修改会通过两个变量同时可见。

### 1.2 null 的含义

```java
User user = null;
```

`null` 表示"这个引用不指向任何对象"。它不是对象，不是空字符串，不是零——它是一个**空引用**。

对 `null` 调用任何方法都会抛出 `NullPointerException`（NPE）：

```java
User user = null;
user.getName();  // NPE!
```

NPE 是 Java 中最常见的运行时异常之一。后面的[异常与资源管理](./chapter-08-exceptions.md)会说明何时应显式失败，[Stream 与 Optional](./chapter-10-stream-optional.md)会说明 `Optional` 如何表达“结果可能不存在”，从而减少无意的 NPE。

### 1.3 对象的创建过程

当你写 `new User()` 时，JVM 做了什么？

![jvm-object-creation](/java/jvm-object-creation.svg)

对象创建和字段布局属于 JVM 实现细节。[HotSpot 对象布局](../02-jvm-runtime/chapter-03-object-layout.md)会继续解释对象头、字段排列、对齐填充和锁状态。

## 2. equals / hashCode / identity

对象相等性是 Java 中最容易出错的概念之一。很多 bug 的根源就是对 `==` 和 `equals()` 的混淆。

### 2.1 三个层次

| 层次 | 含义 | 运算符/方法 |
| :-- | :-- | :-- |
| **identity** | 是否同一个对象 | `==` |
| **equality** | 逻辑上是否相等 | `equals()` |
| **hash** | 对象的哈希指纹 | `hashCode()` |

```java
String a = new String("hello");
String b = new String("hello");

a == b        // false——两个不同的对象
a.equals(b)   // true——逻辑上相等
```

### 2.2 == 运算符

对于基本类型，`==` 比较的是**值**：

```java
int x = 10;
int y = 10;
x == y  // true
```

对于引用类型，`==` 比较的是两个引用是否指向同一个对象：

```java
User u1 = new User("Tom");
User u2 = new User("Tom");
u1 == u2  // false——两个不同的对象，虽然内容相同
```

### 2.3 equals() 方法

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

### 2.4 hashCode() 的契约

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

### 2.5 Objects 工具类

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

### 2.6 包装类型与自动装箱

`Integer`、`Long` 等包装类型是不可变对象；`int`、`long` 等基本类型表达值。Java 允许两者之间隐式转换，但这不会消除两者的语义差异：

```java
class BoxingExample {
    public static void main(String[] args) {
        int primitiveValue = 10;
        Integer boxedValue = primitiveValue; // 装箱
        int restoredValue = boxedValue;      // 拆箱
    }
}
```

当前 `javac` 通常把装箱编译为 `Integer.valueOf(...)`，把拆箱编译为 `Integer.intValue()`。包装引用可以为 `null`，因此拆箱空引用会抛出 `NullPointerException`。

`==` 比较的是引用身份，不是包装值本身：

```java
class IntegerCacheExample {
    public static void main(String[] args) {
        Integer first = 127;
        Integer second = 127;
        System.out.println(first == second); // true

        Integer third = 128;
        Integer fourth = 128;
        System.out.println(third == fourth); // 结果依赖实现和缓存配置，不应依赖
    }
}
```

`Integer.valueOf()` 总会缓存 -128 到 127 的值，也可能缓存范围外的值。对于装箱值来自编译期常量的情况，JLS 只保证 -128 到 127 的常量引用相同；范围外不能依赖 `==`。比较包装值应使用 `equals()`，或者先拆箱再用 `==` 比较基本类型。

循环累计也应优先使用基本类型：

```java
class AccumulationExample {
    public static void main(String[] args) {
        Long boxedSum = 0L;
        for (long value = 0; value < 10_000_000L; value++) {
            boxedSum += value; // 每次复合赋值都会拆箱、相加并重新装箱
        }

        long primitiveSum = 0L;
        for (long value = 0; value < 10_000_000L; value++) {
            primitiveSum += value;
        }
    }
}
```

第一条循环会反复执行拆箱和装箱，并可能分配 `Long` 对象；缓存和 JIT 优化可能减少实际分配次数，所以性能结论应以目标 JVM 上的测量为准。数值累计通常直接使用 `long`。

> 包装类型缓存行为按 Java SE 21 核对。官方参考：[`Integer` API 文档](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Integer.html)、[Java Language Specification](https://docs.oracle.com/javase/specs/jls/se21/html/jls.html)。

## 3. String 与不可变对象

`String` 是 Java 中使用最频繁的类，也是理解不可变对象（Immutable Object）的最佳案例。

### 3.1 String 为什么是不可变的

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

不可变对象天然线程安全——没有任何线程可以修改它的状态，所以不需要同步。这是[Java 并发](../03-java-concurrency/chapter-01-why-concurrency.md)的重要基础。

**3. 哈希缓存**

String 的 `hashCode()` 只需要计算一次，之后缓存起来。因为值不会变，hashCode 也不会变。这让 String 作为 `HashMap` 的 key 非常高效。

### 3.2 字符串拼接的陷阱

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

### 3.3 String.intern()

```java
String a = new String("hello");  // 堆上新对象
String b = a.intern();           // 放入常量池，返回常量池中的引用
String c = "hello";              // 直接引用常量池

b == c  // true
```

`intern()` 将字符串放入 JVM 的字符串常量池（StringTable）。JDK 7 之后，StringTable 从永久代移到了堆中，由 GC 管理。适度使用 `intern()` 可以节省内存（重复字符串只存一份），但过度使用会导致 StringTable 膨胀，反而增加 GC 压力。

### 3.4 其他不可变对象

String 不是 Java 中唯一的不可变对象。`Integer`、`Long`、`Double` 等包装类型也是不可变的。`LocalDate`、`BigDecimal` 等也是。

设计不可变对象的原则：

1. 类声明为 `final`（或所有方法为 `final`）
2. 所有字段为 `private final`
3. 不提供修改状态的方法
4. 构造时深拷贝可变参数，返回时深拷贝可变字段
