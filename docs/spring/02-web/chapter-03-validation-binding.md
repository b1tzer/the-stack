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

`@Valid` 加在 `@RequestBody` 参数上时，`RequestResponseBodyMethodProcessor` 在反序列化完成后调用校验器；校验失败抛出 `MethodArgumentNotValidException`，进入第 8 节的异常处理链路。

## 4. 三种入口，三种异常

校验发生在不同的入口，抛出的异常类型不同：

| 校验入口 | 抛出的异常 | 说明 |
| :-- | :-- | :-- |
| `@Valid @RequestBody` | `MethodArgumentNotValidException` | 请求体校验失败 |
| `@Validated` 方法参数（Service 层） | `ConstraintViolationException` | 方法级校验失败 |
| `@Valid @ModelAttribute` 表单绑定 | `BindException` | 表单对象绑定 + 校验失败 |

新手最容易漏掉后两个：全局处理器只写了 `MethodArgumentNotValidException`，Service 层方法校验或表单绑定失败时异常无人接管，最终变成 500 或静默丢失校验错误。第 8 节会给出三个异常一起处理的完整写法。

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

`@RequestBody` 走的是 JSON 反序列化（Jackson），不经过数据绑定；真正发生数据绑定的是 `@ModelAttribute` 表单参数和查询参数：

```txt
HTTP 请求参数（String）
    │
    ▼
PropertyEditor（JavaBeans 标准，单个类型 String → 目标类型）
    │
    ▼
ConversionService（Spring 3.0+ 类型转换体系，支持泛型，优先于 PropertyEditor）
    │
    ▼
WebDataBinder（绑定 + 校验 + 结果收集）
    │
    ▼
BindingResult（绑定错误 + 校验错误）
```

`WebDataBinder` 是绑定的核心，通过 `@InitBinder` 可以在绑定前定制规则：

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

`setDisallowedFields("id")` 防的是"批量赋值"：攻击者往表单里塞 `id=1`，若不加限制，会直接绑定到对象的 `id` 字段并覆盖原值。参数解析器本身的机制详见 [Spring MVC](./chapter-01-spring-mvc.md) §3，本章只讲绑定这一层。

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

## 8. 统一处理校验异常

三类校验异常需要分别捕获，字段级错误统一提取成结构化的响应：

```java
@RestControllerAdvice
public class ValidationExceptionHandler {

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
4. 三个入口的异常分开捕获，避免遗漏 `ConstraintViolationException` 和 `BindException`
5. 自定义校验器默认放行 `null`，空值判断交给 `@NotNull` 等注解
