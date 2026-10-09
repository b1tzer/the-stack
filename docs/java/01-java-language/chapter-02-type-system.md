# Java 类型系统：类型分类与编译期检查

本页面向已经能编写类和方法、但还不清楚 Java 类型边界的读者，回答三个问题：Java 如何区分基本类型和引用类型，编译器如何检查赋值与转换，哪些问题必须留到运行时处理。

对象存储、相等性和包装类型缓存属于[对象与值语义](./chapter-03-object-values.md)；多态属于[面向对象](./chapter-04-oop.md)；泛型的类型变量、擦除和通配符属于[泛型](./chapter-05-generics.md)。本页只建立这些章节共同依赖的类型模型。

## 1. Java 类型如何分类

Java 语言规范把类型分为基本类型（primitive type）和引用类型（reference type）。每个变量、表达式和方法调用在编译期都有确定的类型；编译器据此拒绝无法安全完成的赋值、访问和方法调用。

引用类型包括类类型、接口类型和数组类型；`null` 是特殊的空引用类型。枚举和 record（Java 16 起）是类类型的特殊形式，但它们仍然遵守引用类型的基本规则。

![Java 类型分类：基本类型与引用类型，以及引用类型下的类、接口和数组](/java/type-hierarchy.svg)

图中的文字等价于以下分类：

- 基本类型：`boolean`、`byte`、`short`、`int`、`long`、`char`、`float`、`double`。
- 引用类型：类、接口和数组；引用类型的值指向对象，而不是对象本身。

### 1.1 基本类型：值与默认值

基本类型直接表达值，不通过对象引用访问。下表中的“默认值”只适用于类变量、实例变量和数组元素；局部变量必须在使用前由初始化或赋值明确提供值。

| 类型 | 值范围或表示 | 字段/数组元素的默认值 |
| :-- | :-- | :-- |
| `byte` | 8 位有符号整数，-128 ~ 127 | `0` |
| `short` | 16 位有符号整数，-32768 ~ 32767 | `0` |
| `int` | 32 位有符号整数，-2^31 ~ 2^31-1 | `0` |
| `long` | 64 位有符号整数，-2^63 ~ 2^63-1 | `0L` |
| `float` | IEEE 754 binary32 | `0.0f` |
| `double` | IEEE 754 binary64 | `0.0d` |
| `char` | 16 位无符号 Unicode 代码单元，0 ~ 65535 | `'\u0000'` |
| `boolean` | `true` 或 `false` | `false` |

基本类型让热循环中的计数器、索引和累计值不需要包装对象。这里的性能判断要看实际代码：JIT 可能消除部分短生命周期对象分配，但包装类型仍会引入可空性、转换和缓存语义。需要数值累计时，通常优先使用 `int` 或 `long`。

### 1.2 引用类型：变量、引用与对象

声明一个引用类型变量时，变量保存的是引用；引用指向一个对象，而不是对象的副本。

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

`second = first` 复制的是引用。两个变量因此指向同一个对象，修改对象状态会通过两个变量观察到。赋值不会复制对象，也不会把对象从堆移动到另一个位置。

对象实例由 JVM 的堆管理，方法执行中的局部变量保存在当前帧的局部变量数组中。JVMS 不要求帧必须以普通进程栈的物理方式分配，也不规定引用必须暴露为一个内存地址；具体布局和优化由 JVM 实现决定。需要继续理解对象布局时，阅读[HotSpot 对象布局](../02-jvm-runtime/chapter-03-object-layout.md)；需要理解对象可达性和 GC 时，阅读[对象与值语义](./chapter-03-object-values.md)。

### 1.3 枚举：受限的类

枚举声明定义的是一种受限的类，用来表示少量命名实例：

```java
public enum Color {
    RED, GREEN, BLUE
}
```

枚举常量在类初始化过程中创建。JLS 还规定了额外约束：不能显式构造枚举实例，也不能通过普通类继承扩展枚举类型；反射构造会被禁止，序列化机制会避免反序列化产生重复常量。这里的“单例”应理解为同一个枚举类初始化后的一组常量；不同类加载器可能各自初始化同一个枚举类。

枚举可以有字段、构造方法、方法，并可以实现接口：

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

    public int getCode() {
        return code;
    }
}
```

`ordinal()` 返回常量在声明中的位置，从 0 开始。它是内部遍历和实现细节，不是稳定的业务编号：

```java
public enum Size {
    SMALL, MEDIUM, LARGE
}

