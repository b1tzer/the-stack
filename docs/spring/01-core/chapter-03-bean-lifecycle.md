# Bean 完整生命周期

> 上一章 [IoC 容器](./chapter-02-ioc-container.md) 把 `refresh()` 十二步里的第 11 步「实例化所有单例 Bean」一句话带过。这一步背后，单个 Bean 从创建到销毁，会经过实例化、依赖注入、初始化等阶段。各阶段的基本顺序相对稳定，但具体执行路径会受到 Bean 类型、后处理器和循环依赖等因素影响。本文继续沿着这个入口展开，重点看 Bean 的创建、依赖注入、初始化和销毁，以及 Spring 在这些阶段提供的扩展点。

## 1. BeanDefinition 的诞生：从注解到元数据

容器在真正实例化 Bean 之前，先把它读成一份 `BeanDefinition`——Bean 的元数据描述。看一个 `@Service` 怎么变成 `BeanDefinition`：

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

组件扫描注册的是 `BeanDefinition`，记录 Bean 的类型、作用域、是否懒加载等定义信息。字段上的 `@Value("${report.template.dir}")` 是另一回事，它不会在组件扫描时就变成 `propertyValues` 里的普通属性值。实际注入由相应的注解处理器在依赖注入阶段完成；表达式里的 `${...}` 占位符通过容器的嵌入式值解析机制换成真实值，`PropertySourcesPlaceholderConfigurer` 是参与这套解析的常见组件。上面那段是示意结构，实际注册的 `BeanDefinition` 实现类随注册方式和 Spring 版本而不同，不一定是 `GenericBeanDefinition`。

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

销毁在容器关闭时进行，属于后续的生命周期管理。本文以常规单例 Bean 的创建流程为主线，重点说明依赖注入、初始化与销毁回调的执行顺序，以及后处理器、AOP 代理与循环依赖对这一流程的影响。

## 3. 一个 Bean 走完全程

下面用一个单例 Bean 展示常见的生命周期回调。示例省略了导入语句和容器启动、关闭代码，假设 `DataSource` 已在容器中注册，日志只用于说明回调的相对顺序：

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

正常创建 Bean 时，控制台先打印 `1` 到 `6`；容器关闭、执行销毁回调时，再打印 `7` 和 `8`。上面的顺序以 `LifecycleBean` 是容器管理的默认单例 Bean 且容器正常关闭为前提。prototype 作用域的 Bean 不会被容器像单例那样自动跟踪并调用销毁回调，需要释放的资源应由应用自行清理。示例没配置自定义初始化方法，它通常通过 `@Bean(initMethod = "...")` 或 XML 声明，与销毁方法的推断一起放在 §5、§6 讲。

## 4. BeanPostProcessor：初始化阶段的拦截点

`BeanFactoryPostProcessor` 在容器启动阶段改写 `BeanDefinition`（[IoC 容器](./chapter-02-ioc-container.md) §5），本章不再展开。`BeanPostProcessor` 为 Spring 在 Bean 初始化前后执行自定义逻辑提供了扩展点，基础接口只有初始化前、初始化后两个回调。实例化、属性填充、销毁等阶段的扩展由别的后处理器接口承担，例如 `InstantiationAwareBeanPostProcessor` 介入实例化前后的处理与属性填充流程，`DestructionAwareBeanPostProcessor` 参与销毁前处理，`@Autowired` 的依赖注入则由 `AutowiredAnnotationBeanPostProcessor` 负责，它们不属于 `BeanPostProcessor` 基础接口的两个回调。

依赖注入与 AOP 增强走的不是同一套机制。`@Transactional`、`@Cacheable` 通常通过 AOP 代理实现增强，不能说它们都在 `postProcessAfterInitialization` 里把原对象换成代理。

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

手动 `new` 出来的对象不会自动经过 Spring 容器的 Bean 创建和后处理流程，因此仅添加 `@Transactional` 或 `@Cacheable` 并不会让对象自动获得相应增强。上面这段是示意伪代码，`Monitorable`、`createMonitorProxy` 均未给出实现；代理对象被其他后处理器包装后，`bean.getClass()` 也未必是原始业务类，不能直接当作可复用的代理实现。

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

