# Spring MVC

> 你在 Controller 写了个 `@GetMapping("/user")`，浏览器就拿到了 JSON。中间发生了什么？从 Tomcat 接收 TCP 连接，到 Filter 链、DispatcherServlet、HandlerMapping、参数解析、返回值处理、异常兜底——20 多个组件参与了这场接力。本章追踪一个请求从浏览器到 Java 方法再回到浏览器的完整旅程。

## 1. 从 Servlet 到 Spring MVC

### 1.1 Servlet 规范：Java Web 的基石

Java Web 开发的历史起点是 Servlet 规范。一个 HTTP 请求到达服务器的路径：

```txt
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

![spring-front-controller](/spring/spring-front-controller.svg)

### 1.3 组织层次：Tomcat 是容器，Spring MVC 挂在 DispatcherServlet 里

前面把 Servlet 规范和前端控制器分开讲，容易让人误以为 Tomcat 和 Spring MVC 是两个平级的框架。实际上它们是**包含关系**，而且 Tomcat 对 Spring 一无所知。

![spring-mvc-architecture](/spring/spring-mvc-architecture.svg)

分三层看：

1. **Tomcat（Servlet 容器）** 只负责两件事：接收网络连接、按 Servlet 规范调用 Servlet 的 `service()`。它不认识 `@Controller`、`HandlerMapping` 这些概念，对它来说，`DispatcherServlet` 就是一个普通的 `HttpServlet`。
2. **DispatcherServlet** 是 Spring MVC 接入 Tomcat 的**唯一一个 Servlet**，也是整个 Spring MVC 在容器里的入口。请求进入 Tomcat 后，最终都落到它的 `service()` 上。
3. **HandlerMapping、HandlerAdapter、ViewResolver、HandlerExceptionResolver** 是 `DispatcherServlet` 持有的**私有组件**。它们不是 Servlet，只是普通的 Java 对象（Bean），Tomcat 完全不知道它们的存在，只有 `DispatcherServlet` 在 `doDispatch()` 里调用它们。

一句话总结层次：**Tomcat 管「网络和 Servlet 生命周期」，DispatcherServlet 管「把请求转交给 Spring MVC」，MVC 组件管「找到、调用、返回」**。Spring 借用的只是 Servlet 规范里「Servlet」这一个口子，把整条 MVC 链路接了进去。

### 1.4 DispatcherServlet 的初始化

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

```txt
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
| :-- | :-- | :-- |
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
| :-- | :-- | :-- |
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

```txt
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

```txt
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
| :-- | :-- | :-- |
| `MappingJackson2HttpMessageConverter` | application/json | Jackson |
| `MappingJackson2XmlHttpMessageConverter` | application/xml | Jackson XML |
| `StringHttpMessageConverter` | text/plain | 直接字符串 |
| `ByteArrayHttpMessageConverter` | application/octet-stream | 字节数组 |
| `FormHttpMessageConverter` | application/x-www-form-urlencoded | 表单编码 |

### 3.5 内容协商机制

当客户端请求不同格式的数据时，Spring MVC 通过内容协商决定使用哪个 `HttpMessageConverter`：

```txt
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

```txt
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

### 4.2 三个核心注解

`@ExceptionHandler`、`@ControllerAdvice`、`@ResponseStatus` 分工如下：

| 注解 | 作用域 | 职责 |
| :-- | :-- | :-- |
| `@ExceptionHandler` | 单个 Controller 或 `@ControllerAdvice` 内 | 声明处理某个异常类型的方法 |
| `@ControllerAdvice` / `@RestControllerAdvice` | 全局 | 把异常处理逻辑抽取到一处，避免每个 Controller 重复 |
| `@ResponseStatus` | 异常类上 | 直接映射 HTTP 状态码 |

统一错误响应体、三种校验异常、执行顺序、Filter 边界、traceId 串联等完整实战，见 [全局异常处理](/spring/03-web/chapter-03-global-exception)。

> 从 Servlet 到 DispatcherServlet，请求处理链路已经清楚了。但配置一个 Spring MVC 项目要写一堆 XML——web.xml、spring-mvc.xml、applicationContext.xml。Spring Boot 把这些全干掉了。下一章看它是怎么做到"开箱即用"的。
>
> 如果你关心的是「怎么设计一个好的 API」而不是「Spring 怎么处理请求」，参见 [API 设计](/engineering/03-architecture/chapter-07-api-design)。
