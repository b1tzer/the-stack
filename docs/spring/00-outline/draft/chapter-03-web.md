# 第 03 章：Web 开发全链路

## 3.1 Spring MVC 核心

### 3.1.1 从 Servlet 到 DispatcherServlet

**痛点**：你写了一个 `@RestController`，浏览器就能访问了——但 HTTP 请求到底是怎么一步步到达你的方法的？

#### 请求链路全景

```
浏览器请求
  → Tomcat (Connector 接收 TCP 连接)
    → Filter 链 (CharacterEncodingFilter, SecurityFilter ...)
      → DispatcherServlet (前端控制器)
        → HandlerMapping (找到哪个 Controller 方法)
          → HandlerAdapter (适配执行方式)
            → Controller 业务逻辑
          → 返回 ModelAndView / 直接写 Response
        → ViewResolver (视图解析，REST 场景可跳过)
      → Response 写回客户端
```

#### Servlet 规范回顾

Spring MVC 建立在 Servlet 规范之上。每个 Web 应用至少有一个 `Servlet` 处理请求。传统方式需要在 `web.xml` 中配置：

```xml
<!-- web.xml 传统方式 -->
<servlet>
    <servlet-name>dispatcher</servlet-name>
    <servlet-class>org.springframework.web.servlet.DispatcherServlet</servlet-class>
    <init-param>
        <param-name>contextConfigLocation</param-name>
        <param-value>/WEB-INF/spring-mvc.xml</param-value>
    </init-param>
    <load-on-startup>1</load-on-startup>
</servlet>
<servlet-mapping>
    <servlet-name>dispatcher</servlet-name>
    <url-pattern>/</url-pattern>
</servlet-mapping>
```

Spring Boot 通过 `DispatcherServletAutoConfiguration` 自动完成上述配置，将 `DispatcherServlet` 注册到 Servlet 容器。

#### 前端控制器模式

`DispatcherServlet` 是经典的**前端控制器（Front Controller）**模式实现：所有请求统一入口，由它分发给具体处理器。这带来三个好处：

| 优点 | 说明 |
|------|------|
| 集中管控 | 横切关注点（异常处理、国际化、主题）统一处理 |
| 解耦 | 请求路由与业务逻辑分离，Controller 不感知 Servlet API |
| 可扩展 | HandlerMapping / HandlerAdapter 可替换 |

> **踩坑提醒**：`/` 和 `/*` 的区别——`/` 覆盖默认 Servlet 但放行 `.jsp`，`/*` 拦截一切包括 `.jsp`。Spring Boot 使用 `/`，静态资源由 `DefaultServlet` 处理。

---

### 3.1.2 DispatcherServlet.doDispatch 源码

**痛点**：面试官问「DispatcherServlet 处理请求的核心流程是什么？」你只会说「找到 Controller 执行」？

`doDispatch` 是 DispatcherServlet 的心脏方法，核心四步：

```java
// 简化版 doDispatch 源码（Spring Framework 6.x）
protected void doDispatch(HttpServletRequest request, HttpServletResponse response) {
    HttpServletRequest processedRequest = request;
    HandlerExecutionChain mappedHandler = null;

    try {
        ModelAndView mv = null;
        Exception dispatchException = null;

        try {
            // ① 找到 Handler（Controller 方法）+ 拦截器链
            mappedHandler = getHandler(processedRequest);
            if (mappedHandler == null) {
                noHandlerFound(processedRequest, response);
                return;
            }

            // ② 找到对应的 HandlerAdapter（适配执行方式）
            HandlerAdapter ha = getHandlerAdapter(mappedHandler.getHandler());

            // ③ 执行拦截器 preHandle → 执行 Handler → 执行拦截器 postHandle
            if (!mappedHandler.applyPreHandle(processedRequest, response)) {
                return;  // preHandle 返回 false，中断
            }
            mv = ha.handle(processedRequest, response,
                           mappedHandler.getHandler());
            mappedHandler.applyPostHandle(processedRequest, response, mv);

            // ④ 处理结果（视图渲染 / 异常处理 / 写入 Response）
            processDispatchResult(processedRequest, response,
                                  mappedHandler, mv, dispatchException);
        }
        catch (Exception ex) {
            dispatchException = ex;
            triggerAfterCompletion(processedRequest, response,
                                   mappedHandler, ex);
        }
    }
}
```

**四步总结**：

| 步骤 | 方法 | 职责 |
|------|------|------|
| ① | `getHandler()` | 遍历所有 HandlerMapping，根据 URL 找到 HandlerExecutionChain |
| ② | `getHandlerAdapter()` | 根据 Handler 类型选择适配器（如 RequestMappingHandlerAdapter） |
| ③ | `ha.handle()` | 参数解析 → 调用方法 → 返回值处理 |
| ④ | `processDispatchResult()` | 视图渲染或直接写 Response，处理异常 |

> **踩坑提醒**：拦截器的 `afterCompletion` **总是**执行（即使 `preHandle` 返回 false 后面的不执行），但只有已经通过 `preHandle` 的拦截器才会收到 `afterCompletion` 回调。

---

### 3.1.3 HandlerMapping 与 HandlerAdapter

**痛点**：`@RequestMapping` 到底是怎么把 URL 映射到方法的？为什么需要 HandlerMapping 和 HandlerAdapter 两个角色？

#### 为什么需要「配对」

`DispatcherServlet` 不直接调用 Controller，而是通过两个组件协作：

- **HandlerMapping**：负责「找」——根据请求信息定位到具体的 Handler
- **HandlerAdapter**：负责「调」——以统一接口执行不同类型的 Handler

```
HandlerMapping 产出:  HandlerExecutionChain
                       ├── handler (Object) → 可能是 Method / Controller / HttpRequestHandler
                       └── interceptors[]

HandlerAdapter 输入:  handler (Object)
HandlerAdapter 产出:  ModelAndView
```

#### @RequestMapping 注册机制

Spring MVC 启动时，`RequestMappingHandlerMapping` 实现了 `InitializingBean`：

```java
// 启动时扫描所有 @Controller 中的 @RequestMapping 方法
@Override
public void afterPropertiesSet() {
    this.config = new RequestMappingInfo.BuilderConfiguration();
    this.config.setPathHelper(getUrlPathHelper());
    this.config.setPathMatcher(getPathMatcher());
    this.config.setSuffixPatternMatch(this.useSuffixPatternMatch);
    // 扫描所有 bean，找到 @RequestMapping 注解的方法
    detectHandlerMethods();
}
```

每个 `@RequestMapping` 方法被封装为 `HandlerMethod` 对象，注册到 `MappingRegistry` 中。请求到来时通过 URL、HTTP Method、Header 等条件匹配。

#### 三种 HandlerAdapter

| HandlerAdapter | 处理的 Handler 类型 | 场景 |
|----------------|---------------------|------|
| `RequestMappingHandlerAdapter` | `HandlerMethod`（@RequestMapping） | 注解控制器，最常用 |
| `HttpRequestHandlerAdapter` | `HttpRequestHandler` | 静态资源处理 |
| `SimpleControllerHandlerAdapter` | `Controller` 接口 | 老式 Controller 接口实现 |

