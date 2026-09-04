# AOP 面向切面编程

> AOP 解决的问题不是「怎么写日志」，是「日志、事务、权限这些散落各处的代码，为什么必须复制到每个方法里」。切面编程把这类横切逻辑抽出来，声明一次，应用到所有匹配的方法。代价是：你以为在调 `this.method()`，其实走的是代理。本文讲清楚代理机制、决策时机、失效场景与源码链路；切点表达式怎么写、自定义注解怎么落地，见 [AOP 实战](../11-practice/chapter-04-aop-in-action.md)。

## 1. 为什么需要 AOP

一段记录耗时的代码，如果不用 AOP，要写进每个业务方法：

```java
public void createOrder() {
    long start = System.currentTimeMillis();
    // 业务逻辑
    log.info("createOrder 耗时 {}ms", System.currentTimeMillis() - start);
}

public void cancelOrder() {
    long start = System.currentTimeMillis();
    // 业务逻辑
    log.info("cancelOrder 耗时 {}ms", System.currentTimeMillis() - start);
}
```

计时代码和业务逻辑纠缠在一起，改一处要动几十个方法。AOP 把这段横切逻辑抽成一个切面，业务方法里什么都不用写。

## 2. 核心概念

| 术语 | 含义 |
| :-- | :-- |
| Aspect（切面） | 横切关注点的模块化，等于切点 + 通知 |
| JoinPoint（连接点） | 程序执行中的某个点，Spring 里就是方法调用 |
| Pointcut（切点） | 匹配连接点的表达式，决定切哪些方法 |
| Advice（通知） | 在连接点执行的动作，决定切进去做什么 |
| Weaving（织入） | 把切面应用到目标对象、生成代理的过程 |

一句话串起来：切点挑出目标方法，通知定义要执行的逻辑，两者组成切面，织入后由代理对象代跑。

## 3. 通知类型

五种通知对应方法执行的不同时机：

```java
@Aspect
@Component
public class LogAspect {

    @Before("execution(* com.example.service.*.*(..))")
    public void before(JoinPoint jp) { /* 方法执行前 */ }

    @AfterReturning(pointcut = "execution(* com.example.service.*.*(..))", returning = "result")
    public void afterReturning(Object result) { /* 正常返回后 */ }

    @AfterThrowing(pointcut = "execution(* com.example.service.*.*(..))", throwing = "ex")
    public void afterThrowing(Exception ex) { /* 抛异常后 */ }

    @After("execution(* com.example.service.*.*(..))")
    public void after() { /* 无论成败都执行，类似 finally */ }

    @Around("execution(* com.example.service.*.*(..))")
    public Object around(ProceedingJoinPoint pjp) throws Throwable {
        // 最灵活：能拦截、改参数、改返回值
        return pjp.proceed();
    }
}
```

`@Around` 最强大也最容易出错——忘记调用 `pjp.proceed()`，目标方法就不会执行。

## 4. 代理机制：JDK Proxy 与 CGLIB

Spring AOP 不直接改目标类的字节码，而是生成一个代理对象挡在前面。代理有两种生成方式：

| 维度 | JDK 动态代理 | CGLIB |
| :-- | :-- | :-- |
| 前提 | 目标类必须实现接口 | 无接口要求 |
| 原理 | `java.lang.reflect.Proxy` 反射 | 生成目标类的子类，覆写方法 |
| 限制 | 只能代理接口方法 | 不能代理 `final` 类 / `final` 方法 |

::: warning 版本锚点
Spring Boot 2.0 起默认使用 CGLIB（`spring.aop.proxy-target-class` 默认 `true`），因为大多数业务类不实现接口。
:::

```txt
调用方 → 代理对象（CGLIB 子类）
              │ 拦截
              ▼
         切面通知（before / around ...）
              │
              ▼
         目标方法
```

## 5. 代理是怎么被决定的

