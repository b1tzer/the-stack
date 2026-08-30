# RESTful API 设计

> URL 写成 `/getUser?id=1`、`/deleteUser?id=1`、`/user/save`——能跑，但不是 REST。REST 不是规范，是 Roy Fielding 在博士论文里提出的架构风格。它用资源、动词、状态码三个维度描述 HTTP 交互，让 API 自描述、可预测、易演化。本章讲 REST 的核心原则、成熟度模型、HATEOAS，以及 API 版本控制的工程实践。

## 1. REST 语义与资源建模

### 1.1 URL 设计原则

RESTful URL 的核心是**名词 + 复数 + 层级**，操作由 HTTP 动词表达：

| 原则 | ✅ 正确 | ❌ 错误 | 说明 |
| :-- | :-- | :-- | :-- |
| 用名词，不用动词 | `GET /users` | `GET /getUsers` | 动词由 HTTP 方法表达 |
| 复数形式 | `/users/1` | `/user/1` | 资源是集合，单个是集合的特例 |
| 层级关系 | `/users/1/orders` | `/getUserOrders?userId=1` | 子资源用路径表达从属关系 |
| HTTP 动词表操作 | `DELETE /users/1` | `POST /deleteUser?id=1` | 不要把动词塞进 URL |
| 小写 + 连字符 | `/user-profiles` | `/userProfiles` | 遵循 URL 惯例 |

### 1.2 HTTP 动词语义

| 动词 | 语义 | 幂等 | 安全 | 示例 |
| :-- | :-- | :-- | :-- | :-- |
| `GET` | 查询资源 | ✅ | ✅ | `GET /users/1` → 200 + 用户 JSON |
| `POST` | 创建资源 | ❌ | ❌ | `POST /users` → 201 + 新用户 |
| `PUT` | 全量替换 | ✅ | ❌ | `PUT /users/1` → 200 + 更新后用户 |
| `PATCH` | 部分更新 | ✅ | ❌ | `PATCH /users/1` → 200 |
| `DELETE` | 删除资源 | ✅ | ❌ | `DELETE /users/1` → 204 |

**幂等**的含义：同一个请求执行一次和执行多次，结果一样。`PUT /users/1` 设 name=zhangsan，调 10 次结果还是 zhangsan。`POST /users` 调 10 次会创建 10 条记录。

**安全**的含义：请求不会修改服务器状态。`GET` 是唯一安全的动词。

### 1.3 状态码语义

| 状态码 | 含义 | 典型场景 |
| :-- | :-- | :-- |
| `200 OK` | 成功 | GET/PUT/PATCH 成功 |
| `201 Created` | 已创建 | POST 创建资源成功 |
| `204 No Content` | 成功，无响应体 | DELETE 成功 |
| `400 Bad Request` | 请求参数错误 | 校验失败 |
| `401 Unauthorized` | 未认证 | Token 缺失或无效 |
| `403 Forbidden` | 无权限 | 已认证但权限不足 |
| `404 Not Found` | 资源不存在 | ID 找不到记录 |
| `409 Conflict` | 资源冲突 | 唯一键重复 |
| `422 Unprocessable Entity` | 语义错误 | JSON 格式正确但业务校验失败 |
| `500 Internal Server Error` | 服务端异常 | 未捕获的运行时异常 |

```java
// Controller 中的状态码使用
@RestController
@RequestMapping("/api/users")
public class UserController {

    @GetMapping("/{id}")
    public ResponseEntity<User> getUser(@PathVariable Long id) {
        return userService.findById(id)
                .map(ResponseEntity::ok)                           // 200
                .orElse(ResponseEntity.notFound().build());        // 404
    }

    @PostMapping
    public ResponseEntity<User> createUser(@Valid @RequestBody UserDTO dto) {
        User saved = userService.create(dto);
        URI location = URI.create("/api/users/" + saved.getId());
        return ResponseEntity.created(location).body(saved);       // 201 + Location 头
    }

    @PutMapping("/{id}")
    public ResponseEntity<User> updateUser(@PathVariable Long id,
                                           @Valid @RequestBody UserDTO dto) {
        return ResponseEntity.ok(userService.update(id, dto));     // 200
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteUser(@PathVariable Long id) {
        userService.delete(id);
        return ResponseEntity.noContent().build();                 // 204
    }
}
```

> **踩坑提醒**：`POST` 成功返回 `201 Created`，响应头中应包含 `Location` 指向新创建的资源地址。不要用 `200` 返回创建结果——`201` 更精确，客户端可以通过 `Location` 头直接跳转到新资源。

---

## 2. Richardson 成熟度模型

Leonard Richardson 提出的四级成熟度模型，用来评估 API 的 RESTful 程度：

