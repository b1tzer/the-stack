# AOP 实战：切点表达式与自定义注解

> 本篇讲**怎么用** AOP：切点表达式怎么写、自定义注解怎么落地。原理层面的代理机制、决策时机、失效场景与源码链路见 [AOP 面向切面编程](../01-core/chapter-05-aop.md)，本文不再重复。

## 1. 切点表达式详解

切点表达式决定「切哪些方法」。写错了，切面要么拦不到任何方法，要么把不该拦的全拦了。Spring AOP 支持的切点指示符不多，但组合起来覆盖面很广。

### 1.1 execution —— 最常用

`execution` 按方法签名匹配，语法固定：

```txt
execution(修饰符? 返回类型 类名.方法名(参数) 异常?)
```

通配符：`*` 匹配一个词，`..` 匹配多个（包路径或参数列表）。

```java
// 匹配 service 包下所有 public 方法
@Around("execution(* com.example.service.*.*(..))")

// 匹配 service 包及子包下所有方法（含非 public）
@Around("execution(* com.example.service..*.*(..))")

// 只匹配返回 String 的方法
@AfterReturning(pointcut = "execution(String com.example.service.*.*(..))", returning = "r")

// 只匹配有两个参数、第一个是 Long 的方法
@Before("execution(* com.example.service.*.*(Long, *))")
```

### 1.2 within —— 按类匹配

`within` 只关心类，不关心方法签名。当你想拦截某个类（或包）的所有方法时，比 `execution` 简洁：

```java
// 拦截 OrderService 所有方法
@Before("within(com.example.service.OrderService)")

// 拦截 service 包下所有类的所有方法
@Before("within(com.example.service.*)")

// 拦截 service 包及所有子包
@Before("within(com.example.service..*)")
```

`within` 和 `execution(* com.example.service.*.*(..))` 看起来等价，但有一个关键区别：`execution` 能精确到参数和返回值，`within` 不能。

### 1.3 @annotation —— 按注解匹配

`@annotation` 匹配方法上标注了指定注解的方法。这是自定义切面的核心——后面第 2 节会大量用到：

```java
// 匹配所有标注了 @Log 的方法
@Before("@annotation(com.example.annotation.Log)")

// 匹配类上标注了 @RestController 的所有方法
@Around("@within(org.springframework.web.bind.annotation.RestController)")
```

`@annotation` 匹配方法级注解，`@within` 匹配类级注解，别搞混。

### 1.4 args / @args —— 按参数匹配

`args` 匹配运行时参数类型，`@args` 匹配参数上的注解：

```java
// 匹配第一个参数是 HttpServletRequest 的方法
@Before("args(jakarta.servlet.http.HttpServletRequest, ..)")

// 结合 execution，精确匹配方法签名 + 运行时参数类型
@Around("execution(* com.example.service.*.*(..)) && args(request, ..)")
public Object around(ProceedingJoinPoint pjp, HttpServletRequest request) {
    // 可以直接用 request，不用从参数列表里取
    return pjp.proceed();
}
```

### 1.5 组合切点

切点指示符可以用 `&&`、`||`、`!` 组合：

```java
// service 包下、且类名不以 Internal 结尾、且类上标注了 @Service 的方法
@Around("within(com.example.service.*) " +
        "&& !within(com.example.service..*Internal) " +
        "&& @within(org.springframework.stereotype.Service)")

// 提取公共切点，避免重复写
@Pointcut("execution(* com.example.service..*.*(..))")
public void serviceLayer() {}

@Pointcut("@annotation(com.example.annotation.Loggable)")
public void loggable() {}

@Before("serviceLayer() && loggable()")
public void before(JoinPoint jp) { /* ... */ }
```

### 1.6 指示符速查表

| 指示符 | 匹配维度 | 典型场景 |
| :-- | :-- | :-- |
| `execution` | 方法签名（返回值、类、方法名、参数） | 最通用，精确控制 |
| `within` | 类或包 | 拦截整个包/类 |
| `@annotation` | 方法上的注解 | 自定义注解驱动 |
| `@within` / `@target` | 类上的注解 | 按类注解拦截 |
| `args` | 运行时参数类型 | 按参数做特殊处理 |
| `bean` | Bean 名称（Spring 特有） | 按 Bean 名称拦截 |

::: warning 注意
Spring AOP 是基于代理的，`execution` 只能匹配 **public** 方法（JDK 代理）或**非 private** 方法（CGLIB）。`within` 和 `args` 同理。如果需要拦截 private 方法，得用 AspectJ 编译期织入，Spring AOP 做不到。
:::

## 2. 自定义注解 + AOP 实战

切点表达式能按包、按类、按方法签名匹配，但最灵活的方式是**自定义注解**：在方法上贴一个注解，AOP 自动拦截。好处是显式、可读，不依赖包路径约定。

### 2.1 定义注解

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Loggable {
    String module() default "";   // 业务模块
    String action() default "";   // 操作类型
}
```

`@Retention(RetentionPolicy.RUNTIME)` 是必须的——AOP 在运行时通过反射读注解，编译期就丢掉的话读不到。

### 2.2 编写切面

```java
@Aspect
@Component
public class LogAspect {

