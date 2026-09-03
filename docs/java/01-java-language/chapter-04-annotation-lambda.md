# 注解与 Lambda

> `@Override` 报错的那次，你找到了拼写错误的父类方法名——`toString()` 写成了 `toSting()`。编译期发现了一个运行期要排查半天的问题。`@Override` 背后是 APT（Annotation Processing Tool）——`@Transactional` 生成代理类靠的是同一套机制。Java 的注解不是注释——是编译期代码生成器。而 Lambda 走的是另一条路：`invokedynamic` 指令让 JVM 在运行时自己决定怎么创建那个函数对象——这两套机制，构成了 Java 在"元数据驱动"和"函数式编程"两个方向上的演进。

## 1. 为什么需要注解：从配置驱动到元数据驱动

### 1.1 XML 配置的痛苦

早期 Java 开发大量依赖 XML 配置：

```xml
<bean id="userService" class="com.example.UserService">
    <property name="userDao" ref="userDao"/>
    <property name="emailService" ref="emailService"/>
</bean>
```

代码和配置分离带来的问题：

1. **修改困难**：改一个依赖关系要同时改代码和 XML
2. **信息分散**：一个类的行为分散在 `.java` 和 `.xml` 两个文件中
3. **IDE 无法感知**：XML 中的类名写错了，IDE 不一定能发现
4. **重构不安全**：重命名一个类，XML 中的引用不会自动更新

### 1.2 注解的思想

注解的核心思想：**把描述信息放回代码附近**。

```java
@Service
public class UserService {
    @Autowired
    private UserDao userDao;
}
```

`@Service` 告诉框架"这是一个服务层组件"，`@Autowired` 告诉框架"这个字段需要依赖注入"。信息和代码在一起，IDE 可以检查，重构时自动跟随。

关键理解：**注解本身不执行任何逻辑。** `@Service` 不会让类变成服务，它只是在类上贴了一个标签。真正让标签起作用的是**框架**——Spring 启动时扫描这些标签，根据标签创建和管理对象。

## 2. 注解的生命周期：SOURCE / CLASS / RUNTIME

注解不是在所有阶段都存在的。Java 定义了三个生命周期阶段：

### 2.1 SOURCE：只在源码中

```java
@Override
public String toString() {
    return "User{name=" + name + "}";
}
```

`@Override` 告诉编译器："请检查这个方法是否真的覆盖了父类方法。" 编译完成后，这个注解就消失了——它不会进入 `.class` 文件。

### 2.2 CLASS：进入 class 文件，但 JVM 不加载

这类注解存储在 `.class` 文件中，但 JVM 在运行时不会把它们加载到内存。它们供字节码工具（如 ASM、字节码增强框架）在类加载前使用。

### 2.3 RUNTIME：保留到运行时

```java
@Component
public class UserService { ... }
```

`@Component` 不仅存在于源码中，也存在于 `.class` 文件中，JVM 运行时也能读取到。Spring 通过反射读取这个注解，知道"这个类需要被管理为一个 Bean"。

| 阶段 | 存在于源码 | 存在于 class 文件 | 运行时可读 | 典型用途 |
| :-- | :---: | :---: | :---: | :-- |
| SOURCE | ✅ | ❌ | ❌ | 编译期检查（`@Override`） |
| CLASS | ✅ | ✅ | ❌ | 字节码工具 |
| RUNTIME | ✅ | ✅ | ✅ | 框架反射读取（`@Component`） |

注解在 Class 文件中的存储位置是 `RuntimeVisibleAnnotations`（RUNTIME）和 `RuntimeInvisibleAnnotations`（CLASS）属性。第二卷会详细展开。

## 3. 定义自定义注解