| 级别 | 特征 | 示例 | 现实中的占比 |
| :-- | :-- | :-- | :-- |
| **Level 0** | 一个 URL + POST | `POST /api` → `{"action":"getUser","id":1}` | SOAP、RPC 风格 |
| **Level 1** | 多个 URL（资源） | `GET /users/1`、`POST /users` | 有资源概念，但动词混用 |
| **Level 2** | HTTP 动词 + 状态码 | `DELETE /users/1` → 204 | **大多数生产 API** |
| **Level 3** | HATEOAS（超媒体驱动） | 响应中包含相关操作链接 | 少数成熟 API |

### 2.1 各级别详解

**Level 0——单端点 RPC**

```json
// 请求
POST /api
{
    "action": "getUser",
    "params": { "id": 1 }
}
// 响应
{ "id": 1, "name": "zhangsan" }
```

问题：所有操作走一个 URL，无法利用 HTTP 缓存、负载均衡、安全策略。

**Level 1——资源分离**

```text
GET  /users/1
POST /users
POST /users/1/delete     ← 还是用了 POST 做删除
```

问题：没有正确使用 HTTP 动词，语义不清晰。

**Level 2——HTTP 语义化**

```text
GET    /users/1    → 200 + JSON
POST   /users      → 201 + Location
PUT    /users/1    → 200 + 更新后 JSON
DELETE /users/1    → 204 No Content
```

这是**务实的做法**——充分利用 HTTP 协议的语义，大多数团队应该达到这个级别。

**Level 3——HATEOAS**

```json
{
    "id": 1,
    "name": "zhangsan",
    "_links": {
        "self":   { "href": "/api/users/1" },
        "orders": { "href": "/api/users/1/orders" },
        "update": { "href": "/api/users/1", "method": "PUT" },
        "delete": { "href": "/api/users/1", "method": "DELETE" }
    }
}
```

客户端通过响应中的链接发现可用操作，不需要硬编码 API 路径。

> **踩坑提醒**：不需要死守所有 REST 原则。务实的做法是至少达到 Level 2，根据项目需要决定是否做 Level 3。Level 3 的 HATEOAS 增加了响应体积和开发成本，适合面向公众的开放 API，内部微服务间调用通常不需要。

---

## 3. HATEOAS 与超媒体

### 3.1 为什么需要 HATEOAS

传统 API 的问题：客户端硬编码所有 URL 路径。API 路径变了，所有客户端都要改。

HATEOAS（Hypermedia As The Engine Of Application State）的核心思想：**响应中包含下一步可执行操作的链接**，客户端通过链接导航，而非硬编码路径。

### 3.2 Spring HATEOAS 实战

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-hateoas</artifactId>
</dependency>
```

```java
// 资源表示
public class UserRepresentation extends RepresentationModel<UserRepresentation> {
    private Long id;
    private String username;
    private String email;

    public UserRepresentation(User user) {
        this.id = user.getId();
        this.username = user.getUsername();
        this.email = user.getEmail();
    }
}

// Controller
@RestController
@RequestMapping("/api/users")
public class UserController {

    @GetMapping("/{id}")
    public UserRepresentation getUser(@PathVariable Long id) {
        User user = userService.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException(id));

        UserRepresentation rep = new UserRepresentation(user);

        // 自链接
        rep.add(linkTo(methodOn(UserController.class).getUser(id)).withSelfRel());
        // 关联资源链接
        rep.add(linkTo(methodOn(UserController.class).getOrders(id)).withRel("orders"));
        // 集合链接
        rep.add(linkTo(methodOn(UserController.class).listUsers()).withRel("users"));

        return rep;
    }
}
```

响应示例：

```json
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

### 3.3 HATEOAS 的适用场景

| 场景 | 是否需要 HATEOAS | 理由 |
| :-- | :-- | :-- |
| 面向公众的开放 API | ✅ 推荐 | 第三方开发者通过链接发现功能 |
| 微服务间内部调用 | ❌ 不需要 | 服务间约定固定，链接增加无谓开销 |
| 前后端分离 BFF | ❌ 不需要 | 前端通常硬编码路径，链接没人用 |
| 快速迭代的 MVP | ❌ 不需要 | 增加开发成本，收益不明显 |

> **踩坑提醒**：HATEOAS 增加了响应体积和开发成本。Spring HATEOAS 的 `RepresentationModel` 会自动序列化 `_links` 字段，但如果前端从未使用这些链接，就是在浪费带宽。务实的做法：先做好 Level 2，等 API 稳定且有开放需求时再考虑 HATEOAS。

---

## 4. API 版本控制

### 4.1 为什么需要版本控制

API 变更是不可避免的。向后兼容的改动（加字段、加接口）不需要新版本。但以下场景必须引入版本：

- 删除字段或接口
- 修改字段类型
- 修改字段语义
- 修改认证方式

### 4.2 三种版本控制方案

| 方案 | 示例 | 优点 | 缺点 |
| :-- | :-- | :-- | :-- |
| **URL 路径** | `GET /api/v1/users` | 简单直观，便于缓存和路由 | URL 膨胀，不够「RESTful」 |
| **请求头** | `X-API-Version: 1` | URL 干净 | 不直观，调试不便，浏览器难测 |
| **MediaType** | `Accept: application/vnd.app.v1+json` | 最 RESTful | 复杂，浏览器不好测 |

