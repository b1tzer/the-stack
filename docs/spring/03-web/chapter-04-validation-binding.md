# 参数校验与数据绑定

Controller 接收到的每个参数都来自不可信的外部输入。校验的目的不是"拦下坏数据"，而是让坏数据在进入业务逻辑之前就带着清晰的原因被拒绝。本章讲两件事：用 Bean Validation 声明校验规则，以及 Spring 如何把这些规则与 HTTP 参数绑定到一起。

## 1. Bean Validation：把校验从 Controller 里请出去

先看一段没有校验的代码：

```java
@PostMapping("/users")
public User createUser(@RequestBody UserDTO dto) {
    if (dto.getUsername() == null || dto.getUsername().trim().isEmpty()) {
        throw new BusinessException("用户名不能为空");
    }
    if (dto.getEmail() == null || !dto.getEmail().contains("@")) {
        throw new BusinessException("邮箱格式不正确");
    }
    if (dto.getAge() == null || dto.getAge() < 1 || dto.getAge() > 150) {
        throw new BusinessException("年龄必须在1-150之间");
    }
    return userService.create(dto);
}
```

这段代码能工作，但校验规则和业务逻辑挤在一起。每加一个字段，`if` 就多一坨；同一个字段在多个接口复用，规则就得复制一遍。

