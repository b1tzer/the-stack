# 注解

> 注解本身只提供结构化的元数据。`@Override` 让编译器检查方法是否正确覆写，`@Transactional` 让 Spring 在方法调用边界管理事务，它们都使用注解，但背后的处理机制不同。编译器可以检查注解，注解处理器可以在编译期使用它，运行时框架也可以读取它并执行相应逻辑，三者共享的是元数据形式，不是同一套执行机制。

## 1. 为什么需要注解：从配置驱动到元数据驱动

### 1.1 XML 配置与注解的取舍

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

XML 也并非一无是处，它可以把配置与业务代码分离，适合集中管理外部化配置。上面的问题主要发生在「配置描述的是类自身角色或行为」时，信息分散在 Java 源码和 XML 两处。注解不是对 XML 的全面替代，选择哪种方式要看配置是否与代码结构紧密绑定。

### 1.2 注解的思想

注解的直接好处是把描述信息放到代码附近：

```java
@Service
public class UserService {
    @Autowired
    private UserDao userDao;
}
```

`@Service` 告诉框架"这是一个服务层组件"，`@Autowired` 告诉框架"这个字段需要依赖注入"。信息和代码在一起，IDE 可以检查，重构时自动跟随。

**注解主要负责声明元数据，本身不会自动完成依赖注入、事务管理或重试等业务行为。** `@Service` 不会让类变成服务，它只是声明了元数据。真正让标签起作用的是框架，Spring 启动时扫描这些标签，根据标签创建和管理对象。

## 2. 注解的保留策略：SOURCE / CLASS / RUNTIME

Java 通过 `@Retention` 指定注解的保留策略，决定注解在编译后是否保留、能否被运行时反射读取。这三种策略描述的是注解的保留方式，不是同一个注解依次经过的三个阶段：

### 2.1 SOURCE：只在源码中

```java
@Override
public String toString() {
    return "User{name=" + name + "}";
}
```

`@Override` 告诉编译器："请检查这个方法是否真的覆盖了父类方法。" 编译完成后，这个注解就消失了——它不会进入 `.class` 文件。

### 2.2 CLASS：进入 class 文件，但运行时反射读不到

这类注解存储在 `.class` 文件中，但不会通过常规反射 API 暴露出来。它们可供读取 Class 文件的字节码工具（如 ASM、字节码增强框架）使用，具体读取时机取决于工具的工作方式。

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

注解在 Class 文件中的存储位置是 `RuntimeVisibleAnnotations`（RUNTIME）和 `RuntimeInvisibleAnnotations`（CLASS）属性；[字节码与类加载](../02-jvm-runtime/chapter-01-bytecode-classloading.md)会进一步解释 Class 文件结构。

## 3. 定义自定义注解

自定义注解用 `@interface` 声明，语法本身简单，重点是背后的元注解体系：

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
| `@Retention` | 注解的保留策略 | `SOURCE`、`CLASS`、`RUNTIME` |
| `@Documented` | 是否出现在 Javadoc 中 | — |
| `@Inherited` | 查询类注解时，允许子类从父类继承 | 只作用于类级别，不适用于方法、字段 |
| `@Repeatable` | 是否可以重复使用（Java 8+） | 需要定义容器注解 |

`@Target` 还包含 `TYPE_USE` 和 `TYPE_PARAMETER`，分别表示注解可以用在类型使用位置和类型参数声明位置。注解不只能标在类、方法、字段等声明上，也能标注泛型等更细的位置。

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

要让注解生效，需要通过反射读取注解并执行相应逻辑。下面只演示读取注解及元素，不是完整的重试实现，实际还需要定义重试条件、异常处理和执行边界：

```java
Method method = MyService.class.getMethod("callExternalService");
if (method.isAnnotationPresent(Retryable.class)) {
    Retryable retry = method.getAnnotation(Retryable.class);
    int maxAttempts = retry.maxAttempts();
    // 根据注解配置实现重试逻辑
}
```

自定义注解只定义元数据，不会自动产生业务行为，必须有相应的处理逻辑读取并解释它。处理逻辑可以运行在编译期，也可以运行在程序启动或执行期间。Spring 解析 `@Transactional` 的事务属性并通过事务拦截实施事务管理，MyBatis 根据 `@Select` 配置 Mapper 映射，测试框架依据方法上的注解发现并执行测试，它们共享「通过注解表达元数据」的思路，但具体处理机制不同。

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

`@Data` 让 Lombok 在编译过程中把这些方法加入编译器处理的语法树，最终生成包含相应方法的字节码。Lombok 依赖编译器集成来修改语法树，和标准 JSR 269 注解处理器生成新源码的方式并不相同，因此它对 JDK 版本和构建工具更敏感。生成的方法运行时按普通 Java 方法执行，不需要反射来生成。

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

注解处理器的价值是**把部分工作提前到编译期**。例如 MapStruct 根据映射声明生成具体的字段赋值代码，避免每次映射都走通用反射查找属性。这能减少特定场景的运行时处理成本，但不能笼统地说生成的代码都没有运行时开销，生成代码是否使用反射或代理，取决于具体实现。

## 5. 注解驱动框架

注解本身不产生行为，是框架在读取并解释它。以 Spring 为例看注解如何驱动框架运行。

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
1. 发现组件。组件扫描根据扫描范围和过滤规则识别候选组件，注册为 Bean 定义
2. 创建与装配 Bean。容器创建对象，通过依赖注入提供依赖
3. 解析事务元数据。事务基础设施读取 @Transactional 等声明，确定事务属性
4. 决定是否创建代理。自动代理基础设施根据可用的通知和代理条件决定
5. 执行事务拦截。调用经过代理的方法时，拦截器管理事务的开启、提交或回滚
```

`@Transactional` 不会在方法上自动开启事务，它只是声明了事务属性。事务基础设施解析这些属性，再由代理在方法调用边界管理事务；是否创建代理、采用 JDK 动态代理还是子类代理，取决于通知和代理条件。上面是概念流程，具体调用路径随 Spring 版本和配置变化。

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
2. **自调用失效**：在默认代理模式下，类内部通过 `this.transfer()` 调用同一个对象的另一个 `@Transactional` 方法，这次内部调用不经过代理，不会单独触发该方法对应的事务配置（[Spring 声明式事务的自调用修复](../../spring/04-data-access/chapter-04-transaction.md#self-invocation-fix)详细展开）。若外层方法已通过代理进入事务，内部方法仍在外层事务中执行
3. **注解冲突**：多个注解叠加时，优先级和覆盖规则需要理解

经验法则：**与代码强绑定的元数据用注解（如 `@Service`），频繁变化的运维参数用外部配置（如超时时间、地址）。**

## 6. 下一步

注解解决的是“如何给代码附加语义”，下一页进入[Lambda 与函数式编程](./chapter-07-lambda.md)，讨论“如何把行为作为值传递”。需要继续追踪注解在 Class 文件中的存储时，可回到[字节码与类加载](../02-jvm-runtime/chapter-01-bytecode-classloading.md)；需要理解代理注解为何可能失效，则进入[Spring AOP](../../spring/01-core/chapter-05-aop.md)。
