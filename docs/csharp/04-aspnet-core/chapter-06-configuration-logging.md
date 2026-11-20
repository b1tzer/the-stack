---
type: explanation
level: intermediate
---

# ASP.NET Core 配置与日志：管理外部输入与运行状态

本页回答三个问题：配置从哪里来、如何按环境覆盖，`IOptions<T>` 如何把配置转成强类型，结构化日志如何记录。配置与日志是应用可观测和可部署的基础。

## 1. 配置来源

ASP.NET Core 从多个来源按优先级合并配置，后者覆盖前者：

```txt
appsettings.json → appsettings.{Environment}.json → 环境变量 → 命令行参数
```

`appsettings.json` 存默认配置，`appsettings.Production.json` 存生产环境覆盖值，环境变量（如 `ConnectionStrings__Default`）再覆盖——这使同一个构建产物能适配不同环境，凭据用环境变量注入而不写进代码仓库。

## 2. 读取配置

`IConfiguration` 以键值形式读取：

```csharp
var conn = app.Configuration.GetConnectionString("Default");
```

配置键是层级化的：`appsettings.json` 里的 `{"Database":{"Timeout":30}}` 用 `Database:Timeout` 读取。环境变量用双下划线 `__` 表示层级。

## 3. Options 模式

`IOptions<T>` 把配置绑定到强类型对象，避免到处散落字符串键：

```csharp
public class DatabaseOptions
{
    public string ConnectionString { get; set; }
    public int Timeout { get; set; }
}

builder.Services.Configure<DatabaseOptions>(
    builder.Configuration.GetSection("Database"));
```

注入使用：

```csharp
public class Repository
{
    public Repository(IOptions<DatabaseOptions> options)
    {
        var timeout = options.Value.Timeout;
    }
}
```

`IOptions<T>` 的实例在配置改变后不会自动更新；需要运行时刷新用 `IOptionsSnapshot<T>`（Scoped）或 `IOptionsMonitor<T>`（可订阅变更）。强类型配置让拼写错误在绑定时暴露，而不是运行到某处才发现。

## 4. 结构化日志

`ILogger<T>` 提供结构化日志，`{...}` 是命名占位符，日志系统把它作为结构化字段保留：

```csharp
public class OrderService
{
    private readonly ILogger<OrderService> logger;

    public OrderService(ILogger<OrderService> logger) => this.logger = logger;

    public void Create(Order order)
    {
        logger.LogInformation("创建订单 {OrderId}，金额 {Amount}",
            order.Id, order.Amount);
    }
}
```

结构化日志的价值在于：`OrderId` 和 `Amount` 是可查询的字段，而不是拼进字符串里的文本。日志系统可以按字段过滤、聚合，而不是靠正则解析文本。

## 5. 日志级别

日志按级别过滤，从低到高：

```txt
Trace < Debug < Information < Warning < Error < Critical
```

配置里按类别设置最低级别：

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  }
}
```

生产环境通常把框架日志设为 `Warning`，自己的业务日志设为 `Information`，避免被框架噪音淹没。不要把 `Trace`/`Debug` 开在生产环境，会拖慢性能并产生海量日志。

## 6. 后续阅读

- [依赖注入](./chapter-05-dependency-injection.md)解释 `IOptions<T>` 与 `ILogger` 的注入。
- [诊断](../07-diagnostics/index.md)了解如何用日志和指标排查生产问题。
- [中间件管道](./chapter-04-middleware-pipeline.md)解释请求级日志的落点。

> 本页的技术边界按 .NET 10 / C# 14 核对；`IOptionsMonitor` 支持配置热更新。官方参考：[ASP.NET Core 文档](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/)、[日志](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/logging/)。