会用注解只是第一步。真正理解注解，得知道它怎么被定义出来的——`@interface` 语法比你想象的简单，但背后的元注解体系值得细看：

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Retryable {
    int maxAttempts() default 3;
    long delayMs() default 1000;
    Class<? extends Throwable>[] retryOn() default {Exception.class};
}
```

### 3.1 元注解

定义注解时，用**元注解**来指定注解的行为：

| 元注解 | 作用 | 取值 |
| :-- | :-- | :-- |
| `@Target` | 注解可以用在哪里 | `TYPE`（类）、`METHOD`、`FIELD`、`PARAMETER` 等 |
| `@Retention` | 注解的生命周期 | `SOURCE`、`CLASS`、`RUNTIME` |
| `@Documented` | 是否出现在 Javadoc 中 | — |
| `@Inherited` | 子类是否继承父类的注解 | — |
| `@Repeatable` | 是否可以重复使用（Java 8+） | 需要定义容器注解 |

### 3.2 注解元素的类型限制

注解的元素只能是以下类型：

- 基本类型（`int`、`boolean` 等）
- `String`
- `Class`
- `Enum`
- 其他注解
- 以上类型的数组

不能是 `Object`、`List` 或自定义类。

### 3.3 使用自定义注解

```java
@Retryable(maxAttempts = 5, delayMs = 2000, retryOn = {IOException.class})
public String callExternalService() {
    // ...
}
```

注解本身不执行任何逻辑。要让注解生效，需要通过反射读取注解并执行相应逻辑：

```java
Method method = MyService.class.getMethod("callExternalService");
if (method.isAnnotationPresent(Retryable.class)) {
    Retryable retry = method.getAnnotation(Retryable.class);
    int maxAttempts = retry.maxAttempts();
    // 根据注解配置实现重试逻辑
}
```

这就是注解驱动框架的基本原理——注解 + 反射（或编译期处理）。Spring 的 `@Transactional`、JUnit 的 `@Test`、MyBatis 的 `@Select` 都是这个模式。

## 4. 编译期注解处理（APT）

RUNTIME 注解（如 Spring 的 `@Component`）在运行时通过反射读取。但还有一类强大的机制——**编译期注解处理（Annotation Processing Tool, APT）**，它在编译阶段就根据注解生成新的源代码。

```txt
Java Source → Annotation Processor → 生成新的 Java Source → 编译
```

### 4.1 典型工具

**Lombok：** 通过注解自动生成 getter/setter/构造方法等样板代码：

```java
@Data  // 编译期自动生成 getter、setter、equals、hashCode、toString
public class User {
    private String name;
    private int age;
}
```

Lombok 的 `@Data` 在编译期被 Annotation Processor 处理，生成对应的 getter/setter 方法。运行时没有任何额外开销。

**MapStruct：** 自动生成对象映射代码：

```java
@Mapper
public interface UserMapper {
    UserDTO toDTO(User user);
}
```

编译期自动生成 `UserMapper` 的实现类，将 `User` 的字段映射到 `UserDTO`。比运行时反射（如 BeanUtils.copyProperties）快得多。

### 4.2 APT 的核心 API

```java
@SupportedAnnotationTypes("com.example.MyAnnotation")
public class MyProcessor extends AbstractProcessor {
    @Override
    public boolean process(Set<? extends TypeElement> annotations,
                           RoundEnvironment roundEnv) {
        // 遍历所有被 @MyAnnotation 标注的元素
        for (Element element : roundEnv.getElementsAnnotatedWith(MyAnnotation.class)) {
            // 生成新的源代码
        }
        return true;
    }
}
```

APT 的价值：**零运行时开销**。代码在编译期就生成了，运行时不需要反射、不需要代理，直接执行生成的代码。

## 5. 注解驱动框架

注解在现代 Java 框架中无处不在。理解注解如何驱动框架运行，是理解 Spring、MyBatis、JUnit 等框架的基础。

### 5.1 Spring 如何利用注解

```java
@Service
public class OrderService {
    @Autowired
    private OrderRepository repository;