> **踩坑提醒**：自定义 HandlerMapping 的 `order` 属性很关键。`RequestMappingHandlerMapping` 默认 order 为 0，如果你的自定义 Mapping order 也是 0，可能导致冲突。用 `@Order` 或 `setOrder()` 设置优先级。

---

## 3.2 参数解析与返回值处理

### 3.2.1 HandlerMethodArgumentResolver

**痛点**：`@RequestParam`、`@PathVariable`、`@RequestBody` 这些注解背后的解析逻辑是什么？需要自定义参数解析时怎么做？

#### 内置 Resolver 一览

Spring MVC 内置了 30+ 个 `HandlerMethodArgumentResolver` 实现，核心对应关系：

| 注解 | Resolver 实现 | 解析逻辑 |
|------|---------------|----------|
| `@RequestParam` | `RequestParamMethodArgumentResolver` | 从 query string 或 form data 取值 |
| `@PathVariable` | `PathVariableMethodArgumentResolver` | 从 URL 模板变量取值 |
| `@RequestBody` | `RequestResponseBodyMethodProcessor` | 用 HttpMessageConverter 反序列化请求体 |
| `@ModelAttribute` | `ModelAttributeMethodProcessor` | 从请求参数绑定到对象（表单提交） |
| `@RequestHeader` | `RequestHeaderMethodArgumentResolver` | 从请求头取值 |
| `@CookieValue` | `ServletCookieValueMethodArgumentResolver` | 从 Cookie 取值 |
| 无注解 POJO | `ModelAttributeMethodProcessor` | 自动当作 @ModelAttribute 处理 |

#### 执行流程

```java
// HandlerMethodArgumentResolverComposite 中
public Object resolveArgument(MethodParameter parameter, ...) {
    // 遍历所有 resolver，找到 supportsParameter 返回 true 的那个
    HandlerMethodArgumentResolver resolver = getArgumentResolver(parameter);
    if (resolver == null) {
        throw new IllegalArgumentException("No resolver for " + parameter);
    }
    return resolver.resolveArgument(parameter, mavContainer, webRequest, binderFactory);
}
```

#### 自定义 ArgumentResolver

场景：从 JWT Token 中自动注入当前用户。

```java
// 1. 自定义注解
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
public @interface CurrentUser {}

// 2. 实现 HandlerMethodArgumentResolver
public class CurrentUserArgumentResolver implements HandlerMethodArgumentResolver {

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(CurrentUser.class)
               && parameter.getParameterType().equals(User.class);
    }

    @Override
    public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer,
                                  NativeWebRequest webRequest, WebDataBinderFactory binderFactory) {
        HttpServletRequest request = webRequest.getNativeRequest(HttpServletRequest.class);
        String token = request.getHeader("Authorization").replace("Bearer ", "");
        // 解析 JWT 获取用户信息（示意）
        return JwtUtils.parseUser(token);
    }
}

// 3. 注册
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new CurrentUserArgumentResolver());
    }
}

// 4. 使用
@GetMapping("/profile")
public User profile(@CurrentUser User user) {
    return user;  // 自动从 JWT 中解析
}
```

> **踩坑提醒**：自定义 Resolver 的注册顺序很重要。Spring Boot 的默认 Resolver 已经处理了 `@RequestParam` 等，如果你的 Resolver 排在前面且 `supportsParameter` 误匹配，会导致参数解析错误。通常追加到列表末尾即可。

---

### 3.2.2 返回值处理与 HttpMessageConverter

**痛点**：加了 `@ResponseBody` 就能返回 JSON？背后的 `HttpMessageConverter` 是怎么把对象变成 JSON 字节流的？

#### 处理链路

```
Controller 方法返回 Java 对象
  → HandlerMethodReturnValueHandler（@ResponseBody → RequestResponseBodyMethodProcessor）
    → 遍历 HttpMessageConverter 列表
      → 找到 canWrite(mediaType) 为 true 的 Converter
        → write(object, mediaType, outputMessage)
          → Jackson 的 ObjectMapper 序列化为 JSON
            → 写入 Response Body
```

#### 常用 HttpMessageConverter

| Converter | 支持类型 | Content-Type |
|-----------|---------|--------------|
| `MappingJackson2HttpMessageConverter` | JSON | `application/json` |
| `MappingJackson2XmlHttpMessageConverter` | XML | `application/xml` |
| `StringHttpMessageConverter` | String | `text/plain` |
| `ByteArrayHttpMessageConverter` | byte[] | `application/octet-stream` |
| `FormHttpMessageConverter` | MultiValueMap | `application/x-www-form-urlencoded` |

#### 自定义 ObjectMapper

```java
@Configuration
public class JacksonConfig {

    @Bean
    public ObjectMapper objectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        // 日期格式
        mapper.setDateFormat(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss"));
        // 忽略未知属性
        mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        // null 值处理
        mapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);
        // 注册 Java 8 时间模块
        mapper.registerModule(new JavaTimeModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        return mapper;
    }
}
```

> **踩坑提醒**：直接 `new ObjectMapper()` 创建的实例不会自动注册 `JavaTimeModule`，导致 `LocalDateTime` 序列化报错。务必注册 `jackson-datatype-jsr310` 模块。另外 `@JsonFormat` 优先级高于全局 `DateFormat`。

---

### 3.2.3 内容协商

**痛点**：同一个接口，客户端用 `Accept: application/xml` 请求就想要 XML，怎么做？

#### 原理

Spring MVC 通过 `ContentNegotiationStrategy` 决定客户端想要什么格式：

```java
@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void configureContentNegotiation(ContentNegotiationConfigurer configurer) {
        configurer
            // 1. 默认 JSON
            .defaultContentType(MediaType.APPLICATION_JSON)
            // 2. 根据 Accept 头
            .favorParameter(true)           // 3. 支持 ?format=xml
            .parameterName("format")
            .mediaType("json", MediaType.APPLICATION_JSON)
            .mediaType("xml", MediaType.APPLICATION_XML);
    }
}
```

#### 三种协商策略对比

| 策略 | 触发方式 | 优先级 | 配置 |
|------|----------|--------|------|
| Accept Header | `Accept: application/xml` | 最高（默认） | 默认启用 |
| URL 后缀 | `/api/users.xml` | 中 | `favorPathExtension(true)`（已废弃） |
| 请求参数 | `?format=xml` | 低 | `favorParameter(true)` |

需要引入 XML 支持依赖：

```xml
<dependency>
    <groupId>com.fasterxml.jackson.dataformat</groupId>
    <artifactId>jackson-dataformat-xml</artifactId>
</dependency>
```

> **踩坑提醒**：Spring 5.2.4+ 默认禁用了路径后缀匹配（`favorPathExtension` 默认为 false），这是安全考虑（防止路径遍历攻击）。如果你依赖 `.json` 后缀，需要显式开启。推荐使用 Accept Header 或请求参数方式。

---

## 3.3 参数校验（Bean Validation）

### 3.3.1 声明式校验

**痛点**：每个 Controller 方法都要写 `if (name == null || name.isEmpty())` 这种校验代码？用 Bean Validation 一行注解搞定。

#### 基本用法

