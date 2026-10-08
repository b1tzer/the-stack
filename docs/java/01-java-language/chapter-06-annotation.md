# 注解

> `@Override` 报错的那次，你找到了拼写错误的父类方法名——`toString()` 写成了 `toSting()`。编译期发现了一个运行期要排查半天的问题。`@Override` 背后是 APT（Annotation Processing Tool）——`@Transactional` 生成代理类靠的是同一套机制。Java 的注解不是注释——是编译期代码生成器。

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
