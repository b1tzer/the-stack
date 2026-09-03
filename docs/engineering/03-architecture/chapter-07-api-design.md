# API 设计

> 本章关注「怎么设计一个好的 API」，不绑定具体框架。Spring 实现细节参见 [Spring MVC](/spring/03-web/chapter-01-spring-mvc) 和 [API 文档](/spring/03-web/chapter-10-api-doc)。

## 1. RESTful 核心思想

REST 不是协议，是一组架构约束。核心就一条：**URL 表示资源，HTTP 动词表示操作。**

```txt
GET    /users          # 列表
GET    /users/{id}     # 详情
POST   /users          # 创建
PUT    /users/{id}     # 全量更新
PATCH  /users/{id}     # 部分更新
DELETE /users/{id}     # 删除
```

类比文件系统：路径是文件（资源），GET 是读，POST 是新建，PUT 是覆盖写，DELETE 是删除。不需要在路径里加 `getFile`、`createFile`——操作由动词表达，路径只负责定位资源。

## 2. URL 命名规范

```java
// ✅ 名词复数，层级表示归属关系
GET    /api/v1/users
GET    /api/v1/users/{id}
GET    /api/v1/users/{id}/orders    // 用户的订单

// ❌ 动词出现在 URL 里
GET    /api/v1/getUser
POST   /api/v1/createOrder
GET    /api/v1/user/delete/{id}

// ❌ 单数名词
GET    /api/v1/user/{id}
```

过滤、排序、分页用查询参数：

```txt
GET /api/v1/users?status=active&sort=created_at,desc&page=1&size=20
```

## 3. HTTP 状态码

状态码是 API 和调用方的契约。用错了，调用方的错误处理就会出问题。

| 状态码 | 含义 | 典型场景 |
| :-- | :-- | :-- |
| 200 | OK | GET 成功、PUT/PATCH 更新成功 |
| 201 | Created | POST 创建成功 |
| 204 | No Content | DELETE 成功，无需返回体 |
| 400 | Bad Request | 请求参数格式错误、JSON 解析失败 |
| 401 | Unauthorized | 未认证（缺少或无效的 Token） |
| 403 | Forbidden | 已认证但无权限 |
| 404 | Not Found | 资源不存在 |
| 409 | Conflict | 资源状态冲突（如重复创建） |
| 422 | Unprocessable Entity | 参数格式正确但业务校验失败 |
| 429 | Too Many Requests | 触发限流 |
| 500 | Internal Server Error | 服务端未知异常 |

常见错误：用 200 包裹错误信息。这会让调用方无法通过状态码判断请求是否成功，必须解析响应体才能知道结果。

```json
// ❌ 用 200 包裹错误
{ "code": 200, "message": "用户不存在", "data": null }

// ✅ 用 404 表达语义
// HTTP/1.1 404 Not Found
{ "code": "USER_NOT_FOUND", "message": "用户不存在", "path": "/api/v1/users/999" }
```

## 4. 统一响应格式

所有接口返回相同结构的 JSON，前端只需要写一套解析逻辑。

```java
public class ApiResponse<T> {
    private int code;
    private String message;
    private T data;
    private long timestamp;

    public static <T> ApiResponse<T> success(T data) {
        ApiResponse<T> resp = new ApiResponse<>();
        resp.code = 200;
        resp.message = "success";
        resp.data = data;
        resp.timestamp = System.currentTimeMillis();
        return resp;
    }

    public static <T> ApiResponse<T> error(int code, String message) {
        ApiResponse<T> resp = new ApiResponse<>();
        resp.code = code;
        resp.message = message;
        resp.timestamp = System.currentTimeMillis();
        return resp;
    }
}
```

分页响应单独封装：

```java
public class PageResponse<T> {
    private List<T> data;
    private long total;
    private int page;
    private int size;
    private int totalPages;
}
```

## 5. 错误响应

错误响应要包含足够信息，让调用方能定位问题，但不能暴露服务端内部细节。

```json
{
  "code": "VALIDATION_ERROR",
  "message": "参数校验失败",
  "path": "/api/v1/users",
  "timestamp": "2026-08-26T20:00:00",
  "details": [
    { "field": "email", "message": "邮箱格式不正确", "rejectedValue": "abc" }
  ]
}
```

