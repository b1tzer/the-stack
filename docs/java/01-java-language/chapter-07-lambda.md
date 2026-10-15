# Lambda 与函数式编程

> Java 8 引入 Lambda 表达式，让开发者可以更简洁地表示一段行为并传递给其他方法。Lambda 通常以函数式接口作为目标类型，例如 `Runnable`、`Comparator`、`Predicate`。它与匿名内部类在语言语义和编译实现上都有区别，以 OpenJDK 常见的 javac 实现为例，编译器通过 `invokedynamic` 指令和 `LambdaMetafactory` 支持 Lambda 的运行时创建，而不是像匿名内部类那样直接为每个表达式生成独立的类文件。

函数式编程强调将函数作为值使用，例如把一段计算逻辑传给其他函数，或组合多个处理步骤。Java 没有独立的函数类型，但可以通过函数式接口和 Lambda 表达式表达这类用法。因此 Java 的 Lambda 并不意味着 Java 变成纯函数式语言，而是在原有类型系统和面向对象模型之上提供了更简洁的行为表示方式。

## 1. 为什么需要 Lambda

### 1.1 Java 不能直接传递方法

Java 的方法必须挂在类或对象上。你可以调用 `order.pay()`，也可以把 `order` 这个对象传来传去，但你不能把 `pay` 这个方法本身取出来，当作一个值传给别的方法。

排序把这个限制暴露得最清楚。`Collections.sort` 的排序逻辑是通用的，它缺的只是"如何比较两个元素"——而"如何比较"恰恰是一段逻辑，不是一个对象：

```java
Collections.sort(list, ???);  // 需要传入"比较两个 User"的逻辑
```

Java 8 之前，调用方需要通过已有的 `Comparator` 实例或自定义实现类提供比较逻辑，匿名内部类是一种常见写法，但不是唯一方式。

### 1.2 匿名内部类：把行为包装进对象

早年的办法，是把这段逻辑伪装成一个对象——匿名内部类：

```java
Collections.sort(list, new Comparator<User>() {
    @Override
    public int compare(User a, User b) {
        return Integer.compare(a.getAge(), b.getAge());
    }
});
```

当实现只有一个简单的比较表达式时，方法声明和接口结构会占据较多篇幅。匿名内部类允许在调用处直接实现 `Comparator`，但需要显式声明方法。

### 1.3 调用方需要的是一段比较逻辑

匿名内部类解决了"能传"的问题，但代价不匹配：**想要的只是一段比较逻辑，却被迫创建了一个完整的类。**

一个匿名内部类是一个真正的类，它有自己的类型、自己的 `this`，编译后还生成独立的 `.class` 文件。为一个简单的比较逻辑付出这些，成本偏高。

Java 8 的 Lambda 要解决的就是这个错位，让"一段行为"可以作为一个值直接写出来。

## 2. Lambda 与函数式接口

### 2.1 Lambda：简洁描述行为，但仍需要类型

Lambda 让上面的例子变成一行：

```java
Collections.sort(list, (a, b) -> Integer.compare(a.getAge(), b.getAge()));
```

但 Java 不是纯函数式语言，它没有独立的"函数类型"。Lambda 表达式本身**没有类型**——`(a, b) -> ...` 单独写出来，编译器不知道它是什么。它需要一个**目标类型**来落地。

### 2.2 函数式接口：行为被适配成接口类型

看这个最常见的写法：

```java
Runnable r = () -> System.out.println("hello");
```

这里的 Lambda 不是 `Runnable`。更准确的说法是：**这段行为被适配成了一个 `Runnable`。**

`Runnable` 是目标类型，它决定了 Lambda 的"形状"（无参数、无返回值）。Lambda 表达式本身是一段还没定型的行为描述，由目标类型把它收编成一个具体接口的实例。

这个目标类型必须满足一个条件：是**函数式接口**，只有一个有效抽象方法的接口。与 `Object` 公共实例方法签名对应的方法不计入抽象方法数，接口还可以包含 `default` 方法和 `static` 方法。

```java
@FunctionalInterface  // 可选，但推荐——编译器会检查是否只有一个抽象方法
public interface Comparator<T> {
    int compare(T o1, T o2);  // 唯一的抽象方法

    // 可以有 default 方法和 static 方法，不影响函数式接口的定义
    default Comparator<T> reversed() { ... }
}
```

### 2.3 标准函数式接口

绝大多数场景不用自己定义函数式接口，Java 8 在 `java.util.function` 包提供了一套标准接口：

