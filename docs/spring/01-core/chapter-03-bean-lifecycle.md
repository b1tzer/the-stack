# Bean 完整生命周期

> 上一章 [IoC 容器](./chapter-02-ioc-container.md) 把 `refresh()` 十二步里的第 11 步「实例化所有单例 Bean」一句话带过。这一步背后，单个 Bean 从创建到销毁，会经过实例化、依赖注入、初始化等阶段。各阶段的基本顺序相对稳定，但具体执行路径会受到 Bean 类型、后处理器和循环依赖等因素影响。本文继续沿着这个入口展开，重点看 Bean 的创建、依赖注入、初始化和销毁，以及 Spring 在这些阶段提供的扩展点。

## 1. BeanDefinition 的诞生：从注解到元数据

容器在真正 `new` 你的类之前，先把它读成一份 `BeanDefinition`——Bean 的元数据描述。看一个 `@Service` 怎么变成 `BeanDefinition`：

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

```txt
ScannedGenericBeanDefinition（示意）{
    beanClassName = "com.example.ReportGenerator",
    scope         = "prototype",
    lazyInit      = true,
    role          = ROLE_APPLICATION
    // @Value 字段注入不记录在 propertyValues 里，它在实例创建时才解析
}
```

组件扫描注册的是 `BeanDefinition`，记录 Bean 的类型、作用域、是否懒加载等定义信息。字段上的 `@Value("${report.template.dir}")` 是另一回事，它不在 `propertyValues` 里，`@Value` 由依赖注入阶段处理，`${...}` 占位符通过容器的嵌入式值解析机制换成真实值，`PropertySourcesPlaceholderConfigurer` 只是参与这套解析的一个组件。上面那段是示意结构，实际注册的 `BeanDefinition` 实现类随注册方式和 Spring 版本而不同，不一定是 `GenericBeanDefinition`。

「定义」与「实例」分离的价值在于，容器在真正 `new` 对象之前有机会反复修改这份元数据。`BeanFactoryPostProcessor` 如何在 Bean 实例化之前批量改写 `BeanDefinition`，属于容器启动阶段的动作，详见 [IoC 容器](./chapter-02-ioc-container.md) §5。

## 2. 三个阶段：实例化 → 属性填充 → 初始化

Bean 的创建过程可以分成三个主要阶段，中间夹着可插拔的回调。先看全景：

![Bean 生命周期全流程](/spring/spring-bean-lifecycle.svg)

以下按常规 Bean 创建流程概括：

| 阶段 | 主要工作 | 源码入口或代表性方法 |
| :-- | :-- | :-- |
| 实例化 | 通过构造器、工厂方法等创建对象 | `createBeanInstance` |
| 属性填充 | 应用属性值、处理依赖注入 | `populateBean` |
| 初始化 | 执行 Aware 回调、初始化前后处理器和初始化方法 | `initializeBean` |

销毁在容器关闭时进行，属于后续的生命周期管理。本文重点解释初始化回调的执行顺序，以及它与 AOP 代理创建时机的关系。

## 3. 一个 Bean 走完全程

先给可运行示例，再看它为什么按这个顺序走。定义一个 Bean，把能实现的回调全实现一遍：

```java
@Component
public class LifecycleBean implements BeanNameAware, BeanFactoryAware,
        InitializingBean, DisposableBean {

    // ① 实例化：构造器
    public LifecycleBean() {
        System.out.println("1. 构造器");
    }

    // ② 属性填充：@Autowired 注入
    @Autowired
    public void setDataSource(DataSource ds) {
        System.out.println("2. 属性填充");
    }

    // ③ Aware 回调
    @Override
    public void setBeanName(String name) {
        System.out.println("3. BeanNameAware: " + name);
    }

    @Override
    public void setBeanFactory(BeanFactory factory) {
        System.out.println("4. BeanFactoryAware");
    }

    // ④ 初始化回调（顺序见 §5）
    @PostConstruct
    public void postConstruct() {
        System.out.println("5. @PostConstruct");
    }

    @Override
    public void afterPropertiesSet() {
        System.out.println("6. InitializingBean#afterPropertiesSet");
    }

    // ⑤ 销毁回调（顺序见 §6）
    @PreDestroy
    public void preDestroy() {
        System.out.println("7. @PreDestroy");
    }

    @Override
    public void destroy() {
        System.out.println("8. DisposableBean#destroy");
    }
}
```

