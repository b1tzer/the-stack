---
type: explanation
level: basic
---

# ASP.NET Core：跨平台 Web 框架

本页回答三个问题：ASP.NET Core 是什么，它与旧的 ASP.NET 有何不同，什么场景适合用它。语言机制见[认识 .NET 与 C#](../01-csharp-language/chapter-01-why-csharp.md)。

## 1. ASP.NET Core 是什么

ASP.NET Core 是 .NET 上构建 Web 应用和 API 的跨平台框架。它运行在 .NET 运行时之上，提供 HTTP 服务器、请求处理管道、路由、依赖注入等基础设施：

```txt
HTTP 请求 → Kestrel（HTTP 服务器）→ 中间件管道 → 路由 → 业务处理 → 响应
```

它既服务 API（返回 JSON），也支持服务端渲染（Razor Pages / MVC 视图）、实时通信（SignalR）和 gRPC。

## 2. 与旧 ASP.NET 的区别

ASP.NET Core 是 2016 年推出的重写版本，与运行在 .NET Framework 上的旧 ASP.NET 有本质区别：

| | 旧 ASP.NET | ASP.NET Core |
| :-- | :-- | :-- |
| 运行时 | 仅 Windows，.NET Framework | 跨平台，.NET |
| 模块化 | 依赖整机 IIS | 自包含、可独立部署 |
| 性能 | 一般 | 显著更高（Kestrel + 异步） |
| 配置 | web.config 为主 | appsettings + 环境变量等 |

旧 ASP.NET（含 Web Forms）已进入维护，新项目应使用 ASP.NET Core。

## 3. 何时用 ASP.NET Core

- **Web API**：为前后端分离的 Web/移动应用提供 JSON 接口。
- **微服务**：轻量、可独立部署、跨平台。
- **服务端渲染**：Razor Pages / MVC 生成 HTML。
- **实时应用**：SignalR 的 WebSocket 通信。

它适合需要 HTTP 服务、且希望利用 .NET 生态（EF Core、依赖注入、异步）的场景。

## 4. 一个最小应用

创建 Web 应用后，`Program.cs` 是这样的结构：

```csharp
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/", () => "Hello, World!");

app.Run();
```

`WebApplication.CreateBuilder` 初始化配置、日志、依赖注入容器；`builder.Build()` 组装管道；`MapGet` 注册路由；`Run()` 启动监听。这就是 Minimal API 的骨架，详见[Minimal API](./chapter-02-minimal-api.md)。

启动后访问根路径返回 `Hello, World!`。执行 `dotnet run` 会监听默认地址（如 `http://localhost:5000`），这是验证环境是否可用的最快方式。

## 5. 与 Spring 的对照

熟悉 Spring 的读者可以这样对应：ASP.NET Core 的中间件管道对应 Spring 的过滤器/拦截器链；依赖注入容器对应 Spring IoC；`Program.cs` 的注册对应 `@Configuration`/`@Bean`；EF Core 对应 JPA/Hibernate。但 ASP.NET Core 更强调「约定 + 内置」而不是 XML/注解驱动的装配。

## 6. 后续阅读

- [Minimal API](./chapter-02-minimal-api.md)解释最简的 API 写法。
- [路由与 MVC](./chapter-03-mvc-routing.md)解释控制器与路由。
- [中间件管道](./chapter-04-middleware-pipeline.md)解释请求如何流经各中间件。
- [依赖注入](./chapter-05-dependency-injection.md)解释服务的生命周期与注入。

> 本页的技术边界按 .NET 10 / C# 14 核对；ASP.NET Core 自 2016 年发布，跨平台自 1.0 起。官方参考：[ASP.NET Core 文档](https://learn.microsoft.com/en-us/aspnet/core/)。
