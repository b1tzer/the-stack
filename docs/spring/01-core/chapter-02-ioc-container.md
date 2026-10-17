# IoC 容器

> 你的 `OrderService` 依赖 `OrderRepository`。传统写法是在构造器里 `new JdbcOrderRepository(...)`，IoC 写法是把它声明成构造器参数。两段代码的差别在「谁决定用哪个实现」：前者写死了具体实现，后者把决定权交了出去。这一章讲清楚这个「交出去」的过程，以及接管这件事的容器长什么样。

## 1. 为什么需要 IoC

对象自己创建依赖，代码长这样：

```java
public class OrderService {
    private final OrderRepository orderRepository;
    private final PaymentService paymentService;

    public OrderService() {
        // 直接在构造器里 new 出具体实现
        DataSource ds = new HikariDataSource(config);
        this.orderRepository = new JdbcOrderRepository(ds);
        this.paymentService = new AlipayService(alipayConfig);
    }
}
```

这段代码能跑，但埋了三个问题：

| 问题 | 后果 |
| :-- | :-- |
| 无法替换实现 | 想把 `AlipayService` 换成 `WechatPayService`，得改 `OrderService` 源码 |
| 无法独立测试 | 依赖写死在构造器里，测试时不容易替换成 Mock，难以隔离业务逻辑 |
| 生命周期不可控 | 对象何时创建、复用、销毁散落在调用方，无法集中管理 |

三个问题的根源是同一个：`OrderService` 把「创建并管理依赖」这件本不属于它的职责揽在了自己身上。

IoC 的解法是让类只声明需求，不再自己动手：

```java
public class OrderService {
    private final OrderRepository orderRepository;
    private final PaymentService paymentService;

    // 依赖通过构造器传入，具体是谁由调用方决定
    public OrderService(OrderRepository orderRepository,
                        PaymentService paymentService) {
        this.orderRepository = orderRepository;
        this.paymentService = paymentService;
    }
}
```

`OrderService` 不再 `new` 任何东西，只声明「我需要这两个依赖」。创建和组装的工作交给了容器。

## 2. IoC 的本质

控制反转（Inversion of Control）这个名字容易想复杂，其实只描述了一件事：**「谁来创建依赖」这个决定权，从业务代码手里，反转到容器手里。**

| 维度 | 传统方式 | IoC 方式 |
| :-- | :-- | :-- |
| 对象创建 | 使用者主动 `new` | 容器负责创建 |
| 依赖关系 | 硬编码在代码里 | 声明式配置（注解 / XML） |
| 可替换性 | 改源码 | 改配置或注解 |
| 可测试性 | 需要真实环境 | 注入 Mock 对象 |

一个常见误解是「IoC 和 DI 是两回事」。准确说，**IoC 是思想，DI（依赖注入）是它最常见的实现手段**。依赖注入由容器把依赖传给对象；依赖查找（Dependency Lookup）则由对象主动向容器要，比如调用 `getBean()`。Spring 至今仍支持依赖查找，只是业务代码里通常优先用依赖注入，因为它能声明在构造器或字段上，更容易测试。

## 3. 容器：BeanFactory 与 ApplicationContext

承接 IoC 的组件叫容器。Spring 提供两个接口：`BeanFactory` 是最基础的，`ApplicationContext` 通过继承 `BeanFactory` 相关接口获得 Bean 管理能力，再叠加上下文功能。

```java
// 最基础的容器：手动加载定义，getBean 时才创建
BeanFactory factory = new DefaultListableBeanFactory();

// 功能完整的容器：刷新时预实例化非懒加载单例
ApplicationContext ctx = new AnnotationConfigApplicationContext(AppConfig.class);
```

两者的差别不在「能不能创建 Bean」，而在 `ApplicationContext` 多出的应用级能力：

| 能力 | BeanFactory | ApplicationContext |
| :-- | :-- | :-- |
| Bean 创建时机 | 单纯注册定义不会自动预实例化全部单例 | 刷新阶段预实例化非懒加载单例 |
| 国际化 | 基础接口不提供 | 内置 `MessageSource` |
| 事件发布 | 基础接口不提供 | 内置 `ApplicationEventPublisher` |
| 资源访问 | 基础接口不提供 | 统一 `Resource` 接口 |
| 后处理器自动注册 | 需手动注册 | 刷新流程自动发现并注册 |