```java
public class UserDTO {
    @NotBlank(message = "用户名不能为空")
    @Size(min = 2, max = 20, message = "用户名长度 2-20")
    private String username;

    @NotBlank(message = "邮箱不能为空")
    @Email(message = "邮箱格式不正确")
    private String email;

    @Pattern(regexp = "^1[3-9]\\d{9}$", message = "手机号格式不正确")
    private String phone;

    @Min(value = 0, message = "年龄不能小于 0")
    @Max(value = 150, message = "年龄不能大于 150")
    private Integer age;

    // getters & setters
}

// Controller 中使用
@PostMapping("/users")
public Result createUser(@Valid @RequestBody UserDTO dto) {
    // 校验通过才到这里
    return Result.ok(userService.create(dto));
}
```

#### 常用校验注解

| 注解 | 用途 | 示例 |
|------|------|------|
| `@NotNull` | 非 null | `@NotNull Integer id` |
| `@NotBlank` | 非空字符串（去空白后） | `@NotBlank String name` |
| `@NotEmpty` | 集合/字符串非空 | `@NotEmpty List<String> tags` |
| `@Email` | 邮箱格式 | `@Email String email` |
| `@Size` | 长度/大小范围 | `@Size(min=1, max=100) String title` |
| `@Min/@Max` | 数值范围 | `@Min(0) @Max(150) Integer age` |
| `@Pattern` | 正则匹配 | `@Pattern(regexp="^\\d{6}$") String code` |
| `@Past/@Future` | 日期必须过去/未来 | `@Past LocalDate birthday` |

#### @Valid vs @Validated

| 特性 | `@Valid` (javax/jakarta) | `@Validated` (Spring) |
|------|--------------------------|------------------------|
| 来源 | Bean Validation (JSR 380) | Spring Framework |
| 分组校验 | ❌ 不支持 | ✅ `@Validated(Group.class)` |
| 嵌套校验 | ✅ `@Valid` 放在集合字段上 | ❌ 不触发嵌套 |
| 使用位置 | 方法参数、字段 | 方法参数、类级别 |

```java
// @Validated 支持分组
@PostMapping("/admin/users")
public Result createAdmin(@Validated(AdminGroup.class) @RequestBody UserDTO dto) { ... }

// @Valid 支持嵌套
public class OrderDTO {
    @Valid  // 触发嵌套校验
    @NotNull
    private UserDTO user;
}
```

> **踩坑提醒**：`@Valid` 不加的话，Spring 不会触发校验！这是最常见的遗漏。另外，校验失败默认抛出 `MethodArgumentNotValidException`，不加全局异常处理会返回 400 空白页。

---

### 3.3.2 分组校验与嵌套校验

**痛点**：新增用户时 `id` 不能填，更新时 `id` 必填——同一个 DTO 怎么用不同规则？

#### 分组校验

```java
// 1. 定义分组标记接口
public interface CreateGroup {}
public interface UpdateGroup {}

// 2. 在校验注解上指定分组
public class UserDTO {
    @Null(message = "新增时不能指定 ID", groups = CreateGroup.class)
    @NotNull(message = "更新时必须指定 ID", groups = UpdateGroup.class)
    private Long id;

    @NotBlank(message = "用户名不能为空", groups = {CreateGroup.class, UpdateGroup.class})
    private String username;
}

// 3. Controller 中指定分组
@PostMapping("/users")
public Result create(@Validated(CreateGroup.class) @RequestBody UserDTO dto) { ... }

@PutMapping("/users")
public Result update(@Validated(UpdateGroup.class) @RequestBody UserDTO dto) { ... }
```

#### 嵌套校验

```java
public class OrderDTO {
    @NotNull
    private Long orderId;

    @Valid  // ← 必须加 @Valid 才会递归校验
    @NotNull
    private UserDTO buyer;

    @NotEmpty
    @Valid  // ← 集合内部每个元素都会校验
    private List<OrderItemDTO> items;
}

public class OrderItemDTO {
    @NotBlank
    private String productName;

    @Min(1)
    private Integer quantity;
}
```

> **踩坑提醒**：分组校验注解如果不指定 groups，默认属于 `Default` 分组。如果你用了自定义分组，`Default` 分组的规则**不会**被触发。解决：让自定义分组接口继承 `Default`，或在 `@Validated` 中同时指定 `Default.class`。

---

### 3.3.3 自定义校验注解

**痛点**：内置注解不够用，比如要校验身份证号、车牌号、银行卡号？

#### 从零创建 @IdCard 注解

```java
// 1. 定义注解
@Target({ElementType.FIELD, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = IdCardValidator.class)  // 指定校验器
public @interface IdCard {
    String message() default "身份证号格式不正确";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}

// 2. 实现校验器
public class IdCardValidator implements ConstraintValidator<IdCard, String> {

    private static final Pattern ID_PATTERN =
        Pattern.compile("^\\d{17}[\\dXx]$");

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;  // null 交给 @NotNull 处理
        }
        if (!ID_PATTERN.matcher(value).matches()) {
            return false;
        }
        // 校验码验证（简化版）
        int[] weights = {7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2};
        char[] checkCodes = {'1','0','X','9','8','7','6','5','4','3','2'};
        int sum = 0;
        for (int i = 0; i < 17; i++) {
            sum += (value.charAt(i) - '0') * weights[i];
        }
        return checkCodes[sum % 11] == Character.toUpperCase(value.charAt(17));
    }
}

// 3. 使用
public class UserDTO {
    @IdCard
    private String idCard;
}
```

> **踩坑提醒**：`isValid` 方法中 `null` 值应返回 `true`，把 null 校验交给 `@NotNull`。这是 Bean Validation 的约定——各注解职责单一。如果你的注解同时校验 null，会导致 `@NotNull` 的错误信息被覆盖。

---

## 3.4 全局异常处理

### 3.4.1 @ExceptionHandler 与 @ControllerAdvice

**痛点**：Controller 到处 `try-catch` 返回不同的错误 JSON？用全局异常处理一层搞定。

#### @RestControllerAdvice 全局拦截

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    // 处理参数校验失败
    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result handleValidation(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
            .map(e -> e.getField() + ": " + e.getDefaultMessage())
            .collect(Collectors.joining("; "));
        return Result.fail(400, message);
    }

    // 处理业务异常
    @ExceptionHandler(BusinessException.class)
    public Result handleBusiness(BusinessException ex) {
        return Result.fail(ex.getCode(), ex.getMessage());
    }

    // 处理资源不存在
    @ExceptionHandler(ResourceNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public Result handleNotFound(ResourceNotFoundException ex) {
        return Result.fail(404, ex.getMessage());
    }

    // 兜底：未知异常
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public Result handleException(Exception ex) {
        log.error("未知异常", ex);
        return Result.fail(500, "服务器内部错误");
    }
}
```

> **踩坑提醒**：`@RestControllerAdvice` = `@ControllerAdvice` + `@ResponseBody`。如果你用 `@ControllerAdvice` 忘记加 `@ResponseBody`，异常处理器返回的对象会被当作视图名解析，导致 404 或 500。

---

### 3.4.2 统一错误响应体设计

**痛点**：前端对接时每个接口返回的错误格式都不一样？设计一套统一的错误响应体。

```java
// 统一错误响应
public record ErrorResponse(
    int code,           // 业务错误码
    String message,     // 用户友好的错误信息
    String traceId,     // 链路追踪 ID
    String path,        // 请求路径
    String timestamp,   // 时间戳
    List<FieldError> details  // 字段级错误（校验失败时）
) {
    public record FieldError(String field, String message, Object rejectedValue) {}

    public static ErrorResponse of(int code, String message, HttpServletRequest request) {
        return new ErrorResponse(
            code, message,
            MDC.get("traceId"),       // MDC 中的 traceId
            request.getRequestURI(),
            Instant.now().toString(),
            null
        );
    }
}

