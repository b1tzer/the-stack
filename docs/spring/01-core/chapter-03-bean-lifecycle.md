# Bean 完整生命周期

> 上一章 [IoC 容器](./chapter-02-ioc-container.md) 把 `refresh()` 十二步里的第 11 步「实例化所有单例 Bean」一句话带过。这一步背后，单个 Bean 从 `new` 出来到被销毁，要经过一长串顺序固定的阶段。本文把它拆开：先看 BeanDefinition 怎么来的，再看三个阶段骨架，然后聚焦初始化阶段的拦截点 `BeanPostProcessor`，最后讲清楚「三个初始化回调谁先谁后」这个高频考点。

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
GenericBeanDefinition {
    beanClassName = "com.example.ReportGenerator",
    scope        = "prototype",
    lazyInit     = true,
    role         = ROLE_APPLICATION,
    propertyValues = [ "templateDir" → "${report.template.dir}" ]  // 占位符，后续解析
}
```

注意 `propertyValues` 里的 `${report.template.dir}` 还是占位符——它由 `PropertySourcesPlaceholderConfigurer`（一个 `BeanFactoryPostProcessor`）在后续步骤解析成真实值。这就是「定义」与「实例」分离的好处：在真正 `new` 之前，容器有机会反复修改这份元数据。`BeanFactoryPostProcessor` 如何在 Bean 实例化之前批量改写 `BeanDefinition`，属于容器启动阶段的动作，详见 [IoC 容器](./chapter-02-ioc-container.md) §5。

## 2. 三个阶段：实例化 → 属性填充 → 初始化

Bean 的一生可以粗分成三段，中间夹着一堆可插拔的回调。先看全景：

![Bean 生命周期全流程](/spring/spring-bean-lifecycle.svg)

骨架只有三件事：

| 阶段 | 做什么 | 关键方法 |
| :-- | :-- | :-- |
| 实例化 | `new` 出对象，字段全是空 | 构造器 |
| 属性填充 | 把依赖注进去 | `populateBean`、`@Autowired` |
| 初始化 | 回调一串扩展点，生成 AOP 代理 | `initializeBean` |

销毁发生在容器关闭时，独立于这三段。真正值得记住的不是「有哪几个阶段」，而是**初始化阶段里那一串回调的顺序**——它是排查 `@PostConstruct` 不生效、理解 AOP 代理时机的入口。

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

    // ④ 初始化回调（顺序固定，见 §5）
    @PostConstruct
    public void postConstruct() {
        System.out.println("5. @PostConstruct");
    }

    @Override
    public void afterPropertiesSet() {
        System.out.println("6. InitializingBean#afterPropertiesSet");
    }

    // ⑤ 销毁回调（顺序固定，见 §6）
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

控制台按 `1 → 8` 的顺序打印。`init-method` / `destroy-method` 需要 XML 或 `@Bean(initMethod=...)` 声明，示例里没写，它们的位置在 §5、§6 讲。第 5、6 两个初始化回调谁先谁后，第 7、8 两个销毁回调谁先谁后，这两个顺序被源码写死，后面拆开看。

## 4. BeanPostProcessor：初始化阶段的拦截点

`BeanFactoryPostProcessor` 在容器启动阶段改写 `BeanDefinition`（[IoC 容器](./chapter-02-ioc-container.md) §5），本章不再展开。真正贯穿单个 Bean 生命周期的是 `BeanPostProcessor`——它在每个 Bean 完成属性填充之后、销毁之前的多个节点插入回调。AOP、`@Autowired`、`@Transactional` 都靠它实现，本质是在 `postProcessAfterInitialization` 里把原始对象换成了代理对象。

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

## 5. 初始化回调：@PostConstruct → InitializingBean → init-method

三个初始化回调的执行顺序固定：

```txt
@PostConstruct  →  InitializingBean.afterPropertiesSet  →  init-method
```

顺序的依据在 `AbstractAutowireCapableBeanFactory#initializeBean`：

```java
protected Object initializeBean(String beanName, Object bean, @Nullable RootBeanDefinition mbd) {
    invokeAwareMethods(beanName, bean);            // Aware 回调
    Object wrappedBean = bean;
    // ① before：@PostConstruct 在这里执行
    wrappedBean = applyBeanPostProcessorsBeforeInitialization(wrappedBean, beanName);
    // ② 初始化回调：InitializingBean + init-method
    invokeInitMethods(beanName, wrappedBean, mbd);
    // ③ after：AOP 代理在这里生成
    wrappedBean = applyBeanPostProcessorsAfterInitialization(wrappedBean, beanName);
    return wrappedBean;
}
```

`@PostConstruct` 排在最前，是因为它不写在 `initializeBean` 的硬编码路径里，而是由 `CommonAnnotationBeanPostProcessor` 在 `postProcessBeforeInitialization` 里反射调用。这个处理器是 Spring 在 `spring-context` 模块里提供的注解驱动层，通过 `AnnotationConfigUtils.registerAnnotationConfigPostProcessors()` 挂载到容器，属于 `BeanPostProcessor` 扩展点，而非 `spring-beans` 内核写死的主流程，因此它的 before 回调天然排在 `invokeInitMethods` 之前。`invokeInitMethods` 内部再把剩下两个排好：

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

所以最终是「注解 → 接口 → 自定义方法」。一个常被忽略的推论：**AOP 代理是在 `afterPropertiesSet` 之后才生成的**。你在 `afterPropertiesSet` 里调 `this.xxx()` 拿到的还是原始对象，注解增强不会生效。

## 6. 销毁回调：@PreDestroy → DisposableBean → destroy-method

销毁顺序和初始化镜像对称：

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

## 7. 三个回调，实际只用一个

三个初始化回调、三个销毁回调，工程里不需要都写，择一即可：

| 场景 | 推荐 | 理由 |
| :-- | :-- | :-- |
| 初始化 | `@PostConstruct` | 注解直观，不依赖框架接口，不写 XML |
| 销毁 | `@PreDestroy` | 同上 |

`InitializingBean` / `DisposableBean` 是 Spring 接口，实现它们会让业务 Bean 和框架耦合；`init-method` / `destroy-method` 需要额外声明。`@PostConstruct` / `@PreDestroy` 是 JDK 标准注解，耦合最轻。

::: warning 版本锚点
`@PostConstruct` / `@PreDestroy` 来自 `javax.annotation`。JDK 11 起 JDK 不再内置该包，Spring 6.0 转向 `jakarta.annotation`，需引入 `jakarta.annotation-api` 依赖。
:::

## 8. 收束：为什么属性填充与初始化要分开

属性填充和初始化被拆成两步，不是设计洁癖，而是循环依赖能解开的窗口——实例化之后、属性填充之前，对象已经存在、字段还没填，这个间隙可以把「半成品」提前暴露出去。三级缓存正是靠这个间隙工作的，详见 [循环依赖与三级缓存](./chapter-06-circular-dependency.md)。