第 4 节讲代理用什么生成（JDK 代理 / CGLIB），这一节回答更靠前的问题：Spring 怎么决定一个 Bean 要不要生成代理、在什么时机生成。

### 5.1 决策发生在初始化之后

每个 Bean 走完初始化（`@PostConstruct`、`InitializingBean` 等）后，`AbstractAutoProxyCreator#postProcessAfterInitialization` 会调用 `wrapIfNecessary`，对 Bean 做一次「要不要代理」的裁决。它先查 `earlyProxyReferences`：这个 Bean 若在循环依赖时已经提前代理过，就直接放行；否则进入真正的裁决逻辑：

```java
// AbstractAutoProxyCreator#wrapIfNecessary
Object[] specificInterceptors = getAdvicesAndAdvisorsForBean(bean, beanName, null);
if (specificInterceptors != DO_NOT_PROXY) {
    return createProxy(bean.getClass(), beanName, specificInterceptors, new SingletonTargetSource(bean));
}
return bean;
```

裁决的核心是 `getAdvicesAndAdvisorsForBean` → `findEligibleAdvisors`：把容器里所有 `Advisor` 找出来，用每个 `Advisor` 的 `Pointcut` 去匹配当前 Bean 的类和方法，匹配上才织入。匹配不到，返回裸对象，这个 Bean 全程不经过代理。

### 5.2 为什么必须到运行时才判

这个裁决无法在「代码写好」时就静态确定，因为 `Advisor` 集合本身是运行时装配出来的：

- `@Aspect` 切面会被解析成 `Advisor` Bean，但它自己也要走实例化、依赖注入，谁先谁后由容器决定。
- `@Transactional`、`@Async` 的拦截器来自各自的 `BeanPostProcessor`，是否注册、注册几个，取决于 classpath 上引了哪些 starter。

要判断一个 Bean 要不要代理，得先知道容器里到底有哪些 `Advisor`；这个集合只有等所有 Bean 定义解析完、相关 Bean 实例化之后才稳定。所以决策不能提前算好，只能推迟到目标 Bean 初始化完成的那个点，现场拉齐 `Advisor` 再匹配。

### 5.3 循环依赖把决策提前到「有人来取」时

正常 Bean 在初始化后裁决。循环依赖打乱了「先初始化、后裁决」的顺序：A 填充属性时要拿 B，B 还没初始化完。此时 `getEarlyBeanReference` 被调用，用同一套 `wrapIfNecessary` 逻辑先裁决一次，结果记进 `earlyProxyReferences`，初始化完成后不再二次代理。而这次提前裁决之所以拿得到正确的 `Advisor`，是因为「取 B」这个动作本身会触发相关 Advisor Bean 的创建，`findEligibleAdvisors` 现场就能拉齐集合。完整链路见 [循环依赖与三级缓存](./chapter-06-circular-dependency.md)。

## 6. AOP 失效的四种情况

代理机制决定了一条硬规则：只有从容器拿到的 Bean、经过代理对象调用的方法，AOP 才生效。违反它，注解就「不生效」。

### 6.1 自调用

```java
@Service
public class OrderService {
    public void process() {
        this.validate();  // ❌ 直接调 this，绕过代理
    }

    @Transactional
    public void validate() { /* ... */ }
}
```

`this.validate()` 调用的是目标对象本身，不是代理对象，切面拦不到。修法是注入自身代理，或用 `AopContext.currentProxy()`。

### 6.2 private 方法

CGLIB 靠继承子类、覆写方法来实现代理，`private` 方法无法被覆写，也就无法增强。

### 6.3 final 类 / final 方法

同理，CGLIB 需要继承，`final` 阻断继承，代理无法生成。

### 6.4 未被 Spring 管理

```java
OrderService service = new OrderService();  // ❌ 手动 new，没有代理
service.process();
```

手动 `new` 出来的对象不在容器里，没经过代理，注解全部失效。

