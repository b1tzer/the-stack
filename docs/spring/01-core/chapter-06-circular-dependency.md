# 循环依赖与三级缓存

> 两个 Bean 互相依赖，构造器注入直接报错，字段注入却能「建出来」。可一旦要注入的对象还背着代理（比如 `@Async`），默认配置下启动直接失败，强行放开又拿到缺代理的半成品，注解悄悄失效。解开这个结的，是 `DefaultSingletonBeanRegistry` 里的三个 Map。记住这三个 Map 的名字不难，难的是回答一个更根本的问题：为什么偏偏是三级，不是两级。

::: warning 版本锚点
Spring Boot 2.6 起默认禁止循环依赖，`spring.main.allow-circular-references` 默认为 `false`，遇到循环依赖直接启动报错。本文讲的「三级缓存解开循环依赖」只在显式开启 `allow-circular-references=true` 后生效。
:::

## 1. Bean 的三步与循环依赖的卡点

一个 Bean 从创建到销毁的完整流程见 [Bean 完整生命周期](./chapter-03-bean-lifecycle.md)，这里只回顾和循环依赖相关的三步，顺序固定：

```txt
1. 实例化     new 出对象，字段全是 null
2. 属性填充   往对象里注入依赖（这一步才去容器拿别的 Bean）
3. 初始化     回调 Aware、@PostConstruct，最后创建 AOP 代理
```

循环依赖的卡点，取决于依赖在哪个阶段被索取。构造器注入在实例化时就要依赖，此时对象尚未创建，死结在启动阶段直接暴露：

```java
@Service
public class ServiceA {
    private final ServiceB b;
    public ServiceA(ServiceB b) { this.b = b; }
}

@Service
public class ServiceB {
    private final ServiceA a;
    public ServiceB(ServiceA a) { this.a = a; }
}
```

```txt
BeanCurrentlyInCreationException: Error creating bean with name 'serviceA':
Requested bean is currently in creation: Is there an unresolvable circular reference?
```

字段注入和 Setter 注入不同，它们在第 2 步才索取依赖，此时对象已经 `new` 出来，只是字段还没填。这个「对象已存在、尚未完成」的间隙，就是解开死结的窗口。

## 2. 提前暴露：用窗口解开死结

窗口在第 1 步和第 2 步之间：对象已经存在，字段还没填，引用却可以先交出去。

Spring 的做法是**提前暴露**——实例化一完成，就把半成品的引用存进一个地方；别的 Bean 需要时先拿它用，这个 Bean 自己则继续走完第 2、3 步，最终成为成品。

这套「先交半成品、后补成品」的机制，落在 `DefaultSingletonBeanRegistry` 里，用三个 Map 实现。

## 3. 三个 Map，一条流水线

```java
/** 一级缓存：成品，完整可用 */
private final Map<String, Object> singletonObjects = new ConcurrentHashMap<>(256);

/** 二级缓存：半成品，已提前暴露的引用 */
private final Map<String, Object> earlySingletonObjects = new ConcurrentHashMap<>(16);

/** 三级缓存：对象工厂，能延迟产出半成品 */
private final Map<String, ObjectFactory<?>> singletonFactories = new HashMap<>(16);
```

三个 Map 不是平级的，是一条流水线：

```txt
singletonFactories（三级）  存 ObjectFactory，等有人来取才生产半成品
        │ getObject()
        ▼
earlySingletonObjects（二级）存生产出来的半成品，避免重复生产
        │ 初始化完成
        ▼
singletonObjects（一级）    存最终成品
```

取 Bean 的入口 `getSingleton` 按一、二、三级的顺序依次查，查到就返回，并把三级升到二级。三个 Map 各司其职，取数顺序也不难理解。真正的问题在第三级：既然两级就能「先交半成品」，为什么要多存一个 `ObjectFactory`？

## 4. 为什么是三级

如果只是为了「先交半成品」，两级就够：一个 Map 存成品，一个 Map 存半成品。多出来的第三级，是为了 AOP。

AOP 代理的正常时机在第 3 步初始化之后，但循环依赖要求第 2 步填充时就拿到引用。两个时机冲突：

- 只用两级、在第 1 步就把半成品放进二级缓存，缓存里装的就必须是一个已经定型的对象。装裸对象，循环依赖时对方拿到的是未代理的引用，初始化后再包代理就会造成引用不一致，这正是第 5 节 `@Async` 崩溃的机理；装代理对象，则每个 Bean 都要在实例化后就完成代理判断，哪怕它根本没有循环依赖，白白破坏「代理留在初始化最后」的约定。两级缓存在这个两难里顾此失彼。
- 三级缓存存的是 `ObjectFactory`，不是对象本身。工厂把「要不要代理、代理成什么」推迟到「真的有人来取」的那一刻，只有发生循环依赖、真的有人提前来取时，才现场裁决并生产代理。

