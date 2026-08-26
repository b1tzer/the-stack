# 拦截器与过滤器

> HTTP 请求到达 Controller 之前，有很多通用逻辑需要处理：鉴权、日志、CORS、编码、限流。Spring 提供了两个拦截点：Filter（Servlet 规范，在 DispatcherServlet 之外）和 Interceptor（Spring MVC 规范，在 DispatcherServlet 之内）。类比：Filter 是机场安检——检查所有进入机场的人；Interceptor 是登机口检票——只检查要登机的旅客，能看到你买了什么票、去哪个座位。

## 1. 最小可运行示例

先跑通一个请求耗时日志拦截器，再解释原理。

**拦截器：**

```java
@Component
public class LoggingInterceptor implements HandlerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(LoggingInterceptor.class);

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        request.setAttribute("startTime", System.currentTimeMillis());
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
            Object handler, Exception ex) {
        long duration = System.currentTimeMillis() - (long) request.getAttribute("startTime");
        log.info("{} {} 耗时 {}ms 状态码 {}", request.getMethod(), request.getRequestURI(),
                duration, response.getStatus());
    }
}
```

**注册：**

```java
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    @Autowired
    private LoggingInterceptor loggingInterceptor;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(loggingInterceptor)
                .addPathPatterns("/api/**");
    }
}
```

启动后访问任意 `/api/**` 接口，控制台自动打印请求方法、路径、耗时、状态码。这就是拦截器的核心价值：**通用逻辑从业务代码中抽离，集中处理**。

## 2. Filter vs Interceptor

| 维度 | Filter | Interceptor |
|------|--------|-------------|
| 规范 | Servlet（Java EE） | Spring MVC |
| 作用范围 | 所有请求（包括静态资源） | 只拦截 Controller 方法 |
| 能拿到 Handler 信息 | ❌ 不能 | ✅ 能拿到 Controller 类名、方法名 |
| 异常处理 | 不被 `@ExceptionHandler` 捕获 | 被 `@ExceptionHandler` 捕获 |
| 执行位置 | DispatcherServlet 之外 | DispatcherServlet 之内 |
| 注册方式 | `FilterRegistrationBean` / `@WebFilter` | `WebMvcConfigurer.addInterceptors()` |

**为什么 Filter 拿不到 Handler 信息？** 因为 Filter 执行时，请求还没有进入 DispatcherServlet，HandlerMapping 还没有查找目标 Controller。Filter 看到的是原始的 `HttpServletRequest`，不知道这个请求会被哪个 Controller 处理。

**为什么 Filter 异常不被 `@ExceptionHandler` 捕获？** 因为 `@ExceptionHandler` 是 DispatcherServlet 内部的异常处理机制。Filter 在 DispatcherServlet 之外执行，异常直接由 Servlet 容器（Tomcat）处理，走的是容器的错误页面机制。

### 2.1 执行顺序

```text
请求进入
  │
  ▼
Filter-1.doFilter()          ← Servlet 容器调用
  │
  ▼
Filter-2.doFilter()
  │
  ▼
DispatcherServlet.doDispatch()
  │
  ├── Interceptor-1.preHandle()
  ├── Interceptor-2.preHandle()
  │
  ├── Controller 方法执行
  │
  ├── Interceptor-2.postHandle()
  ├── Interceptor-1.postHandle()    ← 反序
  │
  ├── 视图渲染 / 返回值处理
  │
  ├── Interceptor-2.afterCompletion()
  └── Interceptor-1.afterCompletion()  ← 反序
  │
  ▼
Filter-2.doFilter() 返回
  │
  ▼
Filter-1.doFilter() 返回
```

拦截器三个回调的执行时机：
- `preHandle`：Controller 执行**之前**，返回 `false` 则中断请求
- `postHandle`：Controller 执行**之后**，视图渲染**之前**
- `afterCompletion`：视图渲染**之后**，**无论是否异常都会执行**

## 3. Filter 注册

### 3.1 FilterRegistrationBean

```java
@Configuration
public class FilterConfig {

    @Bean
    public FilterRegistrationBean<RequestIdFilter> requestIdFilter() {
        FilterRegistrationBean<RequestIdFilter> registration = new FilterRegistrationBean<>();
        registration.setFilter(new RequestIdFilter());
        registration.addUrlPatterns("/api/*");
        registration.setOrder(0);  // 值越小越先执行
        return registration;
    }
}
```