// 全局异常处理器中使用
@ExceptionHandler(MethodArgumentNotValidException.class)
@ResponseStatus(HttpStatus.BAD_REQUEST)
public ErrorResponse handleValidation(MethodArgumentNotValidException ex,
                                       HttpServletRequest request) {
    List<ErrorResponse.FieldError> details = ex.getBindingResult().getFieldErrors()
        .stream()
        .map(e -> new ErrorResponse.FieldError(
            e.getField(), e.getDefaultMessage(), e.getRejectedValue()))
        .toList();
    return new ErrorResponse(400, "参数校验失败", MDC.get("traceId"),
                             request.getRequestURI(), Instant.now().toString(), details);
}
```

> **踩坑提醒**：永远不要把 `stackTrace` 直接返回给前端！生产环境只需返回 `traceId`，后端通过 traceId 在日志中定位问题。暴露堆栈信息是安全漏洞。

---

### 3.4.3 异常处理的优先级

**痛点**：Controller 内有 `@ExceptionHandler`，全局也有，到底哪个生效？

#### 优先级从高到低

```
1. Controller 内的 @ExceptionHandler（本 Controller 异常）
2. @ControllerAdvice 中的 @ExceptionHandler（全局）
3. /error 端点（Spring Boot BasicErrorController）
4. 默认白页 / Whitelabel Error Page
```

#### 匹配规则

Spring 按**异常类型最接近匹配**原则。如果 Controller 内处理了 `BusinessException`，全局也处理了 `BusinessException`，则 Controller 内的优先。

```java
@RestController
public class UserController {

    // ① 本 Controller 优先级最高
    @ExceptionHandler(BusinessException.class)
    public Result handleBiz(BusinessException ex) {
        return Result.fail("Controller 级别: " + ex.getMessage());
    }
}

@RestControllerAdvice
public class GlobalExceptionHandler {

    // ② 全局次之（其他 Controller 的 BusinessException 走这里）
    @ExceptionHandler(BusinessException.class)
    public Result handleBiz(BusinessException ex) {
        return Result.fail("全局: " + ex.getMessage());
    }

    // ③ 兜底
    @ExceptionHandler(Exception.class)
    public Result handleAll(Exception ex) {
        return Result.fail(500, "未知错误");
    }
}
```

> **踩坑提醒**：多个 `@ControllerAdvice` 之间可以通过 `@Order` 控制优先级，order 值越小越优先。但同一个 advice 内如果有两个方法处理同一异常类型，行为是未定义的——不要这样做。

---

## 3.5 拦截器与过滤器

### 3.5.1 Filter vs Interceptor 执行顺序

**痛点**：请求日志用 Filter 还是 Interceptor？它们的执行时机到底有什么区别？

#### 完整请求链路

```
请求 →
  Filter.doFilter()          ← Servlet 容器级别，不感知 Spring
    → DispatcherServlet
      → HandlerMapping
        → Interceptor.preHandle()    ← Spring MVC 级别，能拿到 Handler 信息
          → Controller 方法执行
        → Interceptor.postHandle()
      → 视图渲染
    → DispatcherServlet 返回
  Filter.doFilter() 返回     ← Filter 的后半段
响应 ←
```

#### 关键区别对比

| 维度 | Filter | Interceptor |
|------|--------|-------------|
| 规范 | Servlet 规范 | Spring MVC |
| 作用范围 | 所有请求（包括静态资源） | 只有 DispatcherServlet 处理的请求 |
| 依赖注入 | 默认不支持（需 `DelegatingFilterProxy`） | 原生支持 Spring Bean |
| 获取 Handler 信息 | ❌ | ✅ 能拿到 Controller 类和方法 |
| 执行顺序 | 先执行 | 后执行 |
| 典型场景 | 编码、CORS、安全认证 | 权限校验、日志、性能监控 |

> **踩坑提醒**：Filter 的执行顺序由 `@Order` 或 `FilterRegistrationBean.setOrder()` 决定。但 `@WebFilter` 配合 `@ServletComponentScan` 时，**无法通过 @Order 控制顺序**——需要用 `FilterRegistrationBean` 显式注册。

---

### 3.5.2 实战：请求日志与耗时统计

**痛点**：线上出问题了要排查，但不知道请求参数和耗时？

```java
@Component
public class RequestLoggingInterceptor implements HandlerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(RequestLoggingInterceptor.class);

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
                             Object handler) {
        long startTime = System.currentTimeMillis();
        request.setAttribute("startTime", startTime);

        // 生成并传递 traceId
        String traceId = UUID.randomUUID().toString().replace("-", "");
        MDC.put("traceId", traceId);
        response.setHeader("X-Trace-Id", traceId);

        if (handler instanceof HandlerMethod method) {
            log.info("→ {} {} | Controller: {}.{}() | Params: {}",
                request.getMethod(),
                request.getRequestURI(),
                method.getMethod().getDeclaringClass().getSimpleName(),
                method.getMethod().getName(),
                getParameters(request));
        }
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                Object handler, Exception ex) {
        long startTime = (long) request.getAttribute("startTime");
        long cost = System.currentTimeMillis() - startTime;

        log.info("← {} {} | Status: {} | Cost: {}ms",
            request.getMethod(),
            request.getRequestURI(),
            response.getStatus(),
            cost);

        if (cost > 3000) {
            log.warn("⚠️ 慢请求! {} {} 耗时 {}ms", request.getMethod(),
                     request.getRequestURI(), cost);
        }

        MDC.clear();  // 清理 MDC，防止线程复用时泄漏
    }

    private String getParameters(HttpServletRequest request) {
        Map<String, String[]> params = request.getParameterMap();
        if (params.isEmpty()) return "{}";
        return params.entrySet().stream()
            .map(e -> e.getKey() + "=" + String.join(",", e.getValue()))
            .collect(Collectors.joining(", ", "{", "}"));
    }
}