设计原则：

- `code` 用业务错误码（字符串），不要用 HTTP 状态码重复一遍
- `message` 给人看，不是给机器解析的
- `details` 只在参数校验等场景返回，普通错误不需要
- 不要返回堆栈信息、SQL 语句、内部类名

## 6. 版本管理

三种方式，各有适用场景：

| 方式 | 示例 | 适用场景 |
| :-- | :-- | :-- |
| URL 路径 | `/api/v1/users` | 内部系统、多数项目首选 |
| 请求头 | `X-API-VERSION: 2` | 对外 API、不想污染 URL |
| 媒体类型 | `Accept: application/vnd.myapp.v2+json` | 对外 API、GitHub 风格 |

版本兼容原则：

- 新增字段：向后兼容，不需要新版本
- 删除字段：需要新版本，旧版本保留一段时间
- 修改字段含义：必须新版本

## 7. 接口幂等性

同一个请求执行多次，结果一致。这不是可选项——网络超时重试、用户双击提交，都会导致重复请求。

| HTTP 方法 | 天然幂等 | 说明 |
| :-- | :-- | :-- |
| GET | ✅ | 读操作，无副作用 |
| PUT | ✅ | 全量替换，执行多次结果相同 |
| PATCH | ⚠️ | 取决于实现（`set name=x` 幂等，`count += 1` 不幂等） |
| DELETE | ✅ | 删除多次结果相同 |
| POST | ❌ | 每次创建新资源，需要额外处理 |

POST 幂等的实现方式——幂等键：

```java
@PostMapping("/api/v1/orders")
public ApiResponse<Long> createOrder(
        @RequestBody CreateOrderRequest request,
        @RequestHeader("Idempotent-Key") String idempotentKey) {
    Order existing = orderRepository.findByIdempotentKey(idempotentKey);
    if (existing != null) {
        return ApiResponse.success(existing.getId());
    }
    Long orderId = orderService.createOrder(request, idempotentKey);
    return ApiResponse.success(orderId);
}
```

## 8. 内容协商

同一个资源可以返回 JSON 或 XML，由请求头 `Accept` 决定：

```txt
Accept: application/json  →  JSON 响应
Accept: application/xml   →  XML 响应
```

大多数项目只需要 JSON，不需要为「可能有人要 XML」增加维护成本。如果确实需要，在框架层面配置（参见 [Spring MVC 内容协商](/spring/03-web/chapter-01-spring-mvc)）。

## 9. HATEOAS

REST 成熟度模型（Richardson Maturity Model）：

```txt
Level 0: 用 HTTP 做远程调用（RPC 风格）
Level 1: 引入资源概念
Level 2: 正确使用 HTTP 动词和状态码  ← 大多数项目在这里
Level 3: 超媒体驱动（HATEOAS）
```

HATEOAS 在响应中包含相关操作的链接，客户端通过链接发现功能，而不是硬编码 URL：

```json
{
  "id": 1,
  "name": "张三",
  "links": [
    { "rel": "self",    "href": "/api/v1/users/1" },
    { "rel": "orders",  "href": "/api/v1/users/1/orders" },
    { "rel": "update",  "href": "/api/v1/users/1", "method": "PUT" }
  ]
}
```

大多数项目不需要 HATEOAS。它增加了响应体积和实现复杂度，收益只在 API 需要高度可发现性时才明显。内部系统用 Level 2 就够了。

## 10. API 文档

文档必须和代码同步。手写文档必然过时——接口改了文档没改，联调时互相甩锅。

| 工具 | 特点 |
| :-- | :-- |
| Swagger/OpenAPI | 注解驱动，自动生成，主流选择 |
| API Blueprint | Markdown 语法，轻量 |
| RAML | YAML 语法，设计优先 |

Spring 项目用 springdoc-openapi 自动生成 OpenAPI 3.0 文档，参见 [API 文档](/spring/03-web/chapter-10-api-doc)。

> **API 设计的核心**：好的 API 应该是自解释的、一致的、向后兼容的。API 是你和其他开发者的契约，设计时要站在调用者的角度思考。