实际项目用 `ApplicationContext`，它整合了事件、国际化、资源访问，并协调刷新流程；`BeanFactory` 则用于框架集成或需要自行控制初始化顺序的底层场景。Spring Boot 会根据应用类型选择 `ApplicationContext` 实现，Servlet Web 应用用的是 `AnnotationConfigServletWebServerApplicationContext`，它继承自 `ApplicationContext`。

## 4. BeanDefinition：Bean 的元数据

容器不直接读你的类，而是先读成 `BeanDefinition`——它是 Bean 的元数据描述，类比 Java 类的 `Class` 对象：类描述了一个对象的模板，`BeanDefinition` 描述了一个 Bean 该怎么造。

```java
public interface BeanDefinition extends AttributeAccessor, BeanMetadataElement {
    void setBeanClassName(String beanClassName);   // 类名
    void setScope(String scope);                   // singleton / prototype
    void setLazyInit(boolean lazyInit);            // 是否延迟初始化
    void setDependsOn(String... dependsOn);        // 强制依赖顺序
    void setAutowireCandidate(boolean c);          // 是否参与自动装配
    ConstructorArgumentValues getConstructorArgumentValues();  // 构造器参数
    MutablePropertyValues getPropertyValues();     // 属性值
    void setInitMethodName(String name);           // 初始化方法
    void setDestroyMethodName(String name);        // 销毁方法
}
```

`BeanDefinition` 不只来自注解扫描。同一份配置可以来自不同入口，容器统一归一化：

| 来源 | 示例 |
| :-- | :-- |
| 组件扫描 | `@Service` `@Repository` `@Controller` |
| 配置类 | `@Configuration` + `@Bean` |
| 导入 | `@Import({DataSourceConfig.class})` |
| XML | `<bean id="userService" class="..."/>` |
| 编程注册 | `registry.registerBeanDefinition(...)` |
| 条件注册 | `@Conditional` `@ConditionalOnClass` |

`BeanDefinition` 是「图纸」，图纸不是死的——容器在 `new` 出 Bean 之前和之后，各预留了一个扩展窗口，详见本章 §6。

## 5. Bean 作用域

`BeanDefinition` 上还有一个字段决定 Bean 的复用策略：`scope`。默认所有 Bean 都是单例（singleton），同一个容器内同一个 Bean 定义只存一份共享实例，它不是 JVM 全局唯一的单例。Spring 支持六种作用域：

| 作用域 | 生命周期 | 使用场景 |
| :-- | :-- | :-- |
| `singleton` | 容器启动到关闭，同一容器内同一 Bean 定义共享一个实例 | 默认，绝大多数业务 Bean |
| `prototype` | 每次向容器请求时创建新实例 | 需要独立实例的对象，如每次任务独立维护状态的组件 |
| `request` | 一次 HTTP 请求内有效 | Web，请求级缓存 |
| `session` | 一个 HTTP Session 内有效 | Web，用户级会话数据 |
| `application` | 一个 `ServletContext` 内有效 | Web，应用级共享 |
| `websocket` | 一个 WebSocket 会话内有效 | Web，实时通信场景 |

### 5.1 singleton vs prototype 的关键区别 {#singleton-vs-prototype}

```java
@Component
@Scope("prototype")
public class ReportGenerator {
    private int progress;  // 有状态，每次需要独立实例
}
```

两个作用域在生命周期上有本质差异：

| 维度 | singleton | prototype |
| :-- | :-- | :-- |
| 实例化时机 | 非懒加载单例在刷新阶段预创建，懒加载单例延后 | 每次向容器请求时通常创建新实例 |
| 容器管理完整生命周期 | ✅ 是 | ❌ 只负责创建，不负责销毁 |
| `@PreDestroy` 生效 | ✅ | ❌ 容器不管销毁 |
| 循环依赖 | 特定条件下可借三级缓存处理部分单例循环依赖 | 不参与单例三级缓存机制 |

prototype 的 `@PreDestroy` 不生效是常见坑。容器负责创建 prototype Bean 并完成注入和初始化，但不会像管单例那样持续跟踪它的销毁回调，所以关闭时不会自动调 `@PreDestroy`。如果 prototype Bean 持有要释放的资源（如数据库连接），需要调用方自己约定由谁关闭，不能指望实现 `DisposableBean` 或加 `@PreDestroy` 就让容器自动销毁。

另一个相关边界：把 prototype Bean 注入单例 Bean 时，只会在注入那一刻拿到一个实例，之后反复调用单例的业务方法不会自动重新获取新的 prototype 实例。需要每次使用都拿新实例时，要用 `ObjectProvider` 或作用域代理等机制。

### 5.2 Web 作用域的前置条件

