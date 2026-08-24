# AOP 面向切面编程

> AOP 解决的问题不是「怎么写日志」，是「日志、事务、权限这些散落各处的代码，为什么必须复制到每个方法里」。切面编程把这类横切逻辑抽出来，声明一次，应用到所有匹配的方法。代价是：你以为在调 `this.method()`，其实走的是代理。

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

```text
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

正常 Bean 在初始化后裁决。循环依赖打乱了「先初始化、后裁决」的顺序：A 填充属性时要拿 B，B 还没初始化完。此时 `getEarlyBeanReference` 被调用，用同一套 `wrapIfNecessary` 逻辑先裁决一次，结果记进 `earlyProxyReferences`，初始化完成后不再二次代理。而这次提前裁决之所以拿得到正确的 `Advisor`，是因为「取 B」这个动作本身会触发相关 Advisor Bean 的创建，`findEligibleAdvisors` 现场就能拉齐集合。完整链路见 [循环依赖与三级缓存](./chapter-05-circular-dependency.md)。

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
