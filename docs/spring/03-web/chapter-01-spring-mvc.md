# Spring MVC

> 你在 Controller 写了个 `@GetMapping("/user")`，浏览器就拿到了 JSON。中间发生了什么？从 Tomcat 接收 TCP 连接，到 Filter 链、DispatcherServlet、HandlerMapping、参数解析、返回值处理、异常兜底——20 多个组件参与了这场接力。本章追踪一个请求从浏览器到 Java 方法再回到浏览器的完整旅程。

## 1. 从 Servlet 到 Spring MVC

### 1.1 Servlet 规范：Java Web 的基石

Java Web 开发的历史起点是 Servlet 规范。一个 HTTP 请求到达服务器的路径：

```text
浏览器发送 HTTP 请求
        │
        ▼
    Tomcat（Servlet 容器）
        │
        ├── 1. 解析 HTTP 协议（请求行、请求头、请求体）
        ├── 2. 创建 HttpServletRequest / HttpServletResponse 对象
        ├── 3. 查找匹配的 Filter 链
        ├── 4. 调用目标 Servlet 的 service() 方法
        └── 5. 将响应写回客户端
```

最原始的 Servlet 开发：

```java
@WebServlet("/user")
public class UserServlet extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {
        // 手动解析参数
        String idStr = req.getParameter("id");
        Long id = Long.parseLong(idStr);  // 手动类型转换

        // 手动调用业务逻辑
        UserService userService = (UserService) getServletContext().getAttribute("userService");
        User user = userService.findById(id);

        // 手动序列化响应
        resp.setContentType("application/json");
        resp.setCharacterEncoding("UTF-8");
        PrintWriter writer = resp.getWriter();
        writer.write("{\"id\":" + user.getId() + ",\"name\":\"" + user.getName() + "\"}");
    }
}
```

痛点显而易见：参数解析、类型转换、异常处理、响应序列化全部手动完成。

### 1.2 前端控制器模式

Spring MVC 的核心设计思想是**前端控制器（Front Controller）模式**——所有请求统一由一个 Servlet 处理，再分发给具体的处理器：

```text
┌──────────────────────────────────────────────────────────────┐
│                        Tomcat                                │
│  ┌─────────┐   ┌─────────────────────────────────────────┐  │
│  │  Filter  │ → │         DispatcherServlet               │  │
│  │  链      │   │                                         │  │
│  └─────────┘   │  HandlerMapping → 找到处理器             │  │
│                │  HandlerAdapter → 调用处理器              │  │
│                │  ViewResolver   → 解析视图                │  │
│                │  ExceptionResolver → 异常处理             │  │
│                └─────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 1.3 DispatcherServlet 的初始化

```java
// Spring Boot 自动配置
// DispatcherServletAutoConfiguration 注册 DispatcherServlet

@Bean
public DispatcherServlet dispatcherServlet() {
    DispatcherServlet servlet = new DispatcherServlet();
    // 设置配置属性...
    return servlet;
}

@Bean
public ServletRegistrationBean<DispatcherServlet> dispatcherServletRegistration(
        DispatcherServlet dispatcherServlet) {
    ServletRegistrationBean<DispatcherServlet> registration =
        new ServletRegistrationBean<>(dispatcherServlet, "/");  // 拦截所有请求
    registration.setName("dispatcherServlet");
    return registration;
}
```

DispatcherServlet 初始化时会创建自己的 `WebApplicationContext`，它是根 `ApplicationContext` 的子容器：

```text
Root WebApplicationContext
  ├── DataSource Bean
  ├── UserService Bean
  ├── TransactionManager Bean
  └── ...
      │
      ▼
  Servlet WebApplicationContext (DispatcherServlet)
      ├── HandlerMapping beans
      ├── HandlerAdapter beans
      ├── ViewResolver beans
      ├── @Controller beans
      └── ...