正常创建 Bean 时，控制台先打印 `1` 到 `6`。容器关闭、执行销毁回调时，再打印 `7` 和 `8`。这里假设 `LifecycleBean` 是容器管理的默认单例 Bean 且容器正常关闭。示例没配置自定义初始化方法，自定义初始化方法通常通过 `@Bean(initMethod = "...")` 或 XML 声明；销毁方法除显式配置外，Spring 对 `@Bean` 还支持推断适用的 `close()` 或 `shutdown()` 方法，它们的位置在 §5、§6 讲。先关注各回调发生在哪个阶段，初始化和销毁的具体先后关系在后文展开。

## 4. BeanPostProcessor：初始化阶段的拦截点

`BeanFactoryPostProcessor` 在容器启动阶段改写 `BeanDefinition`（[IoC 容器](./chapter-02-ioc-container.md) §5），本章不再展开。`BeanPostProcessor` 为 Spring 在 Bean 初始化前后执行自定义逻辑提供了扩展点。它的基础接口提供初始化前、初始化后两个回调，Spring 还定义了更细化的后处理器接口，参与实例化、依赖注入和销毁等环节。

不同功能用的扩展点并不相同。`@Autowired` 的依赖注入由专门的后处理器负责，`@Transactional`、`@Cacheable` 通常通过 AOP 代理实现增强，不能说它们都在 `postProcessAfterInitialization` 里把原对象换成代理。

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
            return createMonitorProxy(bean);  // 自动代理创建器通常在此阶段返回代理
        }
        return bean;
    }
}
```

手动 `new` 出来的对象不会自动经过 Spring 容器的 Bean 创建和后处理流程，因此仅添加 `@Transactional` 或 `@Cacheable` 并不会让对象自动获得相应增强。这里的 `createMonitorProxy(bean)` 只是演示用的自定义方法，并非 Spring 提供的 API。

## 5. 初始化回调：@PostConstruct → InitializingBean → init-method

在常规 Spring Bean 生命周期中，三类初始化回调的相对顺序如下：

```txt
@PostConstruct  →  InitializingBean.afterPropertiesSet  →  init-method
```

顺序的依据在 `AbstractAutowireCapableBeanFactory#initializeBean`：

```java
protected Object initializeBean(String beanName, Object bean, @Nullable RootBeanDefinition mbd) {
    invokeAwareMethods(beanName, bean);            // Aware 回调
    Object wrappedBean = bean;
    // ① before：执行初始化前的 BeanPostProcessor 回调，@PostConstruct 由 CommonAnnotationBeanPostProcessor 在此阶段处理
    wrappedBean = applyBeanPostProcessorsBeforeInitialization(wrappedBean, beanName);
    // ② 初始化回调：InitializingBean + init-method
    invokeInitMethods(beanName, wrappedBean, mbd);
    // ③ after：执行初始化后的 BeanPostProcessor 回调，自动代理创建器通常在此阶段返回代理
    wrappedBean = applyBeanPostProcessorsAfterInitialization(wrappedBean, beanName);
    return wrappedBean;
}
```

`@PostConstruct` 通常由 `CommonAnnotationBeanPostProcessor` 处理，它在初始化前的后处理阶段执行对应方法，因此先于 `invokeInitMethods`。这里说的是常规配置下的执行顺序，具体处理器的注册与排序仍取决于容器配置。`invokeInitMethods` 内部再把剩下两个排好：

