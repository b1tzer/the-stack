---
type: tutorial
level: basic
---

# ASP.NET Core Minimal API：用最少的代码提供接口

本页带你把一个 Minimal API 应用从创建到跑通，理解请求如何绑定参数、如何返回响应、如何注入依赖。前置：能运行 `dotnet` 命令、会基础 C#。读完你能用 Minimal API 提供一个可访问的 HTTP 接口。

## 1. 创建并运行

用 .NET SDK 创建 Web 空项目并运行：

```txt
dotnet new web -o HelloApi
cd HelloApi
dotnet run
```

看到输出后访问 `http://localhost:5000`（实际端口以输出为准），返回：

```txt
Hello World!
```

默认模板的 `Program.cs` 就是这个最小应用。下面逐步拆解它。

## 2. 一个返回 JSON 的接口

`MapGet` 注册一个 GET 路由，返回的对象自动序列化为 JSON：

```csharp
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/weather", () => new
{
    City = "北京",
    Temperature = 18
});

app.Run();
```

访问 `/weather` 返回：

```json
{"city":"北京","temperature":18}
```

`MapGet` 的第一个参数是路由模板，第二个是处理函数，返回值由框架序列化为 JSON。这就是一个可用的 API 接口，无需控制器、无需配置序列化。

## 3. 参数绑定

Minimal API 从路由、查询字符串和请求体自动绑定参数：

```csharp
app.MapGet("/users/{id}", (int id) => $"用户 {id}");

app.MapGet("/search", (string? q) => $"搜索 {q}");
```

访问 `/users/42` 返回 `用户 42`；访问 `/search?q=dotnet` 返回 `搜索 dotnet`。路由模板中的 `{id}` 绑定到同名参数，查询字符串的 `q` 绑定到 `q` 参数。参数名必须匹配，类型不匹配（如 `/users/abc`）会返回 400。

## 4. 依赖注入

处理函数可以声明构造函数注入的服务，框架自动提供：

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<IClock, SystemClock>();
var app = builder.Build();

app.MapGet("/time", (IClock clock) => clock.Now.ToString());

app.Run();
```

`AddSingleton` 注册 `IClock` 的实现，`MapGet` 的处理函数声明 `IClock` 参数，框架在调用时注入实例。依赖注入的详细规则见[依赖注入](./chapter-05-dependency-injection.md)。

## 5. 处理请求体与状态码

读取 JSON 请求体需要从 `HttpContext` 或绑定模型：

```csharp
app.MapPost("/orders", async (Order order) =>
{
    var id = await SaveAsync(order);
    return Results.Created($"/orders/{id}", new { id });
});
```

`Order` 从请求体反序列化。`Results.Created` 返回 201 状态码和响应体；`Results.NotFound`、`Results.BadRequest` 等对应其他状态。返回 `Results` 类型让接口能精确控制状态码和响应。

## 6. Minimal API 与 MVC 的选择

Minimal API 适合简单的接口和微服务，代码少、启动快。当应用需要过滤器、模型绑定定制、大量控制器组织时，用 MVC（见[路由与 MVC](./chapter-03-mvc-routing.md)）更合适。两者共享同一个管道和依赖注入，可共存于一个应用。

## 7. 后续阅读

- [路由与 MVC](./chapter-03-mvc-routing.md)了解控制器的组织方式。
- [中间件管道](./chapter-04-middleware-pipeline.md)理解请求在到达路由前流经什么。
- [依赖注入](./chapter-05-dependency-injection.md)理解 `AddSingleton` 等服务生命周期。

> 本页的技术边界按 .NET 10 / C# 14 核对；Minimal API 自 .NET 6 引入。官方参考：[ASP.NET Core 文档](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/)。