    @Transactional
    public void createOrder(Order order) {
        repository.save(order);
    }
}
```

Spring 启动时的处理流程：

```txt
1. 扫描 classpath 下的所有类
2. 检查每个类是否有 @Service / @Component / @Repository 等注解
3. 有？读取注解信息，创建 BeanDefinition
4. 实例化 Bean，检查字段上的 @Autowired，注入依赖
5. 检查方法上的 @Transactional，创建 AOP 代理
```

**关键理解：注解只是入口，真正执行的是框架。** `@Transactional` 不会在方法上自动开启事务，它只是在方法上贴了一个标签。Spring 的 `BeanPostProcessor` 在创建 Bean 时检查到这个标签，然后为这个 Bean 创建一个 AOP 代理，代理在方法调用前后管理事务。

### 5.2 注解的隐式复杂性

注解让代码更简洁，但也带来了隐式行为：

```java
@Transactional
public void transfer(Long from, Long to, BigDecimal amount) {
    accountService.debit(from, amount);
    accountService.credit(to, amount);
}
```

代码里没有一行关于事务的代码，但运行时确实有事务。这导致：

1. **调试困难**：行为不明显，新人可能不知道这里有事务
2. **自调用失效**：类内部方法调用 `this.transfer()` 不走代理，事务不生效（第六卷详细展开）
3. **注解冲突**：多个注解叠加时，优先级和覆盖规则需要理解

经验法则：**与代码强绑定的元数据用注解（如 `@Service`），频繁变化的运维参数用外部配置（如超时时间、地址）。**

## 6. 为什么需要函数式编程

### 6.1 行为传递的需求

传统面向对象中，行为属于对象——调用 `order.pay()` 就是执行 `Order` 对象的 `pay` 方法。但很多场景下，我们真正想传递的是一段**逻辑**，而不是一个对象。

排序是最典型的例子。排序算法不需要知道"怎么比较"，它只需要一个"比较两个元素"的能力：

```java
// Java 5 之前：用匿名内部类包装行为
Collections.sort(list, new Comparator<User>() {
    @Override
    public int compare(User a, User b) {
        return a.getAge() - b.getAge();
    }
});
```

10 行代码，核心逻辑只有 1 行，其余都是模板代码。意图被淹没在语法噪音中。

```java
// Java 8+：Lambda 表达式
Collections.sort(list, (a, b) -> a.getAge() - b.getAge());
```

一行代码，意图清晰：按年龄排序。

### 6.2 函数式编程的核心思想

**1. 函数是一等公民。** 函数可以像变量一样被保存、传递、返回。

**2. 不可变数据。** 减少共享状态带来的并发问题（连接第三卷）。

**3. 声明式编程。** 关注"做什么"而非"怎么做"：

```java
// ❌ 命令式——告诉机器怎么做
List<User> result = new ArrayList<>();
for (User user : users) {
    if (user.getAge() > 18) {
        result.add(user);
    }
}

// ✅ 声明式——告诉机器做什么
List<User> result = users.stream()
    .filter(user -> user.getAge() > 18)
    .collect(Collectors.toList());
```

## 7. 函数式接口与 Lambda 的类型基础

### 7.1 Lambda 的类型

Lambda 表达式本身没有类型。它需要一个**目标类型**——必须是函数式接口：

```java
Runnable r = () -> System.out.println("hello");
// Lambda 的类型是 Runnable（函数式接口）
```

函数式接口：**只有一个抽象方法的接口**。

```java
@FunctionalInterface  // 可选，但推荐——编译器会检查
public interface Comparator<T> {
    int compare(T o1, T o2);  // 唯一的抽象方法

    // 可以有 default 方法和 static 方法，不影响函数式接口的定义
    default Comparator<T> reversed() { ... }
}
```

### 7.2 标准函数式接口

Java 8 在 `java.util.function` 包中提供了一套标准函数式接口：

| 接口 | 签名 | 用途 | 示例 |
| :-- | :-- | :-- | :-- |
| `Function<T,R>` | `R apply(T t)` | 类型转换 | `User → UserDTO` |
| `Consumer<T>` | `void accept(T t)` | 消费数据 | `打印一个对象` |
| `Supplier<T>` | `T get()` | 提供数据 | `创建新对象` |
| `Predicate<T>` | `boolean test(T t)` | 条件判断 | `user.age > 18` |
| `UnaryOperator<T>` | `T apply(T t)` | 一元运算 | `字符串转大写` |
| `BinaryOperator<T>` | `T apply(T a, T b)` | 二元运算 | `两数相加` |

这些接口覆盖了绝大多数场景，不需要自己定义函数式接口。

## 8. 方法引用

写 Lambda 写多了你会发现一个规律：很多 Lambda 的身体只有一行，而且是在调用一个已有的方法。这种情况下，Java 提供了一种更简洁的写法——**方法引用**，用 `::` 代替箭头：

```java
// Lambda 形式
names.forEach(name -> System.out.println(name));

// 方法引用（等价写法）
names.forEach(System.out::println);
```

方法引用不是新语法，是 Lambda 的语法糖。它有四种形式：

### 8.1 四种方法引用

**1. 静态方法引用：`ClassName::staticMethod`**

```java
// Lambda
Function<String, Integer> f1 = s -> Integer.parseInt(s);

// 方法引用
Function<String, Integer> f2 = Integer::parseInt;
```

**2. 实例方法引用（任意对象）：`ClassName::instanceMethod`**

当 Lambda 的第一个参数是方法的调用者时：

```java
// Lambda：s 调用了 toUpperCase()
Function<String, String> f1 = s -> s.toUpperCase();