`request`、`session`、`application`、`websocket` 四种作用域只在 Web 环境有效，需要 Web 相关基础设施暴露请求与会话上下文。在 Servlet 应用里，Spring 会通过相应机制管理这些上下文，具体方式取决于应用的配置和运行方式。在没有对应 Web 上下文的场景（如纯后端服务）获取这些作用域的 Bean，通常会因拿不到请求或会话上下文而抛 `IllegalStateException`，具体异常取决于作用域实现与调用方式。

## 6. 两个 PostProcessor：改定义与改实例

`BeanDefinition` 是「图纸」，但图纸不是死的。容器在真正 `new` 出 Bean 之前和之后，各预留了一个扩展窗口：一批钩子在图纸上做手脚（改定义），另一批在成品上做拦截（改实例）。两个窗口对应两个名字只差一个词的接口：

| 扩展点 | 时机 | 操作对象 | 典型实现 |
| :-- | :-- | :-- | :-- |
| `BeanFactoryPostProcessor` | `new` 之前 | `BeanDefinition`（图纸） | `ConfigurationClassPostProcessor`（解析 `@Configuration` / `@Bean` / `@ComponentScan`）、`PropertySourcesPlaceholderConfigurer`（把 `${...}` 占位符替换成配置值） |
| `BeanPostProcessor` | `new` 之后 | Bean 实例（成品） | AOP 代理生成（`@Transactional`、`@Async` 靠它织入）、`@Autowired` 注入（`AutowiredAnnotationBeanPostProcessor`） |

两个接口的区别在处理对象不同。`BeanFactoryPostProcessor` 处理的是 Bean 工厂及其定义元数据，`BeanPostProcessor` 参与的是单个 Bean 的初始化流程。这里说的「时机」是扩展点的主要职责，不是说注入和代理都在 `new` 之后的同一个阶段发生，Bean 的实例化、属性填充、初始化回调有各自的先后顺序，详见 [Bean 完整生命周期](./chapter-03-bean-lifecycle.md)。

### 6.1 ConfigurationClassPostProcessor：@Configuration 如何保证跨 @Bean 调用遵循容器语义 {#config-class-processor}

写一个最常见的配置类：

```java
@Configuration
public class AppConfig {
    @Bean
    public DataSource dataSource() {
        return new HikariDataSource();   // 这个方法真的只执行一次吗？
    }

    @Bean
    public OrderRepository orderRepository() {
        return new JdbcOrderRepository(dataSource());  // 直接调用 dataSource()
    }
}
```

按 Java 直觉，`orderRepository()` 里每次调用 `dataSource()`，都会 `new` 一个新的 `HikariDataSource`，那「单例」不就失效了吗？但在默认 singleton 作用域下，Spring 里 `dataSource()` 的工厂方法只被真正执行一次。

答案是 `ConfigurationClassPostProcessor` 做的。在默认启用 `proxyBeanMethods` 的 `@Configuration` 模式下，Spring 会在配置类处理阶段增强符合条件的配置类，用 **CGLIB 动态生成它的一个子类**，并对可拦截的 `@Bean` 方法进行拦截。重写后的逻辑是：

```java
// CGLIB 生成的子类（简化示意）
public class AppConfig$$EnhancerByCGLIB extends AppConfig {
    @Override
    public DataSource dataSource() {
        if (容器里已经有 dataSource) {
            return 容器里的那个;      // 有就直接返回，不再 new
        }
        return super.dataSource();      // 没有才走父类方法真正创建
    }
}
```

所以第二次调用 `dataSource()` 命中的是容器里已存在的单例，而不是再 `new` 一个。**单例语义不是靠「方法只执行一次」实现的，而是靠「代理拦截 + 容器缓存」实现的**——这个代理正是在 `BeanFactoryPostProcessor` 阶段生成的。

去掉 `@Configuration`、只留 `@Component` 会怎样？`@Component` 不触发 CGLIB 增强，`orderRepository()` 里对 `dataSource()` 的调用就是普通的 Java 方法调用，每调一次就 `new` 一次，多出一个 `HikariDataSource`。但要说清两点：容器里注册的 `dataSource` Bean 本身仍是单例，没有失效；多出来的是这次直接方法调用新建的对象，它没被容器管理。所以问题不是「单例失效」，而是直接调用绕过了容器，凭空多出对象、还可能造成配置不一致。`@Configuration(proxyBeanMethods = false)` 也采用这种不拦截的调用语义，类内直接调用另一个 `@Bean` 方法同样不会自动复用容器实例。所以当配置类内部需要跨 `@Bean` 方法调用并复用容器实例时，要用默认的完整 `@Configuration` 模式；`@Component` 加 `@Bean` 的 lite 模式则适合不需要这种跨方法引用的场景。