Bean Validation（[JSR-303](https://beanvalidation.org/1.0/spec/) / [JSR-380](https://beanvalidation.org/2.0/spec/)）把校验规则从"代码"变成"声明"，规则直接写在字段上：

```java
public class UserDTO {
    @NotBlank(message = "用户名不能为空")
    @Size(min = 2, max = 20, message = "用户名长度2-20")
    private String username;

    @Email(message = "邮箱格式不正确")
    private String email;

    @Min(value = 1, message = "年龄最小为1")
    @Max(value = 150, message = "年龄最大为150")
    private Integer age;
}
```

触发校验只需在参数前加一个 `@Valid`：

```java
@PostMapping("/users")
public User createUser(@Valid @RequestBody UserDTO dto) {
    return userService.create(dto);  // 校验通过才会执行到这里
}
```

::: warning 版本锚点
Spring Boot 3.x 起，Bean Validation 注解从 `javax.validation.*` 迁移到 `jakarta.validation.*`。两者只有包名不同，用法一致，本文示例统一使用 `jakarta.validation`。
:::

## 2. 三个最容易被搞混的注解

`@NotNull`、`@NotEmpty`、`@NotBlank` 名字相近、作用对象不同，是校验领域最高频的坑：

| 注解 | 作用对象 | `null` | `""` 空串 | `"   "` 纯空白 |
| :-- | :-- | :-- | :-- | :-- |
| `@NotNull` | 任意类型 | ❌ 拒绝 | ✅ 通过 | ✅ 通过 |
| `@NotEmpty` | CharSequence / Collection / Map / 数组 | ❌ 拒绝 | ❌ 拒绝 | ✅ 通过 |
| `@NotBlank` | 仅 String | ❌ 拒绝 | ❌ 拒绝 | ❌ 拒绝 |

结论：校验字符串非空且非空白，用 `@NotBlank`；校验集合非空，用 `@NotEmpty`；只想排除 `null`，用 `@NotNull`。

其余常用注解：

| 注解 | 作用 |
| :-- | :-- |
| `@Email` | 校验邮箱格式（宽松规则，允许部分非标准地址） |
| `@Size(min, max)` | 校验字符串 / 集合 / 数组长度 |
| `@Min` / `@Max` | 数值下界 / 上界（含边界） |
| `@Pattern(regexp)` | 正则匹配 |
| `@Positive` / `@Negative` | 正数 / 负数 |

## 3. 校验怎么被触发：@Valid 与 @Validated

两个注解都能触发校验，但来源和能力不同：

| 对比项 | `@Valid` | `@Validated` |
| :-- | :-- | :-- |
| 来源 | JSR-303（`jakarta.validation.Valid`） | Spring（`org.springframework.validation.annotation.Validated`） |
| 分组校验 | ❌ 不支持 | ✅ 支持 |
| 方法级校验 | ❌ | ✅ 配合类级注解 |
| 使用位置 | 方法参数、字段 | 方法参数、类上 |

一句话：需要分组校验或方法级校验时用 `@Validated`，其余用 `@Valid`。

`@Valid` 加在 `@RequestBody` 参数上时，`RequestResponseBodyMethodProcessor` 先反序列化请求体，再调用校验器；校验失败抛出 `MethodArgumentNotValidException`，进入第 8 节的异常处理链路。

## 4. 三种入口，三种异常

校验发生在不同的入口，抛出的异常类型不同：

| 校验入口 | 抛出的异常 | 说明 |
| :-- | :-- | :-- |
| `@Valid @RequestBody` | `MethodArgumentNotValidException` | 请求体校验失败 |
| `@Validated` 方法参数（Service 层） | `ConstraintViolationException` | 方法级校验失败 |
| `@Valid @ModelAttribute` 表单绑定 | `BindException` | 表单对象绑定 + 校验失败 |

新手最容易漏掉后两个：全局处理器只写了 `MethodArgumentNotValidException`，Service 层方法校验或表单绑定失败时异常无人接管，最终变成 500 或静默丢失校验错误。第 8 节会给出反序列化异常与这三类校验异常一起处理的完整写法。

## 5. 自定义校验注解

注解本身只是元数据，真正的校验逻辑在 `ConstraintValidator` 实现里。以手机号校验为例：

```java
@Target({ElementType.FIELD, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = PhoneValidator.class)
public @interface Phone {

    String message() default "手机号格式不正确";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

`@Constraint(validatedBy = PhoneValidator.class)` 把注解与校验器绑定。校验器：

```java
public class PhoneValidator implements ConstraintValidator<Phone, String> {

    private static final Pattern PHONE = Pattern.compile("^1[3-9]\\d{9}$");

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        // null 交给 @NotNull / @NotBlank 处理，这里只校验非空值的格式
        return value == null || PHONE.matcher(value).matches();
    }
}
```

关键约定：校验器默认放行 `null`。是否拒绝空值由 `@NotNull` 等注解单独声明，校验器本身不越权。

再举一个带参数的注解——枚举值校验，注解通过 `enumClass` 属性传入枚举类型：

```java
@Target({ElementType.FIELD, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = EnumValueValidator.class)
public @interface EnumValue {

    Class<? extends Enum<?>> enumClass();

    String message() default "值不在允许范围内";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}

public class EnumValueValidator implements ConstraintValidator<EnumValue, String> {

    private Set<String> allowedValues;

    @Override
    public void initialize(EnumValue annotation) {
        allowedValues = Arrays.stream(annotation.enumClass().getEnumConstants())
            .map(Enum::name)
            .collect(Collectors.toSet());
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        return value == null || allowedValues.contains(value);
    }
}
```

`initialize` 在容器启动时执行一次，把枚举值缓存到 `allowedValues`，避免每次校验都反射枚举。使用：

```java
public class UserDTO {
    @EnumValue(enumClass = UserStatus.class, message = "无效的用户状态")
    private String status;
}
```

## 6. 数据绑定与 @InitBinder

数据绑定回答一个具体问题：HTTP 请求参数全是字符串，Spring 怎么把它们变成 Controller 方法参数里的对象？但先要分清一件事——**不是所有参数都经过数据绑定**。

### 6.1 数据绑定发生在哪

`@RequestBody` 和 `@ModelAttribute` 走的是两条完全不同的路：

| 参数类型 | 数据来源 | 转换方式 | 是否经过数据绑定 |
| :-- | :-- | :-- | :-- |
| `@RequestBody` | 请求体 JSON | Jackson 反序列化 | ❌ 不经过 |
| `@ModelAttribute` / 查询参数 | 表单、URL 参数 | Spring 数据绑定 | ✅ 经过 |

`@RequestBody` 由 `MappingJackson2HttpMessageConverter` 用 Jackson 直接把 JSON 字符串变成对象，一步到位，没有"绑定"这个环节。真正发生数据绑定的是表单参数和查询参数——它们按字段名从 `HttpServletRequest` 取 String，再逐个转成字段类型、写进对象。本节讲的就是后者。

### 6.2 两个转换体系：PropertyEditor 与 ConversionService

String 要转成 `int`、`LocalDate`、`BigDecimal`，Spring 里同时存在两套类型转换机制，容易让人困惑为什么会有两个：

| 对比项 | PropertyEditor | ConversionService |
| :-- | :-- | :-- |
| 来源 | JavaBeans 规范，JDK 自带 | Spring 3.0 引入 |
| 状态 | 有状态，`setValue` 累积 | 无状态，纯函数 |
| 泛型 | 不支持，只能 String → Object | 支持 `Converter<S, T>` 泛型 |
| 优先级 | 低（备用） | 高（优先） |

关键结论：**`ConversionService` 优先于 `PropertyEditor`**。Spring 先问 `ConversionService` 能不能转，转不了再退回 `PropertyEditor`。`PropertyEditor` 是 JavaBeans 遗留机制，之所以还在，是因为表单参数（`@RequestParam` / `@ModelAttribute` 简单类型）走的是 `WebDataBinder`，它内部要兼容这两套。

面向新代码，只需要知道一个事实：自定义类型转换应该写 `Converter<S, T>` 或 `Formatter<T>`，注册进 `ConversionService`，而不是去写 `PropertyEditor`。

### 6.3 WebDataBinder 绑的是什么

`WebDataBinder` 这个名字里的 "Binder"，绑的是**请求参数名 → 目标对象的属性**。它拿到一个 target 对象，把同名参数的值转换后 `set` 进去：

```txt
HTTP 请求参数（String）
    │
    ▼
PropertyEditor（备用，String → 目标类型）
    │
    ▼
ConversionService（优先，支持泛型）
    │
    ▼
WebDataBinder（按字段名匹配 + 转换 + set 到 target）
    │
    ▼
BindingResult（绑定错误 + 校验错误）
```

### 6.4 @InitBinder 定制绑定规则

`@InitBinder` 在绑定发生前执行，用来定制 `WebDataBinder`：

```java
@RestController
@RequestMapping("/api/users")
public class UserController {

    // 只对当前 Controller 生效：统一日期格式 + 屏蔽 id 字段
    @InitBinder
    public void initBinder(WebDataBinder binder) {
        binder.addCustomFormatter(new DateFormatter("yyyy-MM-dd"));
        binder.setDisallowedFields("id");  // 防止表单参数覆盖 id
    }
}
```

`setDisallowedFields("id")` 防的是"批量赋值"：攻击者往表单里塞 `id=1`，若不加限制，会直接绑定到对象的 `id` 字段并覆盖原值。参数解析器本身的机制详见 [Spring MVC §3 参数解析与返回值处理](./chapter-01-spring-mvc.md#param-resolution)，本章只讲绑定这一层。

### 6.5 绑定失败与校验失败是两回事

`BindingResult` 里同时装着两类错误，它们来源不同、处理方式也不同：

| 错误类型 | 触发条件 | 例子 |
| :-- | :-- | :-- |
| 绑定错误 | String 转目标类型失败 | 把 `"abc"` 赋给 `int age` |
| 校验错误 | 类型转换成功，但值不满足约束 | `age = -1` 触发 `@Min(1)` |

绑定错误发生在转换阶段，校验错误发生在转换之后的校验阶段。很多人把两者混为一谈，实际在 `BindingResult` 里是分开记录的（`FieldError` 有 `bindingFailure` 标志区分）。

默认情况下，绑定或校验失败会直接抛异常。如果希望在 Controller 方法内自行处理，把 `BindingResult` 声明为紧跟在被绑定对象之后的参数：

```java
@PostMapping
public User createUser(@Valid @ModelAttribute UserDTO dto, BindingResult bindingResult) {
    if (bindingResult.hasErrors()) {
        List<String> errors = bindingResult.getFieldErrors().stream()
            .map(e -> e.getField() + ": " + e.getDefaultMessage())
            .collect(Collectors.toList());
        throw new BusinessException("参数错误: " + String.join("; ", errors));
    }
    return userService.create(dto);
}
```

`BindingResult` 必须紧跟在 `@ModelAttribute` 参数之后，中间不能隔其他参数，否则 Spring 会把它当成普通参数。加了 `BindingResult` 后，校验失败不再抛 `BindException`，而是把错误写进 `bindingResult`，由方法自己决定。走这条路时，第 8 节的 `BindException` 处理器就不会被触发。

两种方式二选一：需要全局统一错误结构，用异常 + `@RestControllerAdvice`；需要在一个方法里做精细处理，用 `BindingResult`。

## 7. 实战：分组、嵌套、方法级、failFast

### 7.1 分组校验

创建和更新对字段的要求不同：创建时无 `id`，更新时必须有 `id`。分组让同一 DTO 承载多套规则：

```java
public class ValidationGroups {
    public interface Create {}
    public interface Update {}
}

public class UserDTO {
    @NotBlank(groups = {Create.class, Update.class})
    @Size(min = 2, max = 20, groups = {Create.class, Update.class})
    private String username;

    @NotBlank(groups = Create.class)  // 创建时必填，更新时可选
    @Email(groups = {Create.class, Update.class})
    private String email;

    @NotNull(groups = Update.class)  // 更新时必须有 ID
    private Long id;
}
```

分组校验必须用 `@Validated`（`@Valid` 不支持分组）：

```java
@PostMapping
public User createUser(@Validated(ValidationGroups.Create.class) @RequestBody UserDTO dto) {
    return userService.create(dto);
}

@PutMapping("/{id}")
public User updateUser(@Validated(ValidationGroups.Update.class) @RequestBody UserDTO dto) {
    return userService.update(dto);
}
```

### 7.2 嵌套对象校验

嵌套对象的内部注解默认不会生效，必须在字段上再加 `@Valid` 才能向下递归：

```java
public class OrderDTO {
    @NotNull
    private Long userId;

    @NotEmpty(message = "订单商品不能为空")
    @Valid  // ✅ 触发 List 内部元素的校验
    private List<OrderItemDTO> items;

    @Valid  // ✅ 触发 AddressDTO 内部字段的校验
    @NotNull
    private AddressDTO shippingAddress;
}

public class OrderItemDTO {
    @NotNull
    private Long productId;

    @Min(value = 1, message = "数量至少为1")
    @Max(value = 999, message = "数量最多999")
    private Integer quantity;
}
```

漏掉 `@Valid` 时，`items` 里每个元素的字段校验会被整体跳过，这是嵌套校验最常见的坑。

### 7.3 方法级校验

把校验下沉到 Service 层，防止非 Web 入口（定时任务、MQ 消费者）绕过 Controller 的校验。类上加 `@Validated`，方法参数上加约束注解：

```java
@Service
@Validated  // 启用方法参数校验
public class UserService {

    public User getUser(@Min(1) Long id) {
        return userRepository.findById(id).orElseThrow();
    }

    public List<User> searchUsers(
            @NotBlank @Size(min = 2, max = 50) String keyword,
            @Min(1) @Max(100) int limit) {
        return userRepository.search(keyword, limit);
    }
}
```

方法级校验失败抛的是 `ConstraintViolationException`，不是 `MethodArgumentNotValidException`。

### 7.4 快速失败 failFast

默认行为是校验完全部字段后一次性返回所有错误；配置 `failFast(true)` 后遇到第一个错误就停止，响应里只含一条错误：

```java
@Bean
public Validator validator() {
    return Validation.byProvider(HibernateValidator.class)
        .configure()
        .failFast(true)
        .buildValidatorFactory()
        .getValidator();
}
```

这个配置适合校验字段很多、只关心"第一个错在哪"的场景；反之需要一次给前端展示所有错误时，保留默认即可。

## 8. 统一处理入参异常

三类校验异常，加上发生在校验之前的反序列化异常 `HttpMessageNotReadableException`，都需要捕获：

```java
@RestControllerAdvice
public class WebRequestExceptionHandler {

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiResponse<Void>> handleUnreadable(HttpMessageNotReadableException ex) {
        return ResponseEntity.badRequest().body(ApiResponse.error("INVALID_JSON", "请求体不是合法的 JSON"));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleBody(MethodArgumentNotValidException ex) {
        List<ErrorDetail> errors = ex.getBindingResult().getFieldErrors().stream()
            .map(e -> new ErrorDetail(e.getField(), e.getDefaultMessage()))
            .collect(Collectors.toList());
        return ResponseEntity.badRequest().body(ApiResponse.error("VALIDATION_ERROR", errors));
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ApiResponse<Void>> handleConstraint(ConstraintViolationException ex) {
        List<ErrorDetail> errors = ex.getConstraintViolations().stream()
            .map(v -> new ErrorDetail(v.getPropertyPath().toString(), v.getMessage()))
            .collect(Collectors.toList());
        return ResponseEntity.badRequest().body(ApiResponse.error("VALIDATION_ERROR", errors));
    }

    @ExceptionHandler(BindException.class)
    public ResponseEntity<ApiResponse<Void>> handleBind(BindException ex) {
        List<ErrorDetail> errors = ex.getBindingResult().getFieldErrors().stream()
            .map(e -> new ErrorDetail(e.getField(), e.getDefaultMessage()))
            .collect(Collectors.toList());
        return ResponseEntity.badRequest().body(ApiResponse.error("VALIDATION_ERROR", errors));
    }
}
```

`ErrorDetail` 是自定义的内部类，避免与 Spring 自带的 `FieldError` 重名：

```java
@Data
@AllArgsConstructor
public class ErrorDetail {
    private String field;
    private String message;
}
```

**最佳实践：**

1. 校验字符串用 `@NotBlank`，集合用 `@NotEmpty`，只排 `null` 用 `@NotNull`
2. 嵌套对象必须加 `@Valid`，否则内部校验不生效
3. 方法级校验下沉到 Service 层，防止非 Web 入口绕过
4. 反序列化异常与三类校验异常分开捕获，避免遗漏 `HttpMessageNotReadableException`、`ConstraintViolationException` 和 `BindException`
5. 自定义校验器默认放行 `null`，空值判断交给 `@NotNull` 等注解