```

## 2. DispatcherServlet 核心流程

### 2.1 请求处理的九大步骤

DispatcherServlet 继承自 `FrameworkServlet`，其 `doDispatch()` 方法是整个 Spring MVC 的心脏：

```java
// DispatcherServlet#doDispatch（简化版）
protected void doDispatch(HttpServletRequest request, HttpServletResponse response) {
    HandlerExecutionChain mappedHandler = null;

    // 1. 通过 HandlerMapping 找到对应的 Handler（Controller 方法）
    mappedHandler = getHandler(request);

    // 2. 通过 HandlerAdapter 找到能调用该 Handler 的适配器
    HandlerAdapter ha = getHandlerAdapter(mappedHandler.getHandler());

    // 3. 执行拦截器的 preHandle
    if (!mappedHandler.applyPreHandle(request, response)) {
        return;  // 拦截器拒绝了请求
    }

    // 4. 通过 HandlerAdapter 调用具体的 Controller 方法
    ModelAndView mv = ha.handle(request, response,
                                mappedHandler.getHandler());

    // 5. 执行拦截器的 postHandle
    mappedHandler.applyPostHandle(request, response, mv);

    // 6. 处理结果（渲染视图或写入响应）
    processDispatchResult(request, response, mappedHandler, mv, null);
}
```

### 2.2 流程图解

![spring-mvc-flow](/spring/spring-mvc-flow.svg)

### 2.3 HandlerMapping 的职责

HandlerMapping 负责将 HTTP 请求映射到具体的处理器：

```java
// 常见的 HandlerMapping 实现
// 1. RequestMappingHandlerMapping ← 处理 @RequestMapping 注解
// 2. SimpleUrlHandlerMapping     ← URL 到 Bean 的映射
// 3. BeanNameUrlHandlerMapping    ← Bean 名称作为 URL

// RequestMappingHandlerMapping 内部维护的映射表（简化）
Map<RequestMappingInfo, HandlerMethod> handlerMethods;
// 其中 RequestMappingInfo 包含：
//   - URL 模式（如 /api/users/{id}）
//   - HTTP 方法（GET/POST/PUT/DELETE）
//   - 请求头条件
//   - 请求参数条件
//   - consumes/produces 媒体类型
```

### 2.4 HandlerAdapter 的作用

HandlerAdapter 解决的是**调用方式适配**问题。不同的处理器有不同的调用方式：

| HandlerAdapter | 处理的 Handler 类型 | 调用方式 |
|---------------|-------------------|---------|
| `RequestMappingHandlerAdapter` | `@RequestMapping` 注解的方法 | 反射调用，需参数解析 |
| `HttpRequestHandlerAdapter` | `HttpRequestHandler` 接口 | 直接调用 `handleRequest()` |
| `SimpleControllerHandlerAdapter` | `Controller` 接口 | 直接调用 `handleRequest()` |

这种设计体现了**适配器模式**——DispatcherServlet 不需要知道每种 Handler 的具体调用方式，统一通过 HandlerAdapter 适配。

## 3. 参数解析与返回值处理 {#param-resolution}

### 3.1 参数解析器体系

Spring MVC 通过 `HandlerMethodArgumentResolver` 接口解析 Controller 方法的参数：

```java
public interface HandlerMethodArgumentResolver {

    // 是否支持当前参数
    boolean supportsParameter(MethodParameter parameter);

    // 解析参数值
    Object resolveArgument(MethodParameter parameter,
                           ModelAndViewContainer mavContainer,
                           NativeWebRequest webRequest,
                           WebDataBinderFactory binderFactory) throws Exception;
}
```

Spring 内置了大量参数解析器，覆盖各种注解场景：

| 注解 | 解析器 | 作用 |
|------|--------|------|
| `@RequestParam` | `RequestParamMethodArgumentResolver` | 解析查询参数 / 表单数据 |
| `@PathVariable` | `PathVariableMethodArgumentResolver` | 解析 URL 路径变量 |
| `@RequestBody` | `RequestResponseBodyMethodProcessor` | 读取请求体并反序列化 |
| `@RequestHeader` | `RequestHeaderMethodArgumentResolver` | 解析请求头 |
| `@CookieValue` | `CookieValueMethodArgumentResolver` | 解析 Cookie |
| `HttpServletRequest` | `ServletRequestMethodArgumentResolver` | 直接注入原生请求对象 |
| `@ModelAttribute` | `ModelAttributeMethodProcessor` | 表单对象绑定 |

### 3.2 @RequestParam 的工作原理

```java
@GetMapping("/search")
public List<Product> search(
        @RequestParam String keyword,
        @RequestParam(defaultValue = "1") int page,
        @RequestParam(required = false) String category) {
    return productService.search(keyword, page, category);
}
```

处理流程：

```text
GET /search?keyword=phone&page=2
     │
     ▼