### 3.2 OncePerRequestFilter

Spring 提供的抽象类，保证 Filter 在一次请求中只执行一次。为什么需要它？因为 Servlet 容器在请求转发（forward）时会再次调用 Filter，导致同一个 Filter 对同一个请求执行多次。

```java
public class RequestIdFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String requestId = UUID.randomUUID().toString().substring(0, 8);
        request.setAttribute("requestId", requestId);
        response.setHeader("X-Request-Id", requestId);
        filterChain.doFilter(request, response);  // 继续 Filter 链
    }
}
```

**Filter 中必须调用 `filterChain.doFilter()`**，否则请求不会继续传递，客户端会收到超时。这是新手最常犯的错误。

## 4. 拦截器实战

### 4.1 鉴权拦截器

```java
@Component
public class AuthInterceptor implements HandlerInterceptor {

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
            Object handler) throws Exception {
        // 放行 OPTIONS 请求（CORS 预检）
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }

        String token = request.getHeader("Authorization");
        if (token == null || !token.startsWith("Bearer ")) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write("{\"code\":401,\"message\":\"未认证\"}");
            return false;
        }

        try {
            Authentication auth = jwtTokenProvider.validate(token.substring(7));
            SecurityContextHolder.getContext().setAuthentication(auth);
            return true;
        } catch (JwtException e) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write("{\"code\":401,\"message\":\"Token 无效\"}");
            return false;
        }
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
            Object handler, Exception ex) {
        // 请求结束后清理 SecurityContext，防止线程复用导致上下文泄漏
        SecurityContextHolder.clearContext();
    }
}
```

### 4.2 接口限流拦截器

```java
@Component
public class RateLimitInterceptor implements HandlerInterceptor {

    private final RateLimiter rateLimiter = RateLimiter.create(100); // 100 QPS

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
            Object handler) throws Exception {
        if (!rateLimiter.tryAcquire(50, TimeUnit.MILLISECONDS)) {
            response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
            response.setContentType("application/json");
            response.getWriter().write("{\"code\":429,\"message\":\"请求过于频繁\"}");
            return false;
        }
        return true;
    }
}
```

### 4.3 注册与排序

```java
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    @Autowired
    private LoggingInterceptor loggingInterceptor;
    @Autowired
    private RateLimitInterceptor rateLimitInterceptor;
    @Autowired
    private AuthInterceptor authInterceptor;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // 1. 耗时统计（最先执行，记录完整耗时）
        registry.addInterceptor(loggingInterceptor)
            .addPathPatterns("/api/**")
            .order(0);

        // 2. 限流（在鉴权之前，未认证请求也要限流）
        registry.addInterceptor(rateLimitInterceptor)
            .addPathPatterns("/api/**")
            .excludePathPatterns("/api/health")
            .order(1);

        // 3. 鉴权（最后执行，限流通过后才验证身份）
        registry.addInterceptor(authInterceptor)
            .addPathPatterns("/api/**")
            .excludePathPatterns("/api/auth/**", "/api/health")
            .order(2);
    }
}
```

## 5. Filter 实战：MDC 链路追踪

MDC（Mapped Diagnostic Context）是 SLF4J 的线程级上下文，日志框架会自动输出 MDC 中的值。用 Filter 注入 `traceId`，日志里自动带上，排查问题时可以按 traceId 搜集完整链路。

```java
public class MdcFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String traceId = request.getHeader("X-Trace-Id");
        if (traceId == null) {
            traceId = UUID.randomUUID().toString().substring(0, 8);
        }
        MDC.put("traceId", traceId);
        response.setHeader("X-Trace-Id", traceId);

        try {
            filterChain.doFilter(request);
        } finally {
            MDC.remove("traceId");  // 必须清理，线程池复用时会污染
        }
    }
}
```

logback 配置中加入 `%X{traceId}`：

```xml
<pattern>%d{HH:mm:ss.SSS} [%thread] [%X{traceId}] %-5level %logger{36} - %msg%n</pattern>
```

效果：

```text
22:00:01.234 [http-nio-8080-exec-1] [a3f8b2c1] INFO  c.e.UserService - 查询用户 id=1
22:00:01.235 [http-nio-8080-exec-1] [a3f8b2c1] INFO  c.e.OrderService - 查询订单 userId=1
```