### 4.3 URL 路径方案（推荐）

最简单、最直观，团队认知成本最低：

```java
@RestController
@RequestMapping("/api/v1/users")
public class UserV1Controller {

    @GetMapping("/{id}")
    public UserV1 getUser(@PathVariable Long id) {
        User user = userService.findById(id);
        return new UserV1(user.getId(), user.getName());
    }
}

@RestController
@RequestMapping("/api/v2/users")
public class UserV2Controller {

    @GetMapping("/{id}")
    public UserV2 getUser(@PathVariable Long id) {
        User user = userService.findById(id);
        return new UserV2(user.getId(), user.getFirstName(),
                          user.getLastName(), user.getEmail());
    }
}
```

版本演进策略：

```text
/api/v1/users  ← 老客户端继续使用，不变
/api/v2/users  ← 新客户端使用新格式
```

### 4.4 MediaType 方案

更 RESTful，但复杂度高：

```java
@RestController
@RequestMapping("/api/users")
public class UserController {

    @GetMapping(value = "/{id}", produces = "application/vnd.app.v1+json")
    public UserV1 getUserV1(@PathVariable Long id) { /* ... */ }

    @GetMapping(value = "/{id}", produces = "application/vnd.app.v2+json")
    public UserV2 getUserV2(@PathVariable Long id) { /* ... */ }
}
```

客户端通过 `Accept` 头指定版本：

```text
GET /api/users/1
Accept: application/vnd.app.v2+json
```

### 4.5 版本控制最佳实践

```text
是否需要新版本？
│
├── 只是加字段 / 加接口？ ─── 否 → 不需要新版本
│
├── 删除字段？ ─── 是 → 新版本
│
├── 修改字段类型？ ─── 是 → 新版本
│
└── 修改字段语义？ ─── 是 → 新版本
```

| 实践 | 说明 |
| :-- | :-- |
| 不要为了版本而版本 | 向后兼容的改动不需要新版本 |
| 旧版本保留过渡期 | 至少 6 个月，通知客户端迁移 |
| 版本号用整数 | `v1`、`v2`，不要用 `v1.1`、`v1.2` |
| 文档标注废弃 | 用 `@Deprecated` + Swagger `@ApiOperation(notes = "Deprecated: use v2")` |
| 统一版本策略 | 全项目一致，不要部分 API 用 URL、部分用 Header |

> **踩坑提醒**：不要为了版本而版本。只有当新旧接口不兼容时才需要版本控制。向后兼容的改动（加字段、加接口）不需要新版本。推荐 URL 路径方案——简单、直觉、团队认知成本最低。

---

## 5. 分页、过滤与排序

RESTful API 的集合查询需要处理分页、过滤、排序三个问题。

### 5.1 分页

```java
// 请求
GET /api/users?page=1&size=20

// 响应
{
    "content": [...],
    "page": 1,
    "size": 20,
    "totalElements": 156,
    "totalPages": 8
}
```

Spring Data 的 `Pageable` 自动解析：

```java
@GetMapping
public Page<User> listUsers(@PageableDefault(size = 20) Pageable pageable) {
    return userService.findAll(pageable);
}
```

### 5.2 过滤

```java
// 请求
GET /api/users?status=ACTIVE&role=ADMIN

// Controller
@GetMapping
public Page<User> listUsers(
        @RequestParam(required = false) String status,
        @RequestParam(required = false) String role,
        Pageable pageable) {
    return userService.findByCondition(status, role, pageable);
}
```

### 5.3 排序

```java
// 请求
GET /api/users?sort=createdAt,desc&sort=name,asc

// Spring Data 自动解析
@GetMapping
public Page<User> listUsers(Pageable pageable) {
    // pageable.getSort() 自动包含排序信息
    return userService.findAll(pageable);
}
```

---

## 6. API 文档

### 6.1 Springdoc OpenAPI (Swagger)

```xml
<dependency>
    <groupId>org.springdoc</groupId>
    <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
    <version>2.3.0</version>
</dependency>
```

```java
@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI customOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("用户管理 API")
                        .version("1.0")
                        .description("用户管理系统的 RESTful API 文档"))
                .addSecurityItem(new SecurityRequirement().addList("bearerAuth"))
                .components(new Components()
                        .addSecuritySchemes("bearerAuth",
                                new SecurityScheme()
                                        .type(SecurityScheme.Type.HTTP)
                                        .scheme("bearer")
                                        .bearerFormat("JWT")));
    }
}
```

启动后访问 `http://localhost:8080/swagger-ui.html` 查看交互式 API 文档。

> **踩坑提醒**：生产环境不要暴露 Swagger UI。通过 `springdoc.swagger-ui.enabled=false` 或 `@Profile("!prod")` 条件关闭。API 文档是给开发者看的，不是给攻击者看的。
