# 全局异常处理

> Controller 到处 `try-catch` 返回不同的错误 JSON？前端对接时每个接口的错误格式都不一样？全局异常处理用 `@RestControllerAdvice` 一层搞定，让所有异常都带着统一的格式、清晰的错误码、可定位的 traceId 返回给调用方。

## 1. @ExceptionHandler 与 @ControllerAdvice

### 1.1 为什么需要全局异常处理

没有全局异常处理时，每个 Controller 都要重复写 try-catch：

```java
// ❌ 到处 try-catch，错误格式不统一
@RestController
public class UserController {

    @GetMapping("/{id}")
    public Result getUser(@PathVariable Long id) {
        try {
            User user = userService.findById(id);
            return Result.ok(user);
        } catch (UserNotFoundException e) {
            return Result.fail(404, e.getMessage());
        } catch (Exception e) {
            log.error("查询用户失败", e);
            return Result.fail(500, "服务器内部错误");
        }
    }
}
```

全局异常处理把这段逻辑抽取到一个地方，Controller 只关注业务：

```java
// ✅ Controller 只写业务
@RestController
public class UserController {

    @GetMapping("/{id}")
    public User getUser(@PathVariable Long id) {
        return userService.findById(id);  // 异常交给全局处理器
    }
}
```

### 1.2 @RestControllerAdvice

`@RestControllerAdvice` = `@ControllerAdvice` + `@ResponseBody`，是全局异常处理的标准写法：

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    // 参数校验失败（@Valid @RequestBody 触发）
    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorResponse handleValidation(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
            .map(e -> e.getField() + ": " + e.getDefaultMessage())
            .collect(Collectors.joining("; "));
        return ErrorResponse.of(400, message);
    }

    // 业务异常
    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ErrorResponse> handleBusiness(BusinessException ex) {
        return ResponseEntity.status(ex.getHttpStatus())
            .body(ErrorResponse.of(ex.getCode(), ex.getMessage()));
    }

    // 资源不存在
    @ExceptionHandler(ResourceNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ErrorResponse handleNotFound(ResourceNotFoundException ex) {
        return ErrorResponse.of(404, ex.getMessage());
    }

    // 兜底：未知异常
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ErrorResponse handleException(Exception ex) {
        log.error("未知异常", ex);
        return ErrorResponse.of(500, "服务器内部错误");
    }
}
```

> **踩坑提醒**：`@RestControllerAdvice` = `@ControllerAdvice` + `@ResponseBody`。如果用 `@ControllerAdvice` 忘记加 `@ResponseBody`，异常处理器返回的对象会被当作视图名解析，导致 404 或 500。

### 1.3 三种校验异常

校验发生在不同入口，抛出的异常类型不同，需要分别捕获：

```java
@RestControllerAdvice
public class ValidationExceptionHandler {

    // ① @Valid @RequestBody 校验失败
    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorResponse handleBodyValidation(MethodArgumentNotValidException ex) {
        List<ErrorResponse.FieldError> details = ex.getBindingResult()
            .getFieldErrors().stream()
            .map(e -> new ErrorResponse.FieldError(
                e.getField(), e.getDefaultMessage(), e.getRejectedValue()))
            .toList();
        return ErrorResponse.of(400, "参数校验失败", details);
    }