> AOP 的价值是让横切逻辑与业务逻辑解耦，代价是「方法调用变成了代理转发」。理解这一点，就同时理解了两件事：代理怎么生成（JDK Proxy / CGLIB），以及为什么 `this.xxx()` 这类自调用会让注解失效。

## 7. AOP 与代理的源码级细节 {#source-detail}

第 5 节讲了「什么时候决定代理」，这一节往下走一层：代理是怎么被真正创建出来的。

### 7.1 AbstractAutoProxyCreator —— AOP 的入口

Spring 里所有自动代理的逻辑都集中在 `AbstractAutoProxyCreator`，它实现了 `SmartInstantiationAwareBeanPostProcessor`，挂在 Bean 生命周期的初始化后阶段：

```txt
DefaultListableBeanFactory
  └─ AbstractBeanFactory#getBean()
       └─ AbstractAutowireCapableBeanFactory#initializeBean()
            └─ applyBeanPostProcessorsAfterInitialization()
                 └─ AbstractAutoProxyCreator#postProcessAfterInitialization()
                      └─ wrapIfNecessary()
```

`AbstractAutoProxyCreator` 有几个关键子类：

| 子类 | 触发方式 |
| :-- | :-- |
| `AnnotationAwareAspectJAutoProxyCreator` | `@EnableAspectJAutoProxy` / `@Configuration` 自动注册 |
| `InfrastructureAdvisorAutoProxyCreator` | Spring 内部基础设施（如事务） |
| `AbstractAdvisorAutoProxyCreator` | 通用基类，遍历所有 Advisor |

你在 Spring Boot 里加 `@EnableAspectJAutoProxy` 或引了 `spring-boot-starter-aop`，容器里注册的就是 `AnnotationAwareAspectJAutoProxyCreator`。

### 7.2 wrapIfNecessary 全流程

`wrapIfNecessary` 是代理创建的核心方法，逻辑分三步：

```java
// AbstractAutoProxyCreator#wrapIfNecessary（简化）
protected Object wrapIfNecessary(Object bean, String beanName, Object cacheKey) {
    // 1. 跳过已经在 earlyProxyReferences 里代理过的 Bean
    if (this.earlyProxyReferences.remove(cacheKey) != null) {
        return bean;
    }

    // 2. 查找匹配的拦截器（Advisor）
    Object[] specificInterceptors = getAdvicesAndAdvisorsForBean(bean.getClass(), beanName, null);

    // 3. 没有匹配的拦截器 → 返回原始 Bean
    if (specificInterceptors == DO_NOT_PROXY) {
        return bean;
    }

    // 4. 有匹配 → 创建代理
    Object proxy = createProxy(bean.getClass(), beanName,
            specificInterceptors, new SingletonTargetSource(bean));
    this.proxyTypes.put(cacheKey, proxy.getClass());
    return proxy;
}
```

关键在第 2 步 `getAdvicesAndAdvisorsForBean`，它的调用链：

```txt
getAdvicesAndAdvisorsForBean()
  └─ findEligibleAdvisors()
       ├─ findCandidateAdvisors()     // 从容器收集所有 Advisor Bean
       │    ├─ BeanFactoryAdvisorRetrievalHelper 拿实现了 Advisor 接口的 Bean
       │    └─ BeanFactoryAspectJAdvisorsBuilder 拿 @Aspect 类，解析出 Advisor
       └─ findAdvisorsThatCanApply()  // 用 Pointcut 匹配当前 Bean 的方法
            └─ AopUtils#canApply()     // 逐个 Advisor 检查
```

`findCandidateAdvisors` 把容器里所有 `Advisor` Bean 拉出来，包括 `@Aspect` 解析出来的、`@Transactional` 背后的 `TransactionInterceptor` 等。`findAdvisorsThatCanApply` 用每个 `Advisor` 的 `Pointcut` 去匹配目标 Bean 的类和方法，匹配不上就过滤掉。最终 `specificInterceptors` 里只剩真正相关的拦截器。