| 接口 | 抽象方法 | 用途 | 示例 |
| :-- | :-- | :-- | :-- |
| `Function<T,R>` | `R apply(T t)` | 类型转换 | `User → UserDTO` |
| `Consumer<T>` | `void accept(T t)` | 消费数据 | 打印一个对象 |
| `Supplier<T>` | `T get()` | 提供数据 | 创建新对象 |
| `Predicate<T>` | `boolean test(T t)` | 条件判断 | `user.age > 18` |
| `UnaryOperator<T>` | `T apply(T t)` | 一元运算 | 字符串转大写 |
| `BinaryOperator<T>` | `T apply(T a, T b)` | 二元运算 | 两数相加 |

### 2.4 Lambda 与匿名内部类的区别

最常踩的坑是 `this` 语义。Lambda 的 `this` 指向外围对象，匿名内部类的 `this` 指向匿名类实例：

```java
class Example {
    private String name = "outer";

    Runnable lambda = () -> System.out.println(this.name);  // 打印 outer

    Runnable anonymous = new Runnable() {
        private String name = "inner";
        public void run() {
            System.out.println(this.name);  // 打印 inner
        }
    };
}
```

Lambda 捕获的局部变量必须是 `final` 或事实上不可变。捕获的引用不能重新赋值，但不代表引用指向的对象状态不可变，捕获可变对象后 Lambda 仍可能产生副作用。

## 3. Lambda 的运行时机制

### 3.1 Lambda 到底是什么：编译器提取方法，JVM 创建对象

`Runnable r = () -> System.out.println("hello")` 这一行，最终要变成一个能调用 `run()` 的对象。这件事由编译器和 JVM 分工完成。

**编译器做一半**：把 Lambda 的身体提取成一个普通方法。javac 会为它生成一个合成方法，名字类似 `lambda$test$0`：

```txt
源码：  () -> System.out.println("hello")
           ↓ javac 提取
方法：  lambda$test$0() {          ← 行为搬到这里
           System.out.println("hello");
       }

原位置：invokedynamic #0, LambdaMetafactory   ← 原位置变成这条指令
```

**JVM 做另一半**：运行时创建这个函数式接口的对象。注意编译器**没有**在编译期生成一个实现 `Runnable` 的类——它只留下一条 `invokedynamic` 指令，把"如何创建这个对象"推迟到运行时。

### 3.2 为什么需要 invokedynamic

`invokedynamic` 是 Java 7 引入的 JVM 指令。它与常见的虚方法调用指令不同，通过引导方法（bootstrap method）在运行时解析调用点并获得一个 CallSite。Java 8 的 Lambda 实现利用这一机制，把 Lambda 表达式与相应的函数式接口实现关联起来，具体实现策略由运行时决定，不必在编译期为每个 Lambda 直接生成独立的 `.class` 文件。

为什么 Lambda 要这样？三个原因：

1. **延迟绑定**：Lambda 对象怎么创建，由运行时的 JVM 决定，而不是写死在字节码里。运行时实现策略可以调整，无需改变语言层面的 Lambda 语义。
2. **JVM 可优化**：运行时生成的实现，JVM 可以做内联、逃逸分析。
3. **避免编译期为每个 Lambda 生成独立类文件**：匿名内部类每个都会生成一个 `.class` 文件，Lambda 通常不会在编译期这样做。运行时仍可能生成承载 Lambda 实例的类，具体方式由实现决定。

### 3.3 LambdaMetafactory：建立方法映射

第一次执行到 `invokedynamic` 时，JVM 调用一个 bootstrap method——`LambdaMetafactory.metafactory`。

它要做的核心事，是**把函数式接口的抽象方法和 Lambda body 提取出的方法对接起来**：

```txt
Runnable.run()          ← 函数式接口的抽象方法
        ↓ 对接
lambda$test$0()         ← Lambda body 提取出的方法
```

`metafactory` 拿到三个关键参数：

- `samMethodType`：函数式接口抽象方法的签名（这里是 `Runnable.run` 的 `()void`）
- `implMethod`：Lambda body 提取出的那个方法句柄（这里是 `lambda$test$0`）
- `instantiatedMethodType`：实例化后的签名

在常见的 OpenJDK 实现中，运行时会生成一个 `Runnable` 的实现类，这个类的 `run()` 内部就是调用 `lambda$test$0()`。这是具体实现策略，不是语言规范对所有 JVM 实现的强制要求。

### 3.4 CallSite：缓存调用关系

`invokedynamic` 的解析结果不是一次性丢弃的。第一次解析后，JVM 得到一个 `CallSite`（调用点），它持有指向调用目标的句柄，JVM 保存解析结果供后续复用。