// 方法引用
Function<String, String> f2 = String::toUpperCase;
```

这是最让人困惑的形式。`String::toUpperCase` 等价于 `s -> s.toUpperCase()`，不是 `String.toUpperCase()`。Lambda 的第一个参数成为方法的接收者。

**3. 特定对象的实例方法引用：`instance::method`**

```java
User user = new User("Tom");
// Lambda
Supplier<String> s1 = () -> user.getName();

// 方法引用
Supplier<String> s2 = user::getName;
```

**4. 构造方法引用：`ClassName::new`**

```java
// Lambda
Function<String, User> f1 = name -> new User(name);

// 方法引用
Function<String, User> f2 = User::new;

// 数组构造方法引用
Function<Integer, String[]> f3 = String[]::new;
```

### 8.2 何时用方法引用 vs Lambda

没有硬性规则，但有一个直觉：如果方法引用读起来像自然语言，就用它；如果读起来要停下来想“这是在调什么”，就用 Lambda。

```java
// ✅ 方法引用更简洁
names.stream().map(String::toUpperCase).collect(Collectors.toList());

// ❌ 这里 Lambda 更清晰（因为有额外逻辑）
names.stream().filter(name -> name.length() > 3 && name.startsWith("A")).collect(Collectors.toList());
```

如果 Lambda 体只是调用一个已有方法，用方法引用；如果有多步逻辑或条件判断，用 Lambda。

## 9. Lambda vs 匿名内部类

Lambda 表达式和匿名内部类看似等价，实际上底层完全不同：

| 维度 | 匿名内部类 | Lambda |
| :-- | :-- | :-- |
| `this` 绑定 | 指向匿名类自身 | 指向外部类 |
| class 文件 | 生成独立 `.class` 文件 | 不生成独立文件 |
| 调用机制 | `invokevirtual` | `invokedynamic` |
| 变量捕获 | 隐式持有外部引用 | 更轻量的捕获 |

```java
public class Demo {
    public void test() {
        // 匿名内部类的 this 指向匿名类自身
        Runnable r1 = new Runnable() {
            public void run() {
                System.out.println(this);  // 打印匿名类实例
            }
        };

        // Lambda 的 this 指向外部类
        Runnable r2 = () -> {
            System.out.println(this);  // 打印 Demo 实例
        };
    }
}
```

## 10. Lambda 背后的编译机制：invokedynamic

### 10.1 不是语法糖

Lambda 不是匿名内部类的语法糖——它们的编译产物完全不同。

匿名内部类会生成一个独立的 `.class` 文件（如 `Demo$1.class`），每个匿名类都是一个独立的类。

Lambda 表达式编译后，生成的是一条 `invokedynamic` 指令：

```txt
源码：x -> x + 1
        ↓
  invokedynamic #0, LambdaMetafactory
```

### 10.2 invokedynamic 的工作流程

```txt
1. 第一次执行时，JVM 调用 Bootstrap Method（LambdaMetafactory）
2. LambdaMetafactory 在运行时生成一个实现类
3. 后续执行直接调用这个实现类
```

### 10.3 为什么选择 invokedynamic

三个原因：

1. **延迟绑定**：实现策略在运行时才决定，而非编译时。未来 JDK 可以改变 Lambda 的实现方式而不影响字节码兼容性。

2. **JVM 可优化**：JVM 可以对 Lambda 做内联、逃逸分析等优化，而匿名内部类是独立的类，优化空间有限。

3. **不生成额外类文件**：避免了匿名内部类产生大量 `.class` 文件的问题。

`invokedynamic` 是 JVM 层面的特性，第二卷字节码章节会详细展开。

## 11. Stream API：声明式数据处理

### 11.1 集合 vs Stream

集合**存储数据**，Stream**描述计算**：

```java
List<String> names = Arrays.asList("Alice", "Bob", "Charlie", "David");

// Stream 描述了一个计算管道
List<String> result = names.stream()
    .filter(name -> name.length() > 3)    // 中间操作：过滤
    .map(String::toUpperCase)              // 中间操作：转换
    .sorted()                              // 中间操作：排序
    .collect(Collectors.toList());         // 终止操作：收集结果