### 7.3 createProxy —— 选 JDK 还是 CGLIB {#create-proxy}

`createProxy` 内部先决定用哪种代理：

```java
// DefaultAopProxyFactory#createAopProxy()
public AopProxy createAopProxy(AdvisedSupport config) {
    if (config.isOptimize() || config.isProxyTargetClass()
            || hasNoUserSuppliedProxyInterfaces(config)) {
        Class<?> targetClass = config.getTargetClass();
        if (targetClass.isInterface() || Proxy.isProxyClass(targetClass)) {
            return new JdkDynamicAopProxy(config);
        }
        return new ObjenesisCglibAopProxy(config);
    } else {
        return new JdkDynamicAopProxy(config);
    }
}
```

决策逻辑：

```txt
proxyTargetClass = true（Spring Boot 默认）
  ├─ 目标类是接口 → JdkDynamicAopProxy
  └─ 否则 → CglibAopProxy

proxyTargetClass = false
  └─ 目标类实现了接口 → JdkDynamicAopProxy
  └─ 没实现接口 → CglibAopProxy
```

### 7.4 代理对象长什么样

CGLIB 代理是目标类的子类，核心拦截逻辑在 `DynamicAdvisedInterceptor#intercept`：

```java
// CglibAopProxy$DynamicAdvisedInterceptor#intercept（简化）
public Object intercept(Object proxy, Method method, Object[] args,
        MethodProxy methodProxy) throws Throwable {

    // 1. 把方法调用封装成 MethodInvocation
    MethodInvocation invocation = new ReflectiveMethodInvocation(
            proxy, target, method, args, targetClass, chain);

    // 2. 按链式顺序执行拦截器，最后调用目标方法
    return invocation.proceed();
}
```

`chain` 是 `wrapIfNecessary` 找到的拦截器列表。`proceed()` 会依次调用每个拦截器的 `invoke` 方法，最后一个拦截器执行完后，调用目标方法。这就是 `@Before` → `目标方法` → `@AfterReturning` 那条链。

JDK 动态代理的逻辑类似，区别在 `JdkDynamicAopProxy#invoke`，它直接实现 `InvocationHandler`，拦截链的构建方式完全一样。

### 7.5 源码流程总览

```txt
Spring 容器启动
  │
  ├─ 解析 @Aspect 类 → AspectJAdvisorFactory → Advisor Bean
  │
  └─ 实例化业务 Bean
       │
       ├─ initializeBean()
       │    └─ AbstractAutoProxyCreator#postProcessAfterInitialization()
       │         └─ wrapIfNecessary()
       │              ├─ findEligibleAdvisors()  ← 收集 + 匹配 Advisor
       │              ├─ DO_NOT_PROXY? → 返回原始 Bean
       │              └─ 匹配成功 → createProxy()
       │                   ├─ JdkDynamicAopProxy（接口）
       │                   └─ CglibAopProxy（类）
       │
       └─ 容器持有的是代理对象，不是原始对象

方法调用
  │
  ├─ 调用方拿到代理 → invoke / intercept
  │    └─ 拦截器链依次执行 → 最终调目标方法
  └─ AOP 生效

自调用 this.method()
  │
  └─ 绕过代理 → 拦截器链不走 → AOP 失效
```

理解这条链路，就能回答 AOP 相关的所有「为什么不生效」问题：代理是在 `initializeBean` 之后才创建的，所以构造器里调 `this.method()` 不会被拦截；自调用绕过了代理的 `invoke`/`intercept`，所以切面不生效；`final` 类无法被 CGLIB 继承，所以代理创建失败。

> 从代理决策到源码创建，从 `wrapIfNecessary` 到 `DynamicAdvisedInterceptor#intercept`，AOP 的整条链路就是：**表达式选方法 → 拦截器包方法 → 代理转发调用**。三个概念，一条管道。切点表达式的写法与自定义注解的实战范例，见 [AOP 实战](../11-practice/chapter-04-aop-in-action.md)。
