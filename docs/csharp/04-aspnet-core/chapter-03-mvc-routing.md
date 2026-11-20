---
type: explanation
level: intermediate
---

# ASP.NET Core 路由与 MVC：控制器如何映射请求

本页回答三个问题：路由如何把 HTTP 请求映射到处理方法，控制器如何组织逻辑，模型绑定如何把请求数据转成参数。Minimal API 见[Minimal API](./chapter-02-minimal-api.md)。

## 1. 路由

路由把请求的路径和 HTTP 方法映射到处理方法。属性路由直接在控制器上声明：

```csharp
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet("{id}")]
    public ActionResult<User> Get(int id) { /* ... */ }

    [HttpPost]
    public ActionResult<User> Create(User user) { /* ... */ }
}
```

`[Route("api/[controller]")]` 用控制器名 `Users` 生成前缀 `api/Users`，`[HttpGet("{id}")]` 匹配 `GET api/Users/{id}`，`[HttpPost]` 匹配 `POST api/Users`。路由模板里的 `{id}` 绑定到方法参数。

## 2. 控制器

控制器是 `ControllerBase` 的派生类，每个动作（action）对应一个 HTTP 请求。`[ApiController]` 启用 API 约定：自动模型验证、自动推断请求体来源等。

控制器按资源组织（`UsersController` 处理用户相关请求），比 Minimal API 更适合有大量端点、需要共享过滤器或模型绑定的应用。

## 3. 模型绑定

模型绑定从路由、查询字符串、请求体等处提取数据并转换为参数：

```csharp
[HttpGet]
public ActionResult<List<User>> Search(
    [FromQuery] string? name,
    [FromHeader] string? apiKey)
{ /* ... */ }
```

`[FromQuery]`、`[FromHeader]`、`[FromRoute]`、`[FromBody]` 显式指定数据来源。`[ApiController]` 下复杂类型默认从请求体绑定，简单类型默认从查询字符串绑定。

绑定失败（如 `/users/abc` 无法转成 `int`）返回 400。模型验证通过数据注解声明：

```csharp
public class User
{
    [Required]
    public string Name { get; set; }

    [Range(1, 150)]
    public int Age { get; set; }
}
```

`[ApiController]` 自动在动作执行前校验，不满足时返回 400，动作不会执行。

## 4. 返回类型

动作可以返回 `ActionResult<T>`、`IActionResult` 或具体类型：

```csharp
[HttpGet("{id}")]
public ActionResult<User> Get(int id)
{
    var user = Find(id);
    if (user is null)
    {
        return NotFound();       // 404
    }
    return Ok(user);             // 200 + JSON
}
```

返回 `ActionResult` 能精确表达状态码；返回具体类型则默认 200。找不到资源返回 `NotFound()` 而不是 200 + null，是 REST 语义的基本要求。

## 5. 异步动作

涉及 I/O 的动作应是异步的（见[为什么需要异步](../03-csharp-concurrency/chapter-01-why-async.md)）：

```csharp
[HttpGet("{id}")]
public async Task<ActionResult<User>> Get(int id, CancellationToken ct)
{
    var user = await FindAsync(id, ct);
    return user is null ? NotFound() : Ok(user);
}
```

`CancellationToken` 由框架注入，请求中止时自动触发取消，避免继续处理已断开的请求。

## 6. 后续阅读

- [中间件管道](./chapter-04-middleware-pipeline.md)理解请求在到达控制器前流经什么。
- [依赖注入](./chapter-05-dependency-injection.md)理解控制器如何获得服务。
- [数据访问](../06-data-access/chapter-02-ef-core.md)理解动作里如何查询数据库。

> 本页的技术边界按 .NET 10 / C# 14 核对；`[ApiController]` 自 ASP.NET Core 2.1 引入。官方参考：[ASP.NET Core 文档](https://learn.microsoft.com/en-us/aspnet/core/mvc/)。