    // ② @Validated 方法级校验失败（Service 层）
    @ExceptionHandler(ConstraintViolationException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorResponse handleConstraint(ConstraintViolationException ex) {
        String message = ex.getConstraintViolations().stream()
            .map(v -> v.getPropertyPath() + ": " + v.getMessage())
            .collect(Collectors.joining("; "));
        return ErrorResponse.of(400, message);
    }

    // ③ @Valid @ModelAttribute 表单绑定失败
    @ExceptionHandler(BindException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorResponse handleBind(BindException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
            .map(e -> e.getField() + ": " + e.getDefaultMessage())
            .collect(Collectors.joining("; "));
        return ErrorResponse.of(400, message);
    }

    // ④ 反序列化失败（JSON 格式错误、类型不匹配）
    @ExceptionHandler(HttpMessageNotReadableException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorResponse handleUnreadable(HttpMessageNotReadableException ex) {
        return ErrorResponse.of(400, "请求体格式错误");
    }
}
```

> **踩坑提醒**：新手最常见的遗漏是只处理了 `MethodArgumentNotValidException`，漏掉了 `ConstraintViolationException` 和 `BindException`。Service 层方法级校验和表单绑定失败时异常无人接管，最终变成 500。

---

## 2. 统一错误响应体设计

### 2.1 为什么需要统一格式

前端对接时，如果每个接口返回的错误格式都不一样，前端要写大量适配代码。统一的错误响应体让前端只需一套错误处理逻辑。

### 2.2 ErrorResponse 设计

```java
public record ErrorResponse(
    int code,              // 业务错误码
    String message,        // 用户友好的错误信息
    String traceId,        // 链路追踪 ID
    String path,           // 请求路径
    String timestamp,      // 时间戳
    List<FieldError> details  // 字段级错误（校验失败时）
) {
    public record FieldError(String field, String message, Object rejectedValue) {}

    public static ErrorResponse of(int code, String message) {
        return new ErrorResponse(code, message, null, null, Instant.now().toString(), null);
    }

    public static ErrorResponse of(int code, String message, List<FieldError> details) {
        return new ErrorResponse(code, message, null, null, Instant.now().toString(), details);
    }

    public static ErrorResponse of(int code, String message, HttpServletRequest request) {
        return new ErrorResponse(
            code, message,
            MDC.get("traceId"),
            request.getRequestURI(),
            Instant.now().toString(),
            null
        );
    }
}
```

### 2.3 在全局异常处理器中使用

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorResponse handleValidation(MethodArgumentNotValidException ex,
                                           HttpServletRequest request) {
        List<ErrorResponse.FieldError> details = ex.getBindingResult()
            .getFieldErrors().stream()
            .map(e -> new ErrorResponse.FieldError(
                e.getField(), e.getDefaultMessage(), e.getRejectedValue()))
            .toList();
        return new ErrorResponse(400, "参数校验失败", MDC.get("traceId"),
                                 request.getRequestURI(), Instant.now().toString(), details);
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ErrorResponse handleException(Exception ex, HttpServletRequest request) {
        log.error("未知异常 [{}]", MDC.get("traceId"), ex);
        return ErrorResponse.of(500, "服务器内部错误", request);
    }
}
```

### 2.4 traceId 的价值

生产环境排查问题的流程：

```text
前端报错 → 拿到 traceId → 后端日志按 traceId grep → 定位完整链路
```

traceId 在 Filter 中生成，存入 MDC，日志自动带上。全局异常处理器从 MDC 中取出，写入响应体：

```java
// Filter 中生成 traceId（参见拦截器与过滤器章节）
MDC.put("traceId", UUID.randomUUID().toString().substring(0, 8));

// 全局异常处理器中使用
return new ErrorResponse(500, "服务器内部错误",
                         MDC.get("traceId"),  // ← 从 MDC 获取
                         request.getRequestURI(),
                         Instant.now().toString(), null);
```

> **踩坑提醒**：永远不要把 `stackTrace` 直接返回给前端！生产环境只需返回 `traceId`，后端通过 traceId 在日志中定位问题。暴露堆栈信息是安全漏洞。

---

## 3. 异常处理的优先级

### 3.1 优先级从高到低

```text
1. Controller 内的 @ExceptionHandler（本 Controller 异常）
2. @ControllerAdvice 中的 @ExceptionHandler（全局）
3. @ResponseStatus 注解（直接映射状态码）
4. DefaultHandlerExceptionResolver（Spring 内置异常映射）
5. /error 端点（Spring Boot BasicErrorController）
6. 默认白页 / Whitelabel Error Page
```

### 3.2 匹配规则

Spring 按**异常类型最接近匹配**原则。如果 Controller 内处理了 `BusinessException`，全局也处理了 `BusinessException`，则 Controller 内的优先。

```java
@RestController
public class UserController {

    // ① 本 Controller 优先级最高
    @ExceptionHandler(BusinessException.class)
    public ErrorResponse handleBiz(BusinessException ex) {
        return ErrorResponse.of(1001, "Controller 级别: " + ex.getMessage());
    }
}

@RestControllerAdvice
public class GlobalExceptionHandler {

    // ② 全局次之（其他 Controller 的 BusinessException 走这里）
    @ExceptionHandler(BusinessException.class)
    public ErrorResponse handleBiz(BusinessException ex) {
        return ErrorResponse.of(1001, "全局: " + ex.getMessage());
    }

    // ③ 兜底
    @ExceptionHandler(Exception.class)
    public ErrorResponse handleAll(Exception ex) {
        return ErrorResponse.of(500, "未知错误");
    }
}
```

### 3.3 多个 @ControllerAdvice 的优先级

```java
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)  // 优先级最高
public class ValidationExceptionHandler {
    @ExceptionHandler(MethodArgumentNotValidException.class)
    // ...
}

@RestControllerAdvice
@Order(Ordered.LOWEST_PRECEDENCE)   // 优先级最低，兜底
public class FallbackExceptionHandler {
    @ExceptionHandler(Exception.class)
    // ...
}
```

> **踩坑提醒**：多个 `@ControllerAdvice` 之间可以通过 `@Order` 控制优先级，order 值越小越优先。但同一个 advice 内如果有两个方法处理同一异常类型，行为是未定义的——不要这样做。

### 3.4 异常处理与 Filter 的边界

Spring MVC 的异常处理机制只在 DispatcherServlet 内部生效。Filter 中抛出的异常不会被 `@ExceptionHandler` 捕获：

```text
请求进入
  │
  ▼
Filter 链  ← 异常不会被 @ExceptionHandler 捕获
  │
  ▼
DispatcherServlet
  │
  ├── Controller 方法抛出异常
  │     └── ✅ @ExceptionHandler 捕获
  └── ...
```

Filter 中的异常需要手动处理：

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
            log.error("Filter 异常", ex);
            response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            response.setContentType("application/json");
            response.getWriter().write(
                "{\"code\":500,\"message\":\"" + ex.getMessage() + "\"}");
        }
    }
}
```

---

## 4. 最佳实践

1. **异常处理器放在统一的包中**——如 `com.example.exception.handler`
2. **错误码用常量管理**——避免散落在代码中，推荐枚举或常量类
3. **业务异常继承统一基类**——`BusinessException` 包含 code + message + httpStatus
4. **区分用户可见错误和系统错误**——用户看到的是友好提示，系统日志记录完整堆栈
5. **traceId 贯穿全链路**——Filter 生成 → MDC 传递 → 日志输出 → 响应返回
6. **不要暴露内部信息**——堆栈、SQL、内部 IP 永远不返回给客户端