```java
protected void invokeInitMethods(String beanName, Object bean, @Nullable RootBeanDefinition mbd) {
    if (bean instanceof InitializingBean) {
        ((InitializingBean) bean).afterPropertiesSet();   // 先接口
    }
    if (mbd != null) {
        String initMethodName = mbd.getInitMethodName();
        if (StringUtils.hasLength(initMethodName)) {
            invokeCustomInitMethod(beanName, bean, mbd);  // 后自定义方法
        }
    }
}
```

所以最终是「注解 → 接口 → 自定义方法」。常规自动代理流程里，`afterPropertiesSet` 执行时 Bean 通常还没有经过初始化后的代理包装，此时通过 `this.xxx()` 发起的调用不会触发随后创建的代理增强。自调用问题的根本原因是内部调用没有经过代理入口，即使 Bean 已经被代理，目标对象内部的 `this` 调用通常也不会被外部代理拦截。

## 6. 销毁回调：@PreDestroy → DisposableBean → destroy-method

销毁阶段也有三类常见回调，但执行机制与初始化阶段不同，不是严格的镜像：

```txt
@PreDestroy  →  DisposableBean.destroy  →  destroy-method
```

顺序写在 `DisposableBeanAdapter#destroy`：

```java
public void destroy() {
    // ① @PreDestroy 在这里执行（DestructionAwareBeanPostProcessor）
    for (DestructionAwareBeanPostProcessor processor : this.beanPostProcessors) {
        processor.postProcessBeforeDestruction(this.bean, this.beanName);
    }
    // ② 接口
    if (this.invokeDisposableBean) {
        ((DisposableBean) this.bean).destroy();
    }
    // ③ 自定义方法
    if (this.destroyMethod != null) {
        invokeCustomDestroyMethod(this.destroyMethod);
    }
}
```

`@PreDestroy` 同样靠 `CommonAnnotationBeanPostProcessor`（它实现了 `DestructionAwareBeanPostProcessor`）在 `postProcessBeforeDestruction` 里反射执行，排在最前。

## 7. 业务代码如何选择生命周期回调

业务代码通常优先选择一种生命周期回调方式，避免同一份初始化或清理逻辑分散在多个位置。不同回调承担不同职责时，可以组合使用：

| 场景 | 推荐 | 理由 |
| :-- | :-- | :-- |
| 初始化 | `@PostConstruct` | 注解直观，不依赖框架接口，不写 XML |
| 销毁 | `@PreDestroy` | 同上 |

`InitializingBean` / `DisposableBean` 是 Spring 接口，实现它们会让业务 Bean 和框架耦合；`init-method` / `destroy-method` 需要额外声明。`@PostConstruct` / `@PreDestroy` 属于通用注解规范提供的生命周期注解，默认优先使用，但这不是绝对规则。如果项目统一用 `@Bean(initMethod = "...")` 配置，自定义方法也可能更贴合现有风格。

::: warning 版本锚点
`@PostConstruct` / `@PreDestroy` 来自 `javax.annotation`。JDK 11 起 JDK 不再内置该包，Spring 6.0 转向 `jakarta.annotation`，需引入 `jakarta.annotation-api` 依赖。
:::

## 8. 属性填充与循环依赖的关系

实例化与属性填充分开，为部分循环依赖场景提供了提前暴露引用的机会。以两个单例 Bean 通过字段注入相互依赖为例，其中一个 Bean 实例化后、依赖尚未注入完时，Spring 可以通过单例缓存机制提前暴露它的引用，让另一个 Bean 完成注入，之后再继续初始化。

这种提前暴露机制只适用于部分单例循环依赖场景，不能解决构造器循环依赖，也不适用于 prototype Bean。三级缓存的具体作用及其与 AOP 代理的关系，详见 [循环依赖与三级缓存](./chapter-06-circular-dependency.md)。
