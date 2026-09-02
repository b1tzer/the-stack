# API 文档 (springdoc-openapi)

> 前后端分离项目，API 文档是前后端的契约。手写文档必然和代码不同步——接口改了文档没改，联调时互相甩锅。springdoc-openapi 通过扫描代码自动生成 OpenAPI 3.0 规范文档，提供 Swagger UI 在线调试。代码即文档，永远同步。

## 1. 依赖与配置

```xml
<dependency>
    <groupId>org.springdoc</groupId>
    <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
    <version>2.3.0</version>
</dependency>
<!-- WebFlux 用 springdoc-openapi-starter-webflux-ui -->
```

```yaml
springdoc:
  api-docs:
    enabled: true
    path: /v3/api-docs          # OpenAPI JSON 端点
  swagger-ui:
    enabled: true
    path: /swagger-ui.html      # Swagger UI 页面
    tags-sorter: alpha           # 按标签排序
    operations-sorter: method   # 按 HTTP 方法排序
  group-configs:
    - group: user
      paths-to-match: /api/users/**
    - group: order
      paths-to-match: /api/orders/**
```

启动后访问：
- Swagger UI: `http://localhost:8080/swagger-ui.html`
- OpenAPI JSON: `http://localhost:8080/v3/api-docs`

## 2. 基础注解

### 2.1 Controller 层

```java
@Tag(name = "用户管理", description = "用户 CRUD 接口")
@RestController
@RequestMapping("/api/users")
public class UserController {

    @Operation(summary = "查询用户列表", description = "分页查询所有用户")
    @GetMapping
    public Page<UserVO> listUsers(
            @ParameterObject Pageable pageable) {
        return userService.findAll(pageable);
    }

    @Operation(summary = "查询用户详情")
    @GetMapping("/{id}")
    public ResponseEntity<UserVO> getUser(
            @Parameter(description = "用户ID", example = "1001")
            @PathVariable Long id) {
        return userService.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @Operation(summary = "创建用户",
               responses = {
                   @ApiResponse(responseCode = "201", description = "创建成功"),
                   @ApiResponse(responseCode = "409", description = "用户名已存在")
               })
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public UserVO createUser(@Valid @RequestBody CreateUserDTO dto) {
        return userService.create(dto);
    }

    @Operation(summary = "删除用户")
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteUser(@PathVariable Long id) {
        userService.delete(id);
    }
}
```

### 2.2 Model 层

```java
@Schema(description = "用户视图对象")
@Data
public class UserVO {

    @Schema(description = "用户ID", example = "1001", accessMode = Schema.AccessMode.READ_ONLY)
    private Long id;

    @Schema(description = "用户名", example = "zhangsan", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank
    private String username;

    @Schema(description = "邮箱", example = "zhangsan@example.com")
    @Email
    private String email;

    @Schema(description = "手机号", example = "13800138000", pattern = "^1[3-9]\\d{9}$")
    private String phone;

    @Schema(description = "创建时间", accessMode = Schema.AccessMode.READ_ONLY)
    private LocalDateTime createdAt;
}

@Schema(description = "创建用户请求")
@Data
public class CreateUserDTO {

    @Schema(description = "用户名", example = "zhangsan", minLength = 3, maxLength = 50)
    @NotBlank @Size(min = 3, max = 50)
    private String username;

    @Schema(description = "邮箱", example = "zhangsan@example.com")
    @NotBlank @Email
    private String email;

    @Schema(description = "密码", example = "P@ssw0rd", minLength = 8)
    @NotBlank @Size(min = 8)
    private String password;
}
```

## 3. 全局配置

```java
@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI customOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("用户服务 API")
                        .version("1.0.0")
                        .description("用户管理系统的 RESTful API 文档")
                        .contact(new Contact()
                                .name("开发团队")
                                .email("dev@example.com"))
                        .license(new License()
                                .name("Apache 2.0")
                                .url("https://www.apache.org/licenses/LICENSE-2.0")))
                .addSecurityItem(new SecurityRequirement().addList("Bearer"))
                .components(new Components()
                        .addSecuritySchemes("Bearer",
                                new SecurityScheme()
                                        .type(SecurityScheme.Type.HTTP)
                                        .scheme("bearer")
                                        .bearerFormat("JWT")
                                        .description("JWT 认证 Token")))
                .servers(List.of(
                        new Server().url("http://localhost:8080").description("开发环境"),
                        new Server().url("https://api.example.com").description("生产环境")));
    }
}
```

## 4. 分组与过滤

### 4.1 按模块分组

```java
@Configuration
public class SpringDocConfig {

    @Bean
    public GroupedOpenApi userApi() {
        return GroupedOpenApi.builder()
                .group("用户模块")
                .pathsToMatch("/api/users/**")
                .build();
    }

    @Bean
    public GroupedOpenApi orderApi() {
        return GroupedOpenApi.builder()
                .group("订单模块")
                .pathsToMatch("/api/orders/**")
                .build();
    }
}
```

### 4.2 隐藏内部接口

```java
// 排除特定 Controller
@RestController
@RequestMapping("/internal")
@Hidden  // 不出现在文档中
public class InternalController { ... }

// 排除特定方法
@Operation(hidden = true)
@GetMapping("/debug")
public String debug() { ... }
```

## 5. 枚举与通用响应

### 5.1 枚举展示

```java
@Schema(description = "用户状态")
public enum UserStatus {
    @Schema(description = "正常")
    ACTIVE,
    @Schema(description = "禁用")
    DISABLED,
    @Schema(description = "已注销")
    CANCELLED
}
```

### 5.2 统一响应格式

```java
@Schema(description = "统一响应体")
@Data
public class Result<T> {

    @Schema(description = "状态码", example = "200")
    private int code;

    @Schema(description = "提示信息", example = "success")
    private String message;

    @Schema(description = "响应数据")
    private T data;

    @Schema(description = "响应时间戳")
    private long timestamp;

    public static <T> Result<T> ok(T data) {
        Result<T> r = new Result<>();
        r.setCode(200);
        r.setMessage("success");
        r.setData(data);
        r.setTimestamp(System.currentTimeMillis());
        return r;
    }
}
```

## 6. 安全配置

生产环境通常禁用 Swagger UI：

```java
@Configuration
@Profile("prod")
public class ProdSwaggerConfig {

    @Bean
    public OpenAPIBuilderCustomizer disableInProd() {
        return builder -> builder
                .addOpenApiCustomiser(openApi -> openApi.getInfo().setDescription("文档已禁用"));
    }
}
```

```yaml
# 生产环境配置
springdoc:
  api-docs:
    enabled: false
  swagger-ui:
    enabled: false
```

或通过注解条件控制：

```java
@Configuration
@ConditionalOnProperty(name = "springdoc.api-docs.enabled", havingValue = "true", matchIfMissing = true)
public class SwaggerConfig { ... }
```

**最佳实践：**

1. **代码即文档**——注解加在 DTO 和 Controller 上，保持文档和代码同步
2. **生产环境禁用**——Swagger UI 不应暴露在生产环境
3. **分组管理**——按模块分组，避免文档过长
4. **描述要写**——`summary` 和 `description` 是给人看的，不写等于没文档
5. **示例值**——`example` 字段让前端直接看到预期格式
6. **版本管理**——OpenAPI `info.version` 和应用版本保持一致