后续再执行到同一条 `invokedynamic` 指令，直接复用已解析的 `CallSite`，不再走 bootstrap method。这不意味着每次执行 Lambda 都会重新调用 LambdaMetafactory，也不意味着每次都会创建新的实现类；调用点解析、Lambda 实例创建和方法体执行是三个不同的过程。

### 3.5 最终：`r.run()` 调用 Lambda body

把整条链路串起来：

```txt
Runnable r = () -> System.out.println("hello");   编译期：提取出 lambda$test$0，留下 invokedynamic
r.run();                                          运行期：首次执行时 LambdaMetafactory 生成 Runnable 实现类
                                                        CallSite 缓存这个实现
                                                        r.run() 内部调用 lambda$test$0()
                                                        → 打印 hello
```

调用 `r.run()` 时，执行的是运行时生成的 `Runnable` 实现类的 `run()` 方法，它内部转调 `lambda$test$0()`——也就是你写的 Lambda body。

`invokedynamic` 是 JVM 层面的特性，[字节码与类加载](../02-jvm-runtime/chapter-01-bytecode-classloading.md)会进一步解释它。

## 4. 方法引用

写 Lambda 写多了会发现一个规律：很多 Lambda 的身体只有一行，而且是在调用一个已有的方法。这时可以用方法引用，用 `::` 代替箭头：

```java
// Lambda 形式
names.forEach(name -> System.out.println(name));

// 方法引用（等价写法）
names.forEach(System.out::println);
```

方法引用是 Lambda 表达式的一种简洁写法，适用于已有方法的调用能直接匹配目标函数式接口的情况。它有四种形式：

### 4.1 四种方法引用

**1. 静态方法引用：`ClassName::staticMethod`**

```java
Function<String, Integer> f = Integer::parseInt;  // 等价于 s -> Integer.parseInt(s)
```

**2. 实例方法引用（任意对象）：`ClassName::instanceMethod`**

当 Lambda 的第一个参数是方法的调用者时：

```java
Function<String, String> f = String::toUpperCase;  // 等价于 s -> s.toUpperCase()
```

`String::toUpperCase` 等价于 `s -> s.toUpperCase()`，不是 `String.toUpperCase()`。Lambda 的第一个参数成为方法的接收者。

**3. 特定对象的实例方法引用：`instance::method`**

```java
User user = new User("Tom");
Supplier<String> s = user::getName;  // 等价于 () -> user.getName()
```

**4. 构造方法引用：`ClassName::new`**

```java
Function<String, User> f = User::new;             // 等价于 name -> new User(name)
Function<Integer, String[]> f2 = String[]::new;   // 数组构造
```

### 4.2 何时用方法引用 vs Lambda

没有硬性规则，只有一个直觉：方法引用读起来像自然语言就用它；读起来要停下来想"这是在调什么"，就用 Lambda。

```java
// ✅ 方法引用更简洁
names.stream().map(String::toUpperCase).collect(Collectors.toList());

// ❌ 这里 Lambda 更清晰，因为有额外逻辑
names.stream().filter(name -> name.length() > 3 && name.startsWith("A")).collect(Collectors.toList());
```

Lambda 体只是调用一个已有方法，用方法引用；有多步逻辑或条件判断，用 Lambda。

## 5. Java 不是纯函数式语言

Java 是以面向对象为核心，同时吸收函数式思想的**多范式语言**。

- Lambda 在数据处理、异步编程场景下非常强大
- 但 Java 仍然有可变状态、有副作用、有面向对象的 class 体系
- 函数式特性是**增强而非替代**

正确的 Java 编程方式：在适合的场景用 Lambda，在适合的场景用传统 OOP 封装。不是所有问题都适合函数式解决——过度使用函数式写法会让代码难以调试和理解。

Lambda 和方法引用简化了行为的表示与传递。理解它们时，需要掌握函数式接口、目标类型、变量捕获和方法引用的匹配规则；如果还需要分析底层行为，再进一步了解 `invokedynamic` 与 `LambdaMetafactory` 的运行机制。

下一章介绍[异常处理](./chapter-08-exceptions.md)，随后继续学习[标准集合](./chapter-09-collections.md)、[Stream 与 Optional](./chapter-10-stream-optional.md)和[现代语言特性](./chapter-11-modern-language-features.md)；要理解这些代码如何被 JVM 接收和执行，可进入[JVM 运行时](../02-jvm-runtime/chapter-01-bytecode-classloading.md)。