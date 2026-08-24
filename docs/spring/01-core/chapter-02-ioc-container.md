# IoC 容器

> 你的 `OrderService` 依赖 `OrderRepository`。传统写法是在构造器里 `new OrderRepository()`，IoC 写法是把它声明成构造器参数。两段代码只差一行 `new`，差别却根本性：前者写死了「用这个具体实现」，后者把决定权交了出去。这一章讲清楚这个「交出去」的过程，以及接管这件事的容器长什么样。

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
| 无法独立测试 | 测 `OrderService` 必须连真实数据库和支付网关 |
| 生命周期不可控 | 每次 `new` 都是新实例，做不到单例复用 |

三个问题的根源是同一个：`OrderService` 承担了本不属于它的职责——决定依赖是谁。

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

一个常见误解是「IoC 和 DI 是两回事」。准确说，**IoC 是思想，DI（依赖注入）是它最常见的实现手段**。Spring 早期还支持依赖查找（Dependency Lookup），后来因为用得少被移除，所以现在提到 IoC，基本就是在说 DI。

## 3. 容器：BeanFactory 与 ApplicationContext

承接 IoC 的组件叫容器。Spring 提供两个接口：`BeanFactory` 是最基础的，`ApplicationContext` 是它的子接口。

```java
// 最基础的容器：手动加载定义，getBean 时才创建
BeanFactory factory = new DefaultListableBeanFactory();

// 功能完整的容器：启动时预加载所有单例
ApplicationContext ctx = new AnnotationConfigApplicationContext(AppConfig.class);
```

两者的差别不在「能不能创建 Bean」，而在「企业级能力」：

| 能力 | BeanFactory | ApplicationContext |
| :-- | :-- | :-- |
| Bean 实例化时机 | 懒加载，`getBean` 时才创建 | 启动时预加载所有单例 |
| 国际化 | 不支持 | 内置 `MessageSource` |
| 事件发布 | 不支持 | 内置 `ApplicationEventPublisher` |
| 资源访问 | 不支持 | 统一 `Resource` 接口 |
| AOP 集成 | 手动配置 | 自动检测并集成 |

结论直接：**实际项目用 `ApplicationContext`，`BeanFactory` 只在内存受限或需要完全控制加载顺序的底层框架里出现。** Spring Boot 启动时创建的容器是 `AnnotationConfigServletWebServerApplicationContext`，它继承自 `ApplicationContext`。

## 4. BeanDefinition：Bean 的元数据

容器在第 2 步「读配置」时，不会直接读你的类，而是先读成一堆 `BeanDefinition`——它是 Bean 的元数据描述，类比 Java 类的 `Class` 对象：类描述了一个对象的模板，`BeanDefinition` 描述了一个 Bean 该怎么造。

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

`BeanDefinition` 不只来自注解扫描。同一份配置可以来自不同入口，容器统一归一化成 `BeanDefinition`：

| 来源 | 示例 |
|------|------|
| 组件扫描 | `@Service` `@Repository` `@Controller` |
| 配置类 | `@Configuration` + `@Bean` |
| 导入 | `@Import({DataSourceConfig.class})` |
| XML | `<bean id="userService" class="..."/>` |
| 编程注册 | `registry.registerBeanDefinition(...)` |
| 条件注册 | `@Conditional` `@ConditionalOnClass` |

看一个 `@Service` 怎么变成 `BeanDefinition`：

```java
@Service
@Scope("prototype")
@Lazy
public class ReportGenerator {
    @Value("${report.template.dir}")
    private String templateDir;
}
```

容器扫描后得到的 `BeanDefinition` 大致是：

```text
GenericBeanDefinition {
    beanClassName = "com.example.ReportGenerator",
    scope        = "prototype",
    lazyInit     = true,
    role         = ROLE_APPLICATION,
    propertyValues = [ "templateDir" → "${report.template.dir}" ]  // 占位符，后续解析
}
```

注意 `propertyValues` 里的 `${report.template.dir}` 还是占位符——它由 `PropertySourcesPlaceholderConfigurer`（一个 `BeanFactoryPostProcessor`）在第 5 步解析成真实值。这就是「定义」与「实例」分离的好处：在真正 `new` 之前，容器有机会反复修改这份元数据。改元数据的这批钩子，就是下一节要讲的两个 `PostProcessor` 之一。

## 5. 两个 PostProcessor：改定义与改实例

`BeanDefinition` 是「图纸」，但图纸不是死的。容器在真正 `new` 出 Bean 之前和之后，各预留了一个扩展窗口：一批钩子在图纸上做手脚（改定义），另一批在成品上做拦截（改实例）。两个窗口对应两个名字只差一个词的接口：

| 扩展点 | 时机 | 操作对象 | 典型实现 |
| :-- | :-- | :-- | :-- |
| `BeanFactoryPostProcessor` | `new` 之前 | `BeanDefinition`（图纸） | `ConfigurationClassPostProcessor`、`PropertySourcesPlaceholderConfigurer` |
| `BeanPostProcessor` | `new` 之后 | Bean 实例（成品） | AOP 代理生成、`@Autowired` 注入 |

### 5.1 BeanFactoryPostProcessor：在创建前修改定义

```java
@FunctionalInterface
public interface BeanFactoryPostProcessor {

    void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) throws BeansException;
}
```