RequestParamMethodArgumentResolver
     │
     ├── 1. 从 request.getParameter("keyword") 获取 "phone"
     ├── 2. 类型转换：String → String（无需转换）
     ├── 3. 绑定到方法参数 keyword
     │
     ├── 1. 从 request.getParameter("page") 获取 "2"
     ├── 2. 类型转换：String → int（通过 ConversionService）
     ├── 3. 绑定到方法参数 page
     │
     └── 1. request.getParameter("category") 返回 null
         2. 因为 required=false，使用 null 作为默认值
```

### 3.3 @RequestBody 的工作原理

```java
@PostMapping("/users")
public User createUser(@Valid @RequestBody UserDTO userDTO) {
    return userService.create(userDTO);
}
```

处理流程：

```text
POST /users
Content-Type: application/json
Body: {"name":"张三","email":"zhangsan@example.com"}
     │
     ▼
RequestResponseBodyMethodProcessor
     │
     ├── 1. 获取 Content-Type: application/json
     ├── 2. 查找匹配的 HttpMessageConverter
     │      → MappingJackson2HttpMessageConverter（Jackson 库）
     ├── 3. 读取 InputStream，反序列化为 UserDTO 对象
     ├── 4. 执行 @Valid 参数校验
     │      → 通过 ValidationInterceptor 触发 JSR-303 校验
     └── 5. 绑定到方法参数
```

### 3.4 返回值处理与 HttpMessageConverter

Controller 方法的返回值由 `HandlerMethodReturnValueHandler` 处理：

```java
// 场景一：返回视图
@GetMapping("/page")
public String page(Model model) {
    model.addAttribute("title", "首页");
    return "index";  // → ViewResolver 解析为 /WEB-INF/index.jsp 或 templates/index.html
}

// 场景二：返回 JSON（@ResponseBody）
@GetMapping("/api/user/{id}")
@ResponseBody
public User getUser(@PathVariable Long id) {
    return userService.findById(id);
    // → HttpMessageConverter 将 User 序列化为 JSON 写入响应
}

// 场景三：返回 ResponseEntity（更灵活）
@GetMapping("/api/user/{id}")
public ResponseEntity<User> getUser(@PathVariable Long id) {
    User user = userService.findById(id);
    if (user == null) {
        return ResponseEntity.notFound().build();  // 404
    }
    return ResponseEntity.ok(user);  // 200 + JSON
}
```

HttpMessageConverter 的常见实现：

| Converter | 支持的媒体类型 | 序列化库 |
|-----------|---------------|---------|
| `MappingJackson2HttpMessageConverter` | application/json | Jackson |
| `MappingJackson2XmlHttpMessageConverter` | application/xml | Jackson XML |
| `StringHttpMessageConverter` | text/plain | 直接字符串 |
| `ByteArrayHttpMessageConverter` | application/octet-stream | 字节数组 |
| `FormHttpMessageConverter` | application/x-www-form-urlencoded | 表单编码 |

### 3.5 内容协商机制

当客户端请求不同格式的数据时，Spring MVC 通过内容协商决定使用哪个 `HttpMessageConverter`：

```text
客户端请求：
  Accept: application/json  →  使用 Jackson 序列化为 JSON
  Accept: application/xml   →  使用 Jackson XML 序列化为 XML