// 注册拦截器
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Autowired
    private RequestLoggingInterceptor loggingInterceptor;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(loggingInterceptor)
                .addPathPatterns("/api/**")    // 只拦截 API
                .excludePathPatterns("/api/health");  // 排除健康检查
    }
}
```

> **踩坑提醒**：`MDC.clear()` 必须在 `afterCompletion` 中调用！如果使用线程池，MDC 数据会在线程复用时「泄漏」到下一个请求，导致 traceId 混乱。也可以用 `TaskDecorator` 在异步场景传递 MDC。

---

### 3.5.3 实战：CORS 与 CSRF 防护

**痛点**：前端跨域请求报 CORS 错误？CSRF 攻击到底是什么？

#### CORS 配置

```java
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
            .allowedOrigins("https://example.com", "https://admin.example.com")
            .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
            .allowedHeaders("*")
            .exposedHeaders("X-Trace-Id", "X-Total-Count")
            .allowCredentials(true)     // 允许携带 Cookie
            .maxAge(3600);              // preflight 缓存 1 小时
    }
}
```

#### CSRF 攻击原理与防护

```
用户登录 bank.com → 浏览器保存 Cookie
用户访问恶意网站 → 恶意页面发起 <img src="bank.com/transfer?to=attacker&amount=10000">
浏览器自动携带 bank.com 的 Cookie → 转账成功！
```

**Spring Security 的 CSRF 防护**：

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf
                // REST API 使用 Token 认证，可以禁用 CSRF
                .ignoringRequestMatchers("/api/**")
                // 传统表单使用 CSRF Token
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
            );
        return http.build();
    }
}
```

| 场景 | CSRF 策略 |
|------|-----------|
| 传统服务端渲染（表单） | 启用 CSRF Token（Spring Security 默认开启） |
| REST API + JWT Token | 禁用 CSRF（JWT 本身防 CSRF） |
| REST API + Cookie Session | 启用 CSRF 或使用 SameSite Cookie |

> **踩坑提醒**：CORS 配置中 `allowCredentials(true)` 时，`allowedOrigins` 不能用 `"*"`——必须指定具体域名。这是 CORS 规范的安全限制。

---

## 3.6 RESTful API 设计

### 3.6.1 REST 语义与资源建模

**痛点**：URL 设计一团糟——`/getUser`、`/deleteUser?id=1`、`/user/save`？这才是 REST 的正确姿势。

#### RESTful URL 设计原则

| 原则 | ✅ 正确 | ❌ 错误 |
|------|---------|---------|
| 使用名词，不用动词 | `GET /users` | `GET /getUsers` |
| 复数形式 | `/users/1` | `/user/1` |
| 层级关系 | `/users/1/orders` | `/getUserOrders?userId=1` |
| HTTP 动词表达操作 | `DELETE /users/1` | `POST /deleteUser?id=1` |
| 小写 + 连字符 | `/user-profiles` | `/userProfiles` |

#### HTTP 动词语义

| 动词 | 语义 | 幂等 | 示例 |
|------|------|------|------|
| GET | 查询资源 | ✅ | `GET /users/1` |
| POST | 创建资源 | ❌ | `POST /users` |
| PUT | 全量替换 | ✅ | `PUT /users/1` |
| PATCH | 部分更新 | ✅ | `PATCH /users/1` |
| DELETE | 删除资源 | ✅ | `DELETE /users/1` |

#### Richardson 成熟度模型

| 级别 | 特征 | 示例 |
|------|------|------|
| Level 0 | 一个 URL + POST | `POST /api` → `{"action":"getUser","id":1}` |
| Level 1 | 多个 URL（资源） | `GET /users/1`、`POST /users` |
| Level 2 | HTTP 动词 + 状态码 | `DELETE /users/1` → 204 |
| Level 3 | HATEOAS（超媒体驱动） | 响应中包含相关操作链接 |

> **踩坑提醒**：REST 不是规范，是架构风格。不需要死守所有原则。务实的做法：至少达到 Level 2，根据项目需要决定是否做 Level 3。

---

### 3.6.2 HATEOAS 与超媒体

**痛点**：客户端要硬编码每个 API 路径？HATEOAS 让响应自带「下一步操作」链接。

#### Spring HATEOAS 实战

```java
// 引入依赖
// spring-boot-starter-hateoas

// 资源表示
public class UserRepresentation extends RepresentationModel<UserRepresentation> {
    private Long id;
    private String username;
    private String email;

    // getters & setters
}

// Controller
@RestController
@RequestMapping("/api/users")
public class UserController {

    @GetMapping("/{id}")
    public UserRepresentation getUser(@PathVariable Long id) {
        User user = userService.findById(id);

        UserRepresentation rep = new UserRepresentation();
        rep.setId(user.getId());
        rep.setUsername(user.getUsername());
        rep.setEmail(user.getEmail());

        // 添加自链接
        rep.add(linkTo(methodOn(UserController.class).getUser(id)).withSelfRel());
        // 添加相关链接
        rep.add(linkTo(methodOn(UserController.class).getOrders(id)).withRel("orders"));
        rep.add(linkTo(methodOn(UserController.class).listUsers()).withRel("users"));

        return rep;
    }
}

// 响应示例
{
    "id": 1,
    "username": "zhangsan",
    "email": "zhangsan@example.com",
    "_links": {
        "self":   { "href": "/api/users/1" },
        "orders": { "href": "/api/users/1/orders" },
        "users":  { "href": "/api/users" }
    }
}
```

> **踩坑提醒**：HATEOAS 增加了响应体积和开发成本。对于内部微服务间调用，通常不需要 HATEOAS。它更适合面向公众的 API，让第三方开发者通过链接发现功能。

---

### 3.6.3 API 版本控制

**痛点**：API 改了不兼容，老客户端直接挂？三种版本控制方案对比。

| 方案 | 示例 | 优点 | 缺点 |
|------|------|------|------|
| URL 路径 | `GET /api/v1/users` | 简单直观，便于缓存 | URL 膨胀，不够「RESTful」 |
| 请求头 | `X-API-Version: 1` | URL 干净 | 不直观，调试不便 |
| MediaType | `Accept: application/vnd.app.v1+json` | 最 RESTful | 复杂，浏览器不好测 |

#### URL 路径方案实现

```java
@RestController
@RequestMapping("/api/v1/users")
public class UserV1Controller {

    @GetMapping("/{id}")
    public UserV1 getUser(@PathVariable Long id) {
        // V1 返回格式
        return new UserV1(id, "zhangsan");
    }
}

@RestController
@RequestMapping("/api/v2/users")
public class UserV2Controller {

    @GetMapping("/{id}")
    public UserV2 getUser(@PathVariable Long id) {
        // V2 返回格式（增加字段，拆分 name）
        return new UserV2(id, "zhang", "san", "zhangsan@example.com");
    }
}
```

#### MediaType 方案实现

```java
@RestController
@RequestMapping("/api/users")
public class UserController {

    @GetMapping(value = "/{id}", produces = "application/vnd.app.v1+json")
    public UserV1 getUserV1(@PathVariable Long id) { ... }

    @GetMapping(value = "/{id}", produces = "application/vnd.app.v2+json")
    public UserV2 getUserV2(@PathVariable Long id) { ... }
}
```

> **踩坑提醒**：不要为了版本而版本。只有当新旧接口不兼容时才需要版本控制。向后兼容的改动（加字段、加接口）不需要新版本。推荐 URL 路径方案——简单、直觉、团队认知成本最低。

---

## 3.7 文件上传与下载

### 3.7.1 单文件与多文件上传

**痛点**：用户上传头像、简历、批量图片——怎么做文件校验和大小限制？