它执行的时机是 `refresh()` 第 5 步 `invokeBeanFactoryPostProcessors`：此刻所有 `BeanDefinition` 已经加载完毕（第 2 步），但单例还没实例化（第 11 步）。所以它能拿到完整的 `beanFactory`，随意增删改任何一份 `BeanDefinition`，改完的才是容器最终要用来创建 Bean 的版本。

Spring 内置了多个 `BeanFactoryPostProcessor`，其中两个最值得理解，因为它们解释了两个日常注解的「反直觉」现象。

#### 5.1.1 ConfigurationClassPostProcessor：@Bean 方法为什么只执行一次

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

按 Java 直觉，`orderRepository()` 里每次调用 `dataSource()`，都会 `new` 一个新的 `HikariDataSource`，那「单例」不就失效了吗？但实际 Spring 里 `dataSource()` 只执行一次。

答案是 `ConfigurationClassPostProcessor` 干的。它在 `BeanFactoryPostProcessor` 阶段扫描所有 `@Configuration` 类，发现某个类标了 `@Configuration`，就用 **CGLIB 动态生成它的一个子类**，并重写每个 `@Bean` 方法。重写后的逻辑是：

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

去掉 `@Configuration`、只留 `@Component` 会怎样？`@Component` 不触发 CGLIB 增强，`orderRepository()` 里对 `dataSource()` 的调用就是普通的 Java 方法调用，每调一次 `new` 一次，单例失效。这正是规范里「配置类用 `@Configuration`，别用 `@Component` 代替」的底层原因。

#### 5.1.2 PropertySourcesPlaceholderConfigurer：@Value 占位符的解析

§4 里 `ReportGenerator` 的 `${report.template.dir}` 还是占位符，谁来换成真实值？`PropertySourcesPlaceholderConfigurer`。

它同样是 `BeanFactoryPostProcessor`：遍历所有 `BeanDefinition`，把 `propertyValues` 里的 `${...}` 占位符，替换成 `Environment` 里的真实值（来自 `application.properties`、环境变量、命令行参数等）。替换发生在 `new` 之前，所以 Bean 拿到的字段值已经是解析好的字符串，而不是占位符本身。

### 5.2 BeanPostProcessor：在创建后拦截实例

`BeanPostProcessor` 是 Spring 最实用的扩展点之一：它能在每个 Bean 创建前后插入逻辑。AOP、`@Autowired`、`@Transactional` 都靠它实现——本质是在 `postProcessAfterInitialization` 里把原始对象换成了代理对象。

```java
@Component
public class MonitorBeanPostProcessor implements BeanPostProcessor {

    @Override
    public Object postProcessBeforeInitialization(Object bean, String beanName) {
        return bean;  // 初始化前通常不动
    }

    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        // 命中标记的类，返回代理替代原对象
        if (bean.getClass().isAnnotationPresent(Monitorable.class)) {
            return createMonitorProxy(bean);  // AOP 代理就在此处生成
        }
        return bean;
    }
}
```

理解这一点很关键：你在业务方法上加的 `@Transactional`、`@Cacheable`，都不是「方法自带」的能力，而是容器在创建 Bean 时包了一层代理。这也是为什么「手动 new 出来的对象注解不生效」——它绕过了容器，自然没有代理。

### 5.3 两者的分工

两个名字只差一个词，作用的阶段完全不同：

| 对比项 | BeanFactoryPostProcessor | BeanPostProcessor |
| :-- | :-- | :-- |
| 操作对象 | `BeanDefinition`（图纸） | Bean 实例（成品） |
| 时机 | `refresh()` 第 5 步 | 第 6 步注册，第 11 步实例化时逐个拦截 |
| 典型实现 | `ConfigurationClassPostProcessor`、`PropertySourcesPlaceholderConfigurer` | AOP 的代理生成、`@Autowired` 注入 |
| 一句话 | 在 `new` 之前改「怎么造」 | 在 `new` 之后拦「造出来的东西」 |

记住这个区别的锚点是「Factory」一词：`BeanFactoryPostProcessor` 操作的是 `BeanFactory`（即容器、即 `BeanDefinition` 的集合），而 `BeanPostProcessor` 操作的是单个 Bean。

## 6. 容器启动做了什么

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
| 主线 | 第 2、5、6、11 步 | 配置 → 改定义 → 拦创建 → 实例化 |
| 脚手架 | 第 1、3、4、7、8、9、10、12 步 | 环境、类加载器、国际化、事件广播与监听 |

主线 4 步里，第 2 步读 `BeanDefinition`（本章 §4）、第 5 步的 `BeanFactoryPostProcessor`（本章 §5.1）、第 6 步注册 `BeanPostProcessor`（本章 §5.2、[AOP](./chapter-06-aop.md)）、第 11 步实例化单例（[Bean 完整生命周期](./chapter-03-bean-lifecycle.md)）都有下文展开。

脚手架 8 步保证容器「能跑起来」，但和业务 Bean 的创建没有直接关系，了解顺序即可。第 5、6 步这两个扩展点的区别见本章 §5.3。

## 7. 小结

IoC 要解决的只有一件事：把「创建依赖」从业务代码里拿出来，交给容器。容器做两件事——启动时读配置、按需创建并注入 Bean。记住 `BeanFactory` 是底座、`ApplicationContext` 是加满企业级能力的完整版，再看 `refresh()` 十二步，就能看懂一个 Bean 从定义到就绪的完整路径。