配置方式：
spring.mvc.contentnegotiation.favor-parameter=true
spring.mvc.contentnegotiation.parameter-name=format

请求示例：
  GET /api/user/1?format=json  → JSON 响应
  GET /api/user/1?format=xml   → XML 响应
```

## 4. 异常处理

### 4.1 Spring MVC 的异常处理体系

Spring MVC 提供了多层级的异常处理机制：

```text
Controller 方法抛出异常
        │
        ▼
HandlerExceptionResolver 链（按 order 排序）
        │
        ├── 1. ExceptionHandlerExceptionResolver
        │      → 查找 @ExceptionHandler 方法
        │      → 查找 @ControllerAdvice 中的 @ExceptionHandler
        │
        ├── 2. ResponseStatusExceptionResolver
        │      → 处理 @ResponseStatus 注解的异常
        │
        ├── 3. DefaultHandlerExceptionResolver
        │      → 处理 Spring MVC 内置异常
        │        (MissingServletRequestParameterException → 400)
        │        (HttpRequestMethodNotSupportedException → 405)
        │        (HttpMediaTypeNotSupportedException → 415)
        │
        └── 4. 兜底处理 → 500 Internal Server Error
```

### 4.2 @ExceptionHandler

在 Controller 内部定义异常处理方法：

```java
@RestController
@RequestMapping("/api/users")
public class UserController {

    @GetMapping("/{id}")
    public User getUser(@PathVariable Long id) {
        return userService.findById(id)
            .orElseThrow(() -> new UserNotFoundException(id));
    }

    // 处理本 Controller 内的 UserNotFoundException
    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(UserNotFoundException ex) {
        ErrorResponse error = new ErrorResponse(
            "USER_NOT_FOUND",
            "用户不存在: " + ex.getUserId(),
            LocalDateTime.now()
        );
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(error);
    }

    // 处理参数校验异常
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(MethodArgumentNotValidException ex) {
        List<String> errors = ex.getBindingResult().getFieldErrors().stream()
            .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
            .collect(Collectors.toList());
        return ResponseEntity.badRequest()
            .body(new ErrorResponse("VALIDATION_ERROR", String.join("; ", errors)));
    }
}
```

### 4.3 @ControllerAdvice

`@ControllerAdvice` 将异常处理逻辑抽取到全局，避免每个 Controller 重复编写：

```java
@ControllerAdvice
public class GlobalExceptionHandler {

    // 全局异常处理
    @ExceptionHandler(Exception.class)
    @ResponseBody
    public ResponseEntity<ErrorResponse> handleException(Exception ex) {
        log.error("未处理的异常", ex);
        ErrorResponse error = new ErrorResponse(
            "INTERNAL_ERROR",
            "服务器内部错误",
            LocalDateTime.now()
        );
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
    }

    // 业务异常处理
    @ExceptionHandler(BusinessException.class)
    @ResponseBody
    public ResponseEntity<ErrorResponse> handleBusiness(BusinessException ex) {
        ErrorResponse error = new ErrorResponse(
            ex.getCode(),
            ex.getMessage(),
            LocalDateTime.now()
        );
        return ResponseEntity.status(ex.getHttpStatus()).body(error);
    }

    // 自定义参数校验响应
    @ExceptionHandler(ConstraintViolationException.class)
    @ResponseBody
    public ResponseEntity<ErrorResponse> handleConstraint(ConstraintViolationException ex) {
        String message = ex.getConstraintViolations().stream()
            .map(v -> v.getPropertyPath() + ": " + v.getMessage())
            .collect(Collectors.joining("; "));
        return ResponseEntity.badRequest()
            .body(new ErrorResponse("CONSTRAINT_VIOLATION", message));
    }
}
```

### 4.4 @ResponseStatus

对于简单的异常场景，可以用 `@ResponseStatus` 直接指定 HTTP 状态码：

```java
// 当这个异常被抛出时，响应状态码为 404
@ResponseStatus(code = HttpStatus.NOT_FOUND, reason = "资源不存在")
public class ResourceNotFoundException extends RuntimeException {
    public ResourceNotFoundException(String message) {
        super(message);
    }
}
```

### 4.5 统一错误响应的最佳实践

在企业项目中，建议定义统一的错误响应结构：

```java
// 统一错误响应
public class ErrorResponse {
    private String code;          // 业务错误码
    private String message;       // 错误描述
    private LocalDateTime timestamp;
    private String path;          // 请求路径
    private List<FieldError> details;  // 字段级错误（校验场景）