```java
@RestController
@RequestMapping("/api/files")
public class FileController {

    // 单文件上传
    @PostMapping("/upload")
    public Result upload(@RequestParam("file") MultipartFile file) {
        if (file.isEmpty()) {
            return Result.fail(400, "请选择文件");
        }

        // 文件类型校验
        String contentType = file.getContentType();
        if (!List.of("image/jpeg", "image/png", "image/gif").contains(contentType)) {
            return Result.fail(400, "仅支持 JPG/PNG/GIF 格式");
        }

        // 文件大小校验（双重保障，配置文件也有限制）
        if (file.getSize() > 5 * 1024 * 1024) {
            return Result.fail(400, "文件大小不能超过 5MB");
        }

        // 保存文件（使用唯一文件名防止覆盖）
        String filename = UUID.randomUUID() + getExtension(file.getOriginalFilename());
        Path path = Path.of("/data/uploads", filename);
        file.transferTo(path.toFile());

        return Result.ok("/files/" + filename);
    }

    // 多文件上传
    @PostMapping("/batch-upload")
    public Result batchUpload(@RequestParam("files") List<MultipartFile> files) {
        if (files.size() > 10) {
            return Result.fail(400, "最多上传 10 个文件");
        }

        List<String> urls = files.stream()
            .filter(f -> !f.isEmpty())
            .map(f -> {
                String name = UUID.randomUUID() + getExtension(f.getOriginalFilename());
                try {
                    f.transferTo(Path.of("/data/uploads", name).toFile());
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }
                return "/files/" + name;
            })
            .toList();

        return Result.ok(urls);
    }

    private String getExtension(String filename) {
        int idx = filename.lastIndexOf('.');
        return idx >= 0 ? filename.substring(idx) : "";
    }
}
```

#### application.yml 配置

```yaml
spring:
  servlet:
    multipart:
      max-file-size: 5MB          # 单文件最大
      max-request-size: 20MB      # 单次请求最大
      enabled: true
      file-size-threshold: 2KB    # 超过此大小写入临时文件
```

> **踩坑提醒**：`file.transferTo()` 在 Linux 上可能报 `FileNotFoundException`——原因是临时文件路径和目标路径在不同文件系统，无法 rename。解决：用 `Files.copy()` 代替，或确保临时目录和上传目录在同一分区。

---

### 3.7.2 大文件流式处理

**痛点**：下载 2GB 的文件，直接 `byte[]` 读入内存直接 OOM？

#### StreamingResponseBody 大文件下载

```java
@GetMapping("/download/{filename}")
public ResponseEntity<StreamingResponseBody> download(@PathVariable String filename) {
    Path filePath = Path.of("/data/uploads", filename);
    if (!Files.exists(filePath)) {
        return ResponseEntity.notFound().build();
    }

    StreamingResponseBody body = outputStream -> {
        try (InputStream inputStream = Files.newInputStream(filePath)) {
            byte[] buffer = new byte[8192];
            int bytesRead;
            while ((bytesRead = inputStream.read(buffer)) != -1) {
                outputStream.write(buffer, 0, bytesRead);
            }
        }
    };

    return ResponseEntity.ok()
        .header(HttpHeaders.CONTENT_DISPOSITION,
                "attachment; filename=\"" + filename + "\"")
        .contentLength(Files.size(filePath))
        .contentType(MediaType.APPLICATION_OCTET_STREAM)
        .body(body);
}
```

#### 断点续传（Range 请求）

```java
@GetMapping(value = "/download/{filename}", headers = "Range")
public ResponseEntity<Resource> downloadWithRange(
        @PathVariable String filename,
        @RequestHeader("Range") String rangeHeader) throws IOException {

    Path filePath = Path.of("/data/uploads", filename);
    long fileLength = Files.size(filePath);

    // 解析 Range: bytes=1000-2000
    long start = Long.parseLong(rangeHeader.replace("bytes=", "").split("-")[0]);
    long end = fileLength - 1;  // 默认到文件末尾
    if (rangeHeader.contains("-") && !rangeHeader.endsWith("-")) {
        end = Long.parseLong(rangeHeader.split("-")[1]);
    }
    long contentLength = end - start + 1;

    Resource resource = new FileSystemResource(filePath);

    return ResponseEntity.status(HttpStatus.PARTIAL_CONTENT)  // 206
        .header(HttpHeaders.CONTENT_RANGE,
                String.format("bytes %d-%d/%d", start, end, fileLength))
        .header(HttpHeaders.CONTENT_LENGTH, String.valueOf(contentLength))
        .contentType(MediaType.APPLICATION_OCTET_STREAM)
        .body(new PartialContentResourceWrapper(resource, start, contentLength));
}
```

> **踩坑提醒**：`StreamingResponseBody` 是异步执行的，如果在主线程中做了耗时操作（如数据库查询），要确保使用 `AsyncTaskExecutor`。另外下载大文件时注意设置合理的超时时间。

---

### 3.7.3 对象存储集成

**痛点**：文件存在本地服务器，扩容时文件丢失？用对象存储一劳永逸。

```java
// MinIO / S3 集成示例（使用 AWS S3 SDK）
@Configuration
public class S3Config {

    @Bean
    public AmazonS3 amazonS3() {
        AWSCredentials credentials = new BasicAWSCredentials("accessKey", "secretKey");
        return AmazonS3ClientBuilder.standard()
            .withCredentials(new AWSStaticCredentialsProvider(credentials))
            .withEndpointConfiguration(
                new EndpointConfiguration("http://minio:9000", "us-east-1"))
            .withPathStyleAccessEnabled(true)  // MinIO 必须开启
            .build();
    }
}

@Service
public class FileStorageService {

    @Autowired
    private AmazonS3 s3Client;

    private final String bucketName = "my-app";

    // 上传文件
    public String upload(MultipartFile file) {
        String key = "uploads/" + UUID.randomUUID() + getExtension(file.getOriginalFilename());

        ObjectMetadata metadata = new ObjectMetadata();
        metadata.setContentType(file.getContentType());
        metadata.setContentLength(file.getSize());

        try {
            s3Client.putObject(bucketName, key, file.getInputStream(), metadata);
        } catch (IOException e) {
            throw new RuntimeException("文件上传失败", e);
        }
        return key;
    }

    // 生成预签名 URL（临时访问链接，有效期 1 小时）
    public String generatePresignedUrl(String key) {
        Date expiration = Date.from(Instant.now().plus(Duration.ofHours(1)));
        URL url = s3Client.generatePresignedUrl(bucketName, key, expiration, HttpMethod.GET);
        return url.toString();
    }
}
```

> **踩坑提醒**：预签名 URL 是解决「文件私有但需要临时公开访问」的最佳方案。不要为了省事把 bucket 设为 public——那意味着任何人都能访问所有文件。另外 MinIO 的 `withPathStyleAccessEnabled(true)` 必须开启，否则会用虚拟主机方式访问导致失败。

---

## 3.8 WebFlux 响应式编程

### 3.8.1 阻塞模型的瓶颈

**痛点**：Spring MVC 每个请求占一个线程，高并发时线程池耗尽？WebFlux 的事件驱动模型能解决这个问题吗？

#### MVC vs WebFlux 线程模型

