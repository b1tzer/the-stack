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
|------|------|
| 组件扫描 | `@Service` `@Repository` `@Controller` |
| 配置类 | `@Configuration` + `@Bean` |
| 导入 | `@Import({DataSourceConfig.class})` |
| XML | `<bean id="userService" class="..."/>` |
| 编程注册 | `registry.registerBeanDefinition(...)` |
| 条件注册 | `@Conditional` `@ConditionalOnClass` |

`BeanDefinition` 是「图纸」，图纸不是死的——容器在 `new` 出 Bean 之前和之后，各预留了一个扩展窗口，详见 [Bean 完整生命周期](./chapter-03-bean-lifecycle.md) §4。

## 5. 两个 PostProcessor：改定义与改实例

`BeanDefinition` 是「图纸」，但图纸不是死的。容器在真正 `new` 出 Bean 之前和之后，各预留了一个扩展窗口：一批钩子在图纸上做手脚（改定义），另一批在成品上做拦截（改实例）。两个窗口对应两个名字只差一个词的接口：

| 扩展点 | 时机 | 操作对象 | 典型实现 |
| :-- | :-- | :-- | :-- |
| `BeanFactoryPostProcessor` | `new` 之前 | `BeanDefinition`（图纸） | `ConfigurationClassPostProcessor`、`PropertySourcesPlaceholderConfigurer` |
| `BeanPostProcessor` | `new` 之后 | Bean 实例（成品） | AOP 代理生成、`@Autowired` 注入 |

记住这个区别的锚点是「Factory」一词：`BeanFactoryPostProcessor` 操作的是 `BeanFactory`（即容器、即 `BeanDefinition` 的集合），而 `BeanPostProcessor` 操作的是单个 Bean。

两个 `PostProcessor` 的典型实现和源码级分析，详见 [Bean 完整生命周期](./chapter-03-bean-lifecycle.md) §4、§5。

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

主线 4 步里，第 2 步读 `BeanDefinition`（本章 §4）、第 5 步的 `BeanFactoryPostProcessor` 和第 6 步的 `BeanPostProcessor`（本章 §5）、第 11 步实例化单例（[Bean 完整生命周期](./chapter-03-bean-lifecycle.md)）都有下文展开。

## 7. 小结

IoC 要解决的只有一件事：把「创建依赖」从业务代码里拿出来，交给容器。容器做两件事——启动时读配置、按需创建并注入 Bean。记住 `BeanFactory` 是底座、`ApplicationContext` 是加满企业级能力的完整版，再看 `refresh()` 十二步，就能看懂一个 Bean 从定义到就绪的完整路径。