    @Data
    public static class FieldError {
        private String field;
        private String message;
        private Object rejectedValue;
    }
}

// 全局异常处理（统一风格）
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(
            ResourceNotFoundException ex, HttpServletRequest request) {
        ErrorResponse error = ErrorResponse.builder()
            .code("NOT_FOUND")
            .message(ex.getMessage())
            .path(request.getRequestURI())
            .timestamp(LocalDateTime.now())
            .build();
        return ResponseEntity.status(404).body(error);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(
            MethodArgumentNotValidException ex, HttpServletRequest request) {
        List<ErrorResponse.FieldError> fieldErrors = ex.getBindingResult()
            .getFieldErrors().stream()
            .map(fe -> new ErrorResponse.FieldError(
                fe.getField(), fe.getDefaultMessage(), fe.getRejectedValue()))
            .collect(Collectors.toList());

        ErrorResponse error = ErrorResponse.builder()
            .code("VALIDATION_ERROR")
            .message("参数校验失败")
            .path(request.getRequestURI())
            .timestamp(LocalDateTime.now())
            .details(fieldErrors)
            .build();
        return ResponseEntity.badRequest().body(error);
    }
}
```

### 4.6 异常处理的执行顺序

当异常发生时，Spring MVC 按以下顺序查找处理器：

```text
1. Controller 内的 @ExceptionHandler
   ↓ 未找到
2. @ControllerAdvice 中的 @ExceptionHandler
   ↓ 未找到
3. @ResponseStatus 注解（直接映射状态码）
   ↓ 未找到
4. DefaultHandlerExceptionResolver（Spring 内置异常映射）
   ↓ 未找到
5. 容器默认错误页（Tomcat 的 /error）
```

**注意：** Controller 内的 `@ExceptionHandler` 优先级高于 `@ControllerAdvice`。如果需要覆盖某个 Controller 的异常处理，可以在该 Controller 内定义同类型的 `@ExceptionHandler`。

### 4.7 异常处理与 Filter 的边界

Spring MVC 的异常处理机制只在 DispatcherServlet 内部生效。对于 Filter 中抛出的异常，需要通过 Servlet 容器的错误页面机制处理：

```text
请求进入
  │
  ▼
Filter 链  ← 异常不会被 @ExceptionHandler 捕获
  │
  ▼
DispatcherServlet
  │
  ├── HandlerMapping
  ├── HandlerAdapter
  │     └── Controller 方法抛出异常
  │           └── ✅ @ExceptionHandler 捕获
  └── ...
```

对于 Filter 中的异常，可以使用 Spring Boot 的 `ErrorController` 或自定义 Filter 来处理：

```java
@Component
public class ExceptionHandlerFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        try {
            chain.doFilter(request, response);
        } catch (Exception ex) {
            // 在 Filter 层捕获异常，返回统一错误响应
            response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            response.setContentType("application/json");
            response.getWriter().write("{\"code\":\"FILTER_ERROR\",\"message\":\"" +
                ex.getMessage() + "\"}");
        }
    }
}
```

> 从 Servlet 到 DispatcherServlet，请求处理链路已经清楚了。但配置一个 Spring MVC 项目要写一堆 XML——web.xml、spring-mvc.xml、applicationContext.xml。Spring Boot 把这些全干掉了。下一章看它是怎么做到"开箱即用"的。
>
> 如果你关心的是「怎么设计一个好的 API」而不是「Spring 怎么处理请求」，参见 [API 设计](/engineering/09-practice/chapter-03-api-design)。