这就是三级缓存存在的核心作用：**把 AOP 代理的决策，推迟到不得不做的时候**。它不是性能优化，是一个时机问题。

工厂里做代理决策的是 `getEarlyBeanReference`：

```java
// AbstractAutoProxyCreator#getEarlyBeanReference
public Object getEarlyBeanReference(Object bean, String beanName) {
    this.earlyProxyReferences.put(cacheKey, bean);
    return wrapIfNecessary(bean, beanName, cacheKey);  // 需要代理就返回代理对象
}
```

它不直接返回裸对象，而是先问 `wrapIfNecessary`：这个 Bean 需不需要 AOP 代理，需要就提前包一层。`getEarlyBeanReference` 由 `AbstractAutoProxyCreator` 统一实现，`@Aspect`、`@Transactional` 对应的自动代理创建器（`AnnotationAwareAspectJAutoProxyCreator`、`InfrastructureAdvisorAutoProxyCreator`）都是它的子类，所以这些增强的代理时机与提前暴露兼容，能在循环依赖中被解开。

`getEarlyBeanReference` 里的 `this.earlyProxyReferences.put(cacheKey, bean)` 登记「这个 Bean 已经提前代理过」。三级缓存的 `ObjectFactory` 是每个 Bean 一个的闭包，被调用时才执行 `wrapIfNecessary` 现场裁决要不要代理；`earlyProxyReferences` 则记录哪些 Bean 已经走过这次裁决。初始化完成后的后处理里，`AbstractAutoProxyCreator` 先 `remove(cacheKey)` 查这份名单，发现记录仍在就直接返回，不再调用 `wrapIfNecessary`，从而跳过二次代理。

## 5. @Async 为什么解不开

不是所有自动代理机制都接了提前暴露。`@Async` 的 `AsyncAnnotationBeanPostProcessor` 不实现 `SmartInstantiationAwareBeanPostProcessor`，没有 `getEarlyBeanReference` 这一层。

于是出现这样的情形：

```java
@Service
public class OrderService {
    @Autowired
    private UserService userService;

    @Async
    public void sendNotification() { /* 异步发送 */ }
}

@Service
public class UserService {
    @Autowired
    private OrderService orderService;
}
```

启动直接报错，抛 `BeanCurrentlyInCreationException`。`UserService` 在第 2 步拿到的是 `orderService` 提前暴露的裸对象，而 `orderService` 初始化完成后又被 `AsyncAnnotationBeanPostProcessor` 包成了代理；两个对象不一致，Spring 的一致性检查（`allowRawInjectionDespiteWrapping` 默认关闭）拒绝让一个 Bean 持有另一个 Bean 的旧引用，启动失败。

即便把 `allowRawInjectionDespiteWrapping` 设为 `true` 强行放开，`UserService` 拿到的仍是裸对象，`sendNotification()` 的 `@Async` 不生效，调用退化成同步执行——问题只是从启动期挪到了运行期。

这一条不是「还没修好的 bug」，而是设计立场的体现：`@Async` 走的是 `AbstractAdvisingBeanPostProcessor` 这套独立于自动代理创建器的代理体系，没有接入提前暴露；Spring 认为循环依赖本身是坏味道，不值得为它让 `@Async` 也支持提前代理。Boot 2.6 默认禁止循环依赖，就是这个立场的落地。

## 6. 能解与不能解

各种注入方式放进循环依赖，结果如下：

| 场景 | 结果 | 原因 |
| :-- | :-- | :-- |
| 构造器注入 | ❌ 报错 | 实例化阶段就要依赖，没有提前暴露的窗口 |
| 字段 / Setter 注入 | ✅ 可解 | 实例化完成、提前暴露后才填充 |
| prototype 作用域 | ❌ 不参与 | 三级缓存只对单例生效 |
| `@Transactional` / `@Aspect` | ✅ 可解 | 自动代理创建器支持提前代理 |
| `@Async` | ❌ 报错 | 代理不接提前暴露，早期引用与最终对象不一致 |

这张表读出的不是「避开哪些坑」，而是**三级缓存的能力边界**：它只解「字段/Setter 注入 + 单例」的循环依赖；一旦涉及 AOP 代理，还要求增强由支持提前代理的自动代理创建器处理，否则像 `@Async` 一样启动报错。

即便在边界之内，能解也不等于该用。循环依赖几乎总是设计坏味道，拆出一个公共组件、用事件解耦，都比显式放开 `allow-circular-references` 更干净。构造器注入是更该坚持的默认选择——它让循环依赖在启动时就报错，而不是让一个缺了代理的对象在运行期才暴露问题。