    private static final Logger log = LoggerFactory.getLogger(LogAspect.class);

    @Around("@annotation(loggable)")
    public Object around(ProceedingJoinPoint pjp, Loggable loggable) throws Throwable {
        String module = loggable.module();
        String action = loggable.action();
        String method = pjp.getSignature().toShortString();

        log.info("[{}][{}] 开始执行: {}", module, action, method);
        long start = System.currentTimeMillis();

        try {
            Object result = pjp.proceed();
            long cost = System.currentTimeMillis() - start;
            log.info("[{}][{}] 执行成功: {} 耗时 {}ms", module, action, method, cost);
            return result;
        } catch (Throwable ex) {
            long cost = System.currentTimeMillis() - start;
            log.error("[{}][{}] 执行失败: {} 耗时 {}ms", module, action, method, cost, ex);
            throw ex;
        }
    }
}
```

`@annotation(loggable)` 中的 `loggable` 是方法参数名，Spring 会自动把匹配到的注解实例注入进来，省去手动从方法上反射取注解的步骤。

### 2.3 使用

```java
@Service
public class OrderService {

    @Loggable(module = "订单", action = "创建")
    public Order createOrder(CreateOrderRequest req) { /* ... */ }

    @Loggable(module = "订单", action = "取消")
    public void cancelOrder(Long orderId) { /* ... */ }
}
```

调用 `createOrder` 时，切面自动记录开始、结束、耗时、异常，业务代码零侵入。

### 2.4 更多实战场景

同一个「自定义注解 + AOP」模式可以套用到很多场景：

```java
// ---------- 权限校验 ----------
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RequirePermission {
    String value();
}

@Aspect
@Component
public class PermissionAspect {
    @Before("@annotation(perm)")
    public void check(JoinPoint jp, RequirePermission perm) {
        String required = perm.value();
        // 从 SecurityContext 或 ThreadLocal 取当前用户权限
        if (!currentUserHasPermission(required)) {
            throw new AccessDeniedException("缺少权限: " + required);
        }
    }
}

// ---------- 接口限流 ----------
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RateLimit {
    int value();           // 允许的请求数
    int windowSeconds() default 1;  // 时间窗口
}

@Aspect
@Component
public class RateLimitAspect {
    private final RedissonClient redisson;

    @Around("@annotation(limiter)")
    public Object around(ProceedingJoinPoint pjp, RateLimit limiter) throws Throwable {
        String key = "rate:" + pjp.getSignature().toShortString();
        RRateLimiter rateLimiter = redisson.getRateLimiter(key);
        rateLimiter.trySetRate(RateType.OVERALL, limiter.value(),
                limiter.windowSeconds(), RateIntervalUnit.SECONDS);
        if (!rateLimiter.tryAcquire()) {
            throw new TooManyRequestsException();
        }
        return pjp.proceed();
    }
}

// ---------- 使用 ----------
@RestController
public class OrderController {

    @RequirePermission("order:create")
    @PostMapping("/orders")
    public Order create(@RequestBody CreateOrderRequest req) { /* ... */ }

    @RateLimit(value = 100, windowSeconds = 60)
    @GetMapping("/orders")
    public List<Order> list() { /* ... */ }
}
```

### 2.5 最佳实践

| 实践 | 说明 |
| :-- | :-- |
| 注解用 `@Target(ElementType.METHOD)` | 限制在方法上，避免误标在类/字段上 |
| 注解必须 `RUNTIME` retention | 编译期丢掉的注解 AOP 读不到 |
| 切面用 `@Order` 控制顺序 | 多个切面同时拦截同一方法时，数值小的先执行 |
| 注解属性保持精简 | 复杂逻辑放切面里，注解只做声明 |
| 切面里做异常处理 | 不要让切面的异常吞掉业务异常 |

::: warning 多切面顺序
一个方法被多个切面拦截时，执行顺序由 `@Order` 控制。如果没有显式指定，顺序不确定。生产环境务必显式标注：
```java
@Aspect
@Component
@Order(1)  // 数值越小，越先执行
public class LogAspect { /* ... */ }

@Aspect
@Component
@Order(2)
public class PermissionAspect { /* ... */ }
```
:::

## 3. 排查清单

切面不生效时，按以下顺序检查：

| 检查项 | 处置 |
| :-- | :-- |
| 目标类是不是 Spring Bean | 手动 `new` 出来的对象不会被代理，详见 [AOP](../01-core/chapter-05-aop.md) §6.4 |
| 是不是 `this` 自调用 | 自调用绕过代理，详见 [AOP](../01-core/chapter-05-aop.md) §6.1 |
| 方法是不是 `private` / `final` | 代理无法覆写，详见 [AOP](../01-core/chapter-05-aop.md) §6.2 §6.3 |
| 切点表达式是否匹配 | 用 `AopUtils.isAopProxy(bean)` 确认代理已生成，再看 `Advised#getAdvisors` 里有没有你写的 `Advisor` |
| 注解 retention 是不是 `RUNTIME` | `SOURCE` / `CLASS` 保留策略运行时读不到 |
| 多切面顺序 | 显式标注 `@Order`，避免依赖默认顺序 |