`@PostConstruct` 在常规配置下由 `CommonAnnotationBeanPostProcessor` 处理，它继承自 `InitDestroyAnnotationBeanPostProcessor`，通过初始化前的后处理回调执行注解标注的方法，因此先于 `invokeInitMethods`。这里说的是常规配置下的执行顺序，具体处理器的注册与排序仍取决于容器配置。`invokeInitMethods` 内部再把剩下两个排好：

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

所以最终是「注解 → 接口 → 自定义方法」，前提是它们配置的是不同的方法；如果 init-method 与 `afterPropertiesSet` 指向同一个方法，Spring 会避免重复调用。常规自动代理流程里，Bean 要到初始化后的后处理阶段才被包装成代理，因此 `afterPropertiesSet` 执行时通过 `this.xxx()` 发起的调用不会触发随后创建的代理增强。更一般地说，Spring AOP 的自调用问题源于内部调用没有经过代理入口，即使对象已经被代理，目标对象内部的 `this` 调用通常也不会被外部代理拦截。循环依赖等特殊场景下代理可能提前创建，见 §8。

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

除显式配置外，通过 `@Bean` 声明的 Bean 还能按规则推断销毁方法，例如适用的 `close()` 或 `shutdown()` 方法。`@Bean` 的 `destroyMethod` 默认处于推断模式；把 `destroyMethod` 显式设为空字符串可以关闭推断，避免同名方法被误判为销毁方法。

## 7. 业务代码如何选择生命周期回调

业务代码通常优先选择一种生命周期回调方式，避免同一份初始化或清理逻辑分散在多个位置。不同回调承担不同职责时，可以组合使用：

| 场景 | 推荐 | 注意事项 |
| :-- | :-- | :-- |
| 普通业务 Bean 的初始化与清理 | `@PostConstruct` / `@PreDestroy` | 需要相应的注解处理器与注解 API |
| 希望显式采用 Spring 生命周期契约 | `InitializingBean` / `DisposableBean` | 业务类与 Spring 接口耦合 |
| 通过 `@Bean` 管理第三方类 | `initMethod` / `destroyMethod` | 不必修改第三方类源码 |

如果项目没有统一的生命周期回调约定，普通业务 Bean 优先使用 `@PostConstruct` / `@PreDestroy` 更直观，它们不依赖框架接口、不写 XML。`InitializingBean` / `DisposableBean` 是 Spring 接口，实现它们会让业务 Bean 和框架耦合；`initMethod` / `destroyMethod` 需要额外声明，适合管理第三方类。如果项目统一用 `@Bean(initMethod = "...")` 配置，自定义方法也可能更贴合现有风格。

::: warning 版本锚点
`@PostConstruct` / `@PreDestroy` 来自 JSR-250 的 `javax.annotation` 包，Java SE 9 起该包不再由 JDK 内置。Spring Framework 5.x 项目通常使用 `javax.annotation.PostConstruct` / `PreDestroy`；Spring Framework 6.x 转向 `jakarta.annotation` 命名空间，通常需引入 `jakarta.annotation-api` 依赖。具体导入路径取决于 Spring 版本与依赖配置。
:::

## 8. 属性填充与循环依赖的关系

实例化与属性填充分开，为部分循环依赖场景提供了提前暴露引用的机会。以两个单例 Bean 通过字段注入相互依赖为例，其中一个 Bean 实例化后、依赖尚未注入完时，Spring 可以通过单例缓存机制提前暴露它的引用，让另一个 Bean 完成注入，之后再继续初始化。

这种提前暴露机制只适用于部分单例循环依赖场景，不能解决构造器循环依赖，也不适用于 prototype Bean。三级缓存的具体作用及其与 AOP 代理的关系，详见 [循环依赖与三级缓存](./chapter-06-circular-dependency.md)。