### 6.2 PropertySourcesPlaceholderConfigurer：属性占位符的解析

`PropertySourcesPlaceholderConfigurer` 是一个 `BeanFactoryPostProcessor`，负责把 `BeanDefinition` 里出现的 `${...}` 占位符，替换成 `Environment` 里的真实值（来自 `application.properties`、环境变量、命令行参数等）。这类定义层的占位符替换发生在普通 Bean 实例化之前。

要注意区分两种占位符。定义层的 `${...}` 在 `new` 之前被替换；而 `@Value("${report.template.dir}")` 这种字段注入，是在 Bean 实例化之后的属性填充阶段才解析赋值，不是 `new` 之前就替换好的。两者处理时机不同，但都依托 `Environment` 的属性源做嵌入式值解析，不是两套完全独立的机制，具体解析基础设施取决于容器配置。

### 6.3 BeanPostProcessor 的职责范围

`BeanPostProcessor` 贯穿单个 Bean 的初始化前后，`@Autowired` 注入、`@PostConstruct` 回调、AOP 代理都依托它，但各自发生在不同阶段：`@Autowired` 的字段和方法注入在属性填充阶段，构造器注入在实例化阶段，`@PostConstruct` 在初始化回调里，常见的自动代理创建器则在初始化后的后处理阶段判断是否生成代理。这套先后顺序属于「单个 Bean 生命周期」的一部分，详见 [Bean 完整生命周期](./chapter-03-bean-lifecycle.md) §4、§5。

## 7. 容器启动做了什么

`ApplicationContext` 启动的核心逻辑集中在 `AbstractApplicationContext#refresh()`，它把启动拆成 12 步：

```java
public void refresh() {
    // 1. 准备刷新：设置启动时间、active 标志
    prepareRefresh();
    // 2. 创建 BeanFactory，加载 BeanDefinition
    ConfigurableListableBeanFactory beanFactory = obtainFreshBeanFactory();
    // 3. 设置类加载器、SpEL 解析器、属性编辑器
    prepareBeanFactory(beanFactory);
    // 4. 子类扩展点：留给子类覆盖
    postProcessBeanFactory(beanFactory);
    // 5. 执行 BeanFactoryPostProcessor，修改 BeanDefinition
    invokeBeanFactoryPostProcessors(beanFactory);
    // 6. 注册 BeanPostProcessor，拦截 Bean 创建
    registerBeanPostProcessors(beanFactory);
    // 7. 初始化 MessageSource（国际化）
    initMessageSource();
    // 8. 初始化事件广播器
    initApplicationEventMulticaster();
    // 9. 子类扩展点：留给子类初始化特殊 Bean
    onRefresh();
    // 10. 注册事件监听器
    registerListeners();
    // 11. 实例化所有非懒加载的单例 Bean
    finishBeanFactoryInitialization(beanFactory);
    // 12. 完成刷新，发布 ContextRefreshedEvent
    finishRefresh();
}
```

这 12 步不用背，分两类看：

| 类别 | 步骤 | 职责 |
| :-- | :-- | :-- |
| 与 Bean 直接相关 | 第 2、5、6、11 步 | 配置 → 改定义 → 拦创建 → 实例化 |
| 环境与扩展 | 第 1、3、4、7、8、9、10、12 步 | 环境、类加载器、国际化、事件广播与监听 |

与 Bean 直接相关的 4 步里，第 2 步读 `BeanDefinition`（本章 §4）、第 5 步的 `BeanFactoryPostProcessor` 和第 6 步的 `BeanPostProcessor`（本章 §6）、第 11 步实例化单例（[Bean 完整生命周期](./chapter-03-bean-lifecycle.md)）都有下文展开。

## 8. 小结

Spring IoC 容器的工作可以沿着 `refresh()` 这条主线理解：准备 `BeanFactory`，加载和处理 `BeanDefinition`，注册后处理器，再创建和初始化非懒加载的单例 Bean。`BeanDefinition` 描述 Bean 的创建和管理配置，两个 PostProcessor 分别参与定义处理和 Bean 初始化，作用域决定实例如何复用。理解这些关系后，可以继续读 [Bean 完整生命周期](./chapter-03-bean-lifecycle.md)，再深入循环依赖与 AOP 代理的创建过程。