class OrdinalExample {
    public static void main(String[] args) {
        System.out.println(Size.SMALL.ordinal());   // 0
        System.out.println(Size.MEDIUM.ordinal());  // 1
        System.out.println(Size.LARGE.ordinal());   // 2
    }
}
```

在 `MEDIUM` 和 `LARGE` 之间插入新常量会改变后续 `ordinal()` 值。业务逻辑应使用枚举常量本身，或显式的业务字段；不要把声明顺序当作持久化协议。

枚举常量也可以作为 `switch` 的选择器，让分支直接使用有类型的常量，而不是比较字符串编号。

枚举作为 `Set` 元素或 `Map` key 时，可以使用 [EnumSet 与 EnumMap](./chapter-09-collections.md)。它们是集合章节的内容，本页只保留枚举的类型语义。

### 1.4 自动装箱与拆箱

Java 5 允许基本类型和对应包装类型之间进行隐式转换：

```java
class BoxingExample {
    public static void main(String[] args) {
        int primitiveValue = 10;
        Integer boxedValue = primitiveValue; // 装箱
        int restoredValue = boxedValue;      // 拆箱
    }
}
```

当前 `javac` 通常会把装箱编译为 `Integer.valueOf(...)`，把拆箱编译为 `Integer.intValue()`；但这两个方法调用是编译器生成的实现细节，不是程序员显式写出的 API。包装类型是对象，可以为 `null`，因此把 `Integer` 当作 `int` 使用会在拆箱时抛出 `NullPointerException`。

包装类型还改变了相等性语义：`==` 比较引用身份，`equals()` 才表达包装值的相等性。装箱缓存和累计变量的写法，见[对象与值语义](./chapter-03-object-values.md)。

## 2. 类型转换与编译期检查

Java 在编译期完成大部分类型检查，但检查分为不同类型：有些转换可以自动发生，有些需要显式写法，还有些只能在运行时根据实际对象确认。

### 2.1 基本类型转换

基本类型转换分为两类。

**自动扩大（widening primitive conversion）** 不需要显式转换：

```txt
byte → short → int → long → float → double
         char → int
```

`int → long`、`float → double` 等转换不会改变数值量级；但 `int → float`、`long → float` 和 `long → double` 可能丢失精度。自动扩大不会抛出运行时异常，但“自动”不等于“无损”。

**强制缩小（narrowing primitive conversion）** 可能丢失精度或改变数值，必须显式写出：

```java
class NarrowingExample {
    public static void main(String[] args) {
        double value = 3.14;
        int integer = (int) value; // integer = 3，小数部分丢失

        long large = 130L;
        byte wrapped = (byte) large; // wrapped = -126，超出 byte 范围后回绕
    }
}
```

### 2.2 引用类型转换

把子类型的值赋给父类型或接口变量是自动的向上转型：

```java
class UpcastingExample {
    public static void main(String[] args) {
        String text = "hello";
        Object value = text;
    }
}
```

向下转型可能失败，因为编译期只知道声明类型，运行时才知道引用实际指向的对象：

```java
class DowncastingExample {
    public static void main(String[] args) {
        Object value = "hello";
        String text = (String) value; // 成功

        Object boxedNumber = 123;
        String invalid = (String) boxedNumber; // ClassCastException：实际是 Integer
    }
}
```

引用转换在字节码中通常对应 `checkcast`。编译器会拒绝明显不可能的转换，但允许通过编译不等于运行时一定成功；运行时类型不匹配会抛出 `ClassCastException`。

### 2.3 编译器如何检查类型

编译器主要用类型信息完成以下检查：

**1. 赋值与成员访问**

```java
String name = 123;           // 编译错误：int 不能赋值给 String
int length = name.length();  // name 的声明类型必须有 length() 方法
```

局部变量还必须满足“先赋值后使用”的确定赋值规则；这与字段和数组元素拥有默认值是两套规则。

**2. 方法重载解析**

```java
class OverloadExample {
    void print(String text) { /* ... */ }
    void print(int number) { /* ... */ }

    void run() {
        print("hello"); // 选择 print(String)
        print(42);      // 选择 print(int)
    }
}
```

编译器根据调用时的参数类型选择候选方法；如果转换需要额外的装箱或扩大，规则会比简单匹配更复杂，但错误通常仍会在编译期暴露。

**3. 泛型与接口契约**

```java
import java.util.ArrayList;
import java.util.List;

class GenericExample {
    public static void main(String[] args) {
        List<String> names = new ArrayList<>();
        names.add("Ada");
        String first = names.get(0);
    }
}
```

泛型把集合元素的类型检查提前到编译期；擦除、桥接方法和运行时 `checkcast` 的边界见[泛型](./chapter-05-generics.md)。

### 2.4 运行时仍需检查的边界

静态类型检查不能消除所有错误。以下问题必须留到运行时：

- 向下转型时，引用实际指向的对象是否匹配目标类型。
- 拆箱一个为 `null` 的包装引用。
- 数组下标会在运行时检查；整数溢出和浮点舍入按语言规则发生，需要业务逻辑主动避免。
- 通过接口或父类型调用方法时，实际对象的方法分派结果。

因此，Java 的类型系统负责尽早拒绝确定的类型错误，而不负责替代运行时的空值、边界和动态类型检查。

## 3. 后续阅读

本页建立了类型分类、引用语义和编译期检查的基础。接下来：

- [对象与值语义](./chapter-03-object-values.md)解释引用与对象、`equals`/`hashCode`、不可变性和包装类型缓存。
- [面向对象](./chapter-04-oop.md)解释继承、接口和多态如何组织类型关系。
- [泛型](./chapter-05-generics.md)解释类型变量、通配符和类型擦除。
- [标准集合](./chapter-09-collections.md)解释如何按契约选择 `List`、`Set`、`Map`，以及枚举专用容器。

> 本页的技术边界按 Java SE 21 核对；自动装箱自 Java 5 引入，record 自 Java 16 引入。官方参考：[Java Language Specification](https://docs.oracle.com/javase/specs/jls/se21/html/jls.html)、[Java Virtual Machine Specification](https://docs.oracle.com/javase/specs/jvms/se21/html/jvms.html)。