```

### 11.2 惰性计算

中间操作（`filter`、`map`、`sorted`）是**惰性的**——调用它们不会立即执行，只是在管道上记录了一个操作。直到遇到终止操作（`collect`、`forEach`、`count`），整个管道才真正执行。

```java
// 这行代码不会打印任何东西——没有终止操作
names.stream()
    .filter(name -> {
        System.out.println("filter: " + name);
        return name.length() > 3;
    });
```

惰性计算的价值：**短路优化**。`findFirst()` 只需要找到第一个匹配元素就停止，不需要处理整个流。

### 11.3 内部迭代 vs 外部迭代

```java
// 外部迭代：开发者控制循环
for (String name : names) {
    if (name.length() > 3) {
        System.out.println(name);
    }
}

// 内部迭代：框架控制执行
names.stream()
    .filter(name -> name.length() > 3)
    .forEach(System.out::println);
```

内部迭代的优势：框架可以自由决定执行策略——单线程、多线程、并行、甚至分布式。这就是 `parallelStream()` 存在的基础。

### 11.4 并行 Stream

```java
// 并行处理——自动利用多核 CPU
List<User> result = users.parallelStream()
    .filter(user -> user.getAge() > 18)
    .collect(Collectors.toList());
```

但并行 Stream 不是万能的：

- 共享 `ForkJoinPool`，可能影响其他并行任务
- 不适合 IO 密集型任务（线程会阻塞在 IO 上）
- 数据量小时，线程调度的开销可能超过并行的收益

经验法则：**CPU 密集 + 数据量大 + 无共享状态 = 可以考虑并行 Stream。**

## 12. Optional：用类型表达空值语义

### 12.1 null 的问题

`null` 是 Java 类型系统中最大的漏洞。任何引用类型都可以是 `null`，但 `null` 不属于任何类型：

```java
String s = null;
s.length();  // NPE——运行时才知道 s 是 null
```

`null` 的语义模糊：它可能表示"没有值"、"未初始化"、"错误状态"，调用方无法从类型中得知。

### 12.2 Optional 的解决方案

`Optional<T>` 用类型系统明确表达"值可能不存在"：

```java
public Optional<User> findById(Long id) {
    // 查到了返回 Optional.of(user)
    // 没查到返回 Optional.empty()
}
```

调用方看到返回类型是 `Optional<User>`，就知道"结果可能为空"——编译器强制你处理这种情况：

```java
Optional<User> user = findById(1L);

// 方式 1：判断后使用
if (user.isPresent()) {
    System.out.println(user.get().getName());
}

// 方式 2：声明式（推荐）
user.map(User::getName)
    .ifPresent(name -> System.out.println(name));

// 方式 3：提供默认值
String name = user.map(User::getName)
    .orElse("Unknown");

// 方式 4：为空时抛异常
User u = user.orElseThrow(() -> new NotFoundException("User not found"));
```

### 12.3 Optional 的正确使用

**✅ 适合的场景：**

- 方法返回值可能为空
- Stream 中的 `flatMap` 操作

**❌ 不适合的场景：**

- 不要做字段类型（`private Optional<User> user` ❌）
- 不要做方法参数（`void process(Optional<User> user)` ❌）
- 不要对 Optional 做 null 检查（`if (opt != null)` ❌，这说明你根本没理解 Optional）

## 13. Java 不是纯函数式语言

Java 是以面向对象为核心，同时吸收函数式思想的**多范式语言**。

- Lambda 和 Stream 在数据处理、异步编程场景下非常强大
- 但 Java 仍然有可变状态、有副作用、有面向对象的 class 体系
- 函数式特性是**增强而非替代**

正确的 Java 编程方式：在适合的场景用 Stream 链式处理，在适合的场景用传统 OOP 封装。不是所有问题都适合函数式解决——过度使用 Stream 链会让代码难以调试和理解。

> 本章完成了 Java 语言层的最后两块拼图。注解让 Java 从"静态代码"走向"元数据驱动"，Lambda 让 Java 从"纯面向对象"走向"多范式"。
>
> 至此，第一卷《Java 语言》完整闭环。六次抽象升级：
>
> - 类型系统（如何描述数据）
> - 面向对象（如何组织复杂世界）
> - 泛型（如何让类型参与抽象）
> - 注解（如何给代码附加语义）
> - Lambda（如何让行为成为一等公民）
>
> 读者已经不仅"会写 Java"，而是理解了 Java 语言本身提供的全部表达能力。第二卷《JVM Runtime》将回答：这些 Java 代码到底是如何被 JVM 接收、加载、执行和管理的。