```
MVC（阻塞模型）：
  请求1 → Thread-1 → [等待 DB 50ms] → 返回
  请求2 → Thread-2 → [等待 DB 50ms] → 返回
  请求3 → Thread-3 → [等待 DB 50ms] → 返回
  ...
  200 个线程 → 最多 200 个并发（线程等待时 CPU 空闲）

WebFlux（非阻塞模型）：
  请求1 → EventLoop → [注册回调] → 处理请求2 → DB 回来了 → 处理请求1 结果
  请求2 → EventLoop → [注册回调] → 处理请求3 → ...
  ...
  4 个线程（CPU 核心数）→ 数万并发（线程永远不等待）
```

#### 核心差异对比

| 维度 | Spring MVC | Spring WebFlux |
|------|-----------|----------------|
| 线程模型 | 一请求一线程 | 事件驱动，少量线程 |
| 编程风格 | 同步阻塞 | 异步非阻塞 |
| 适用场景 | CPU 密集型、传统 CRUD | IO 密集型、高并发 |
| Servlet 依赖 | 依赖 Servlet API | 不依赖（可在 Netty 上运行） |
| 学习曲线 | 低 | 高（Reactive Streams） |

> **踩坑提醒**：WebFlux 不是 MVC 的「升级版」，而是另一种选择。如果你的业务主要是数据库 CRUD（阻塞操作），用 WebFlux 反而更差——阻塞操作会卡死 EventLoop。WebFlux 真正的场景是大量 IO 等待（网关、消息推送、代理转发）。

---

### 3.8.2 Reactor 核心类型

**痛点**：`Mono` 和 `Flux` 到底是什么？跟 `CompletableFuture` 和 `Stream` 有什么关系？

#### Mono 与 Flux

```java
// Mono：0 或 1 个元素的异步序列
Mono<String> mono = Mono.just("hello");
Mono<String> emptyMono = Mono.empty();
Mono<String> errorMono = Mono.error(new RuntimeException("oops"));

// Flux：0 到 N 个元素的异步序列
Flux<Integer> flux = Flux.just(1, 2, 3, 4, 5);
Flux<Integer> range = Flux.range(1, 10);
Flux<String> fromStream = Flux.fromStream(List.of("a", "b", "c").stream());
```

#### 创建、转换、组合

```java
// 创建
Flux<String> flux = Flux.fromIterable(List.of("apple", "banana", "cherry"));

// 转换（类似 Stream 操作）
Flux<String> upper = flux
    .filter(s -> s.startsWith("a"))
    .map(String::toUpperCase)
    .doOnNext(s -> log.info("处理: {}", s));

// 组合
Mono<String> mono1 = Mono.just("Hello");
Mono<String> mono2 = Mono.just("World");
Mono<String> combined = mono1.zipWith(mono2, (a, b) -> a + " " + b);

// 扁平化（flatMap 类似 Stream 的 flatMap）
Flux<Integer> nested = Flux.just("1-2-3", "4-5-6")
    .flatMap(s -> Flux.fromArray(s.split("-")))
    .map(Integer::parseInt);

// 错误处理
Mono<String> safe = mono1
    .onErrorReturn("fallback")               // 出错返回默认值
    .onErrorResume(e -> Mono.just("retry"));  // 出错用备用 Mono

// 背压控制
flux.subscribe(
    item -> log.info("收到: {}", item),
    error -> log.error("错误", error),
    () -> log.info("完成"),
    subscription -> subscription.request(10)  // 每次请求 10 个元素
);
```

> **踩坑提醒**：Reactor 是**懒执行**的——`flux.map(...)` 不会立即执行，只有 `subscribe()` 才会触发。这跟 Stream 的惰性求值一样。调试时如果不 subscribe，什么都不会发生。

---

### 3.8.3 WebFlux 注解模式与函数式模式

**痛点**：WebFlux 有两种写法，注解模式看起来跟 MVC 一样，那区别在哪？

#### 注解模式（类似 MVC）

```java
@RestController
@RequestMapping("/api/users")
public class UserReactiveController {

    @Autowired
    private ReactiveUserRepository userRepository;

    @GetMapping("/{id}")
    public Mono<User> getUser(@PathVariable Long id) {
        return userRepository.findById(id)
            .switchIfEmpty(Mono.error(new ResourceNotFoundException("User not found")));
    }

    @GetMapping
    public Flux<User> listUsers() {
        return userRepository.findAll();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Mono<User> createUser(@Valid @RequestBody Mono<UserDTO> dtoMono) {
        return dtoMono
            .map(dto -> new User(null, dto.getUsername(), dto.getEmail()))
            .flatMap(userRepository::save);
    }
}
```

#### 函数式模式

```java
@Configuration
public class RouterConfig {

    @Bean
    public RouterFunction<ServerResponse> userRoutes(UserHandler handler) {
        return RouterFunctions.route()
            .GET("/api/users/{id}", handler::getUser)
            .GET("/api/users", handler::listUsers)
            .POST("/api/users", handler::createUser)
            .build();
    }
}

@Component
public class UserHandler {

    @Autowired
    private ReactiveUserRepository userRepository;

    public Mono<ServerResponse> getUser(ServerRequest request) {
        Long id = Long.valueOf(request.pathVariable("id"));
        return userRepository.findById(id)
            .flatMap(user -> ServerResponse.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(user))
            .switchIfEmpty(ServerResponse.notFound().build());
    }

    public Mono<ServerResponse> listUsers(ServerRequest request) {
        return ServerResponse.ok()
            .contentType(MediaType.APPLICATION_JSON)
            .body(userRepository.findAll(), User.class);
    }

    public Mono<ServerResponse> createUser(ServerRequest request) {
        return request.bodyToMono(User.class)
            .flatMap(userRepository::save)
            .flatMap(user -> ServerResponse
                .created(URI.create("/api/users/" + user.getId()))
                .bodyValue(user));
    }
}
```

#### 两种模式对比

| 维度 | 注解模式 | 函数式模式 |
|------|----------|-----------|
| 风格 | 跟 MVC 相似，上手快 | 更函数式，组合灵活 |
| 路由 | `@RequestMapping` | `RouterFunction` 链式配置 |
| 适用 | 简单 REST API | 复杂路由逻辑、动态路由 |
| 类比 | Spring MVC | Express.js / Koa |

> **踩坑提醒**：注解模式的 WebFlux 看起来跟 MVC 几乎一样，但底层完全不同——它运行在 Netty 而不是 Tomcat 上。不要在 WebFlux Controller 中调用阻塞的 JDBC 方法，这会阻塞 EventLoop 线程，导致整个应用卡死。

---

### 3.8.4 MVC vs WebFlux 选型

**痛点**：新项目到底选 MVC 还是 WebFlux？

#### 三个维度决策

```
1. 你的依赖库是否都是非阻塞？
   ├── 是 → WebFlux 可以发挥优势
   └── 否（有 JDBC、Redis 同步客户端）→ MVC 更简单

2. 你需要高并发（>10K 连接）吗？
   ├── 是（网关、推送服务）→ WebFlux
   └── 否（普通 CRUD 应用）→ MVC

3. 团队熟悉响应式编程吗？
   ├── 是 → WebFlux
   └── 否 → MVC + 异步（@Async、CompletableFuture）
```