两个日志行共享同一个 `traceId`，一条 grep 就能捞出完整请求链路。

## 6. Filter vs Interceptor 决策指南

| 场景 | 用 Filter | 用 Interceptor | 原因 |
|------|-----------|----------------|------|
| 字符编码 | ✅ | | Servlet 层设置，越早越好 |
| CORS | ✅ | | 预检请求（OPTIONS）不经过 Interceptor |
| MDC / traceId | ✅ | | 需要在所有请求（含静态资源）生效 |
| 鉴权 | | ✅ | 需要 Handler 信息判断是否需要认证 |
| 接口限流 | | ✅ | 需要根据 Controller 方法做细粒度限流 |
| 请求日志 | | ✅ | 需要 Controller 方法名 |
| GZIP 压缩 | ✅ | | Servlet 容器层面的响应压缩 |
| 参数校验 | | ✅ | 需要访问方法参数注解 |

**判断标准**：需要 Handler 信息（Controller 类名、方法名、方法注解）→ Interceptor。不需要 Handler 信息，或者需要在 DispatcherServlet 之前执行 → Filter。

## 7. 常见错误

### ❌ 在 Filter 中做鉴权但拿不到 Handler 信息

```java
// ❌ Filter 中无法判断当前请求对应哪个 Controller 方法
// 无法读取 @PreAuthorize 等方法级注解
public class AuthFilter extends OncePerRequestFilter {
    protected void doFilterInternal(...) {
        // 只能做粗粒度的路径匹配，无法做方法级鉴权
    }
}
```

```java
// ✅ Interceptor 中可以拿到 Handler 信息
public class AuthInterceptor implements HandlerInterceptor {
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
            Object handler) {
        HandlerMethod handlerMethod = (HandlerMethod) handler;
        // 可以读取方法上的注解
        if (handlerMethod.hasMethodAnnotation(PreAuthorize.class)) {
            // 做方法级鉴权
        }
    }
}
```

### ❌ Filter 中抛异常不会被 @ExceptionHandler 捕获

```java
// ❌ Filter 中抛异常，@ExceptionHandler 不会处理
public class BadFilter extends OncePerRequestFilter {
    protected void doFilterInternal(...) {
        throw new RuntimeException("出错了");  // 直接返回 500，不会被 GlobalExceptionHandler 捕获
    }
}

// ✅ 在 Filter 中手动处理异常
public class GoodFilter extends OncePerRequestFilter {
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain chain) {
        try {
            chain.doFilter(request);
        } catch (Exception ex) {
            response.setStatus(500);
            response.setContentType("application/json");
            response.getWriter().write("{\"code\":500,\"message\":\"" + ex.getMessage() + "\"}");
        }
    }
}
```

### ❌ 拦截器 order 顺序错误导致日志缺用户信息

```java
// ❌ 鉴权在日志之前执行
registry.addInterceptor(authInterceptor).order(0);     // 先鉴权
registry.addInterceptor(loggingInterceptor).order(1);   // 后日志
// 问题：鉴权失败的请求，日志里没有用户信息

// ✅ 日志在鉴权之前执行
registry.addInterceptor(loggingInterceptor).order(0);   // 先日志（记录完整请求）
registry.addInterceptor(authInterceptor).order(1);      // 后鉴权
```

## 8. 异步请求的差异

Filter 和 Interceptor 在异步场景下行为不同：

| 场景 | Filter | Interceptor |
|------|--------|-------------|
| `@Async` 返回 `Callable` | `doFilter` 立即返回，异步线程重新执行 Filter | `preHandle` 执行一次，`afterCompletion` 在异步完成后执行 |
| `DeferredResult` / `SseEmitter` | 同上 | 同上 |
| `StreamingResponseBody` | 同上 | 同上 |

如果需要在异步请求中也注入 MDC，需要用 `RequestContextHolder.getRequestAttributes()` 配合异步线程传递上下文。

> 通用工程中的认证鉴权方案参见 [安全架构](/spring/05-security/chapter-01-security-architecture)。文件上传的 `MultipartFile` 处理参见 [文件上传与下载](/spring/02-web/chapter-08-file-upload-download)。