#### 混用阻塞依赖的陷阱

```java
// ❌ 危险！JDBC 是阻塞的，会卡死 EventLoop
@RestController
public class BadController {
    @Autowired
    private JdbcTemplate jdbcTemplate;  // 阻塞！

    @GetMapping("/users")
    public Flux<User> getUsers() {
        return Flux.fromIterable(
            jdbcTemplate.query("SELECT * FROM users", userRowMapper)  // 阻塞线程！
        );
    }
}

// ✅ 正确方案1：使用 R2DBC（非阻塞数据库驱动）
@Autowired
private ReactiveUserRepository userRepository;  // R2DBC

// ✅ 正确方案2：阻塞操作放到专用线程池
@GetMapping("/users")
public Flux<User> getUsers() {
    return Flux.defer(() ->
            Flux.fromIterable(jdbcTemplate.query("SELECT * FROM users", userRowMapper)))
        .subscribeOn(Schedulers.boundedElastic());  // 专用阻塞线程池
}
```

> **踩坑提醒**：如果你用了 WebFlux 但大量操作是阻塞的（比如 JDBC），`Schedulers.boundedElastic()` 可以救急，但这时 WebFlux 的性能优势基本没了。这种情况下，老实选 MVC 更明智。

---

## 3.9 实时通信：WebSocket 与 SSE

### 3.9.1 WebSocket 与 STOMP

**痛点**：聊天室、实时通知——HTTP 轮询太浪费，WebSocket 怎么在 Spring 中用？

#### WebSocket + STOMP 配置

```java
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        // 客户端发送消息的目的地前缀
        config.setApplicationDestinationPrefixes("/app");
        // 启用消息代理（客户端订阅的前缀）
        config.enableSimpleBroker("/topic", "/queue");
        // 用户目标前缀（点对点）
        config.setUserDestinationPrefix("/user");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // WebSocket 端点（SockJS 降级支持）
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("*")
                .withSockJS();
    }
}
```

#### 群聊广播

```java
@Controller
public class ChatController {

    // 接收客户端发到 /app/chat.send 的消息
    @MessageMapping("/chat.send")
    // 广播到订阅 /topic/chat 的所有客户端
    @SendTo("/topic/chat")
    public ChatMessage sendMessage(ChatMessage message) {
        message.setTimestamp(LocalDateTime.now());
        return message;
    }
}

// 消息实体
public record ChatMessage(String sender, String content, LocalDateTime timestamp) {}
```

#### 点对点消息

```java
@Controller
public class PrivateChatController {

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @MessageMapping("/chat.private")
    public void sendPrivate(PrivateMessage message) {
        // 发送到指定用户：/user/{username}/queue/messages
        messagingTemplate.convertAndSendToUser(
            message.to(),
            "/queue/messages",
            message
        );
    }
}
```

#### 前端连接示例

```javascript
const socket = new SockJS('/ws');
const stompClient = Stomp.over(socket);

stompClient.connect({}, (frame) => {
    // 订阅群聊
    stompClient.subscribe('/topic/chat', (message) => {
        const msg = JSON.parse(message.body);
        console.log(`${msg.sender}: ${msg.content}`);
    });

    // 订阅私聊
    stompClient.subscribe('/user/queue/messages', (message) => {
        console.log('收到私聊:', JSON.parse(message.body));
    });

    // 发送消息
    stompClient.send('/app/chat.send', {}, JSON.stringify({
        sender: 'zhangsan',
        content: 'Hello!'
    }));
});
```

> **踩坑提醒**：WebSocket 连接是**有状态**的，不能像 HTTP 那样随便负载均衡。如果用 Nginx 做负载均衡，必须配置 `ip_hash` 或 sticky session，否则订阅消息会丢失（因为订阅建立在 A 节点，但广播从 B 节点发出）。

---

### 3.9.2 SSE

**痛点**：只需要服务器向客户端推送（不需要双向通信），WebSocket 是不是杀鸡用牛刀？

#### SseEmitter 方式

```java
@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    // 存储所有连接的 SseEmitter
    private final Map<String, SseEmitter> emitters = new ConcurrentHashMap<>();

    @GetMapping("/subscribe")
    public SseEmitter subscribe() {
        String userId = getCurrentUserId();
        // 超时设置为 0 表示不超时
        SseEmitter emitter = new SseEmitter(0L);

        emitter.onCompletion(() -> emitters.remove(userId));
        emitter.onTimeout(() -> emitters.remove(userId));
        emitter.onError(e -> emitters.remove(userId));

        emitters.put(userId, emitter);

        // 发送初始连接成功事件
        try {
            emitter.send(SseEmitter.event()
                .name("connected")
                .data("连接成功"));
        } catch (IOException e) {
            emitters.remove(userId);
        }

        return emitter;
    }

    // 向指定用户推送消息
    public void sendToUser(String userId, String eventName, Object data) {
        SseEmitter emitter = emitters.get(userId);
        if (emitter != null) {
            try {
                emitter.send(SseEmitter.event()
                    .name(eventName)
                    .data(data));
            } catch (IOException e) {
                emitters.remove(userId);
            }
        }
    }
}
```

#### WebFlux Flux 方式

```java
@RestController
@RequestMapping("/api/stream")
public class StreamController {

    @GetMapping(value = "/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> streamEvents() {
        return Flux.interval(Duration.ofSeconds(1))
            .map(seq -> ServerSentEvent.<String>builder()
                .id(String.valueOf(seq))
                .event("heartbeat")
                .data("消息 " + seq)
                .build());
    }
}
```

#### SSE vs WebSocket 选型

| 维度 | SSE | WebSocket |
|------|-----|-----------|
| 通信方向 | 服务器 → 客户端（单向） | 双向 |
| 协议 | HTTP | 独立协议（ws://） |
| 自动重连 | ✅ 浏览器内置 | ❌ 需手动实现 |
| 数据格式 | 文本（text/event-stream） | 文本 + 二进制 |
| 跨域 | 跟 HTTP 一样处理 | 需额外配置 |
| 适用场景 | 通知推送、实时数据流、AI 流式响应 | 聊天、游戏、协同编辑 |

> **踩坑提醒**：浏览器对 SSE 有**同域名最大连接数限制**（HTTP/1.1 通常是 6 个）。如果页面有 6 个 SSE 连接，第 7 个会排队。解决方案：用 HTTP/2（无连接数限制）或将多个事件流合并成一个。

---

## 本章总结

Spring Web 开发的全链路可以概括为：

1. **请求进入**：Tomcat → Filter → DispatcherServlet → HandlerMapping → HandlerAdapter → Controller
2. **参数处理**：ArgumentResolver 解析入参，Bean Validation 校验
3. **业务执行**：你的代码
4. **返回处理**：ReturnValueHandler → HttpMessageConverter → 序列化 → Response
5. **异常兜底**：@ExceptionHandler → @ControllerAdvice → /error → 白页
6. **横切关注点**：Filter（Servlet 级）和 Interceptor（MVC 级）负责日志、鉴权、CORS
7. **高级特性**：文件处理、RESTful 设计、WebFlux 响应式、WebSocket/SSE 实时通信

掌握这条链路，Spring Web 开发就不再有盲区。
