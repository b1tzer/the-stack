---
type: explanation
level: intermediate
---

# ASP.NET Core 依赖注入：生命周期与注入

本页回答三个问题：依赖注入（DI）解决什么问题，三种服务生命周期如何选择，跨生命周期引用会出什么错。这是 ASP.NET Core 应用组织代码的基础。

## 1. 依赖注入解决什么

依赖注入把「创建依赖」的责任从类内部移到外部容器。类只声明它需要什么，由容器在调用时提供：

```csharp
public class OrderService
{
    private readonly IOrderRepository repository;

    public OrderService(IOrderRepository repository) => this.repository = repository;
}
```

`OrderService` 不自己 `new` 出 `IOrderRepository` 的实现，而是通过构造函数声明依赖。这带来可测试性（可注入替身）和可维护性（实现可替换）。DI 的动机与「面向接口编程」一致，见[面向对象](../01-csharp-language/chapter-04-oop.md)。

## 2. 注册服务

服务在 `Program.cs` 里注册到容器：

```csharp
builder.Services.AddScoped<IOrderRepository, SqlOrderRepository>();
builder.Services.AddTransient<OrderService>();
```

注册时声明接口与实现，或只注册实现类型。容器在解析时自动完成依赖链——解析 `OrderService` 时发现它需要 `IOrderRepository`，就递归创建。

## 3. 三种生命周期

生命周期决定服务实例多久创建一次、何时释放：

| 生命周期 | 实例范围 | 适用 |
| :-- | :-- | :-- |
| `Transient` | 每次请求都新建 | 无状态、轻量的服务 |
| `Scoped` | 每个请求共享一个实例 | 与请求绑定（如 EF Core 的 `DbContext`） |
| `Singleton` | 整个应用共享一个实例 | 无状态、线程安全、昂贵的服务 |

```csharp
builder.Services.AddTransient<ITransientService, Service>();
builder.Services.AddScoped<IScopedService, Service>();
builder.Services.AddSingleton<ISingletonService, Service>();
```

`Scoped` 是 Web 应用最常用的默认选择：每个 HTTP 请求创建一次，请求结束释放。`Singleton` 实例在整个应用生命周期存在，必须线程安全。

## 4. 构造函数注入

依赖通过构造函数声明，框架自动解析：

```csharp
public class OrdersController : ControllerBase
{
    private readonly OrderService orders;

    public OrdersController(OrderService orders) => this.orders = orders;
}
```

构造函数注入是首选方式：依赖在构造时明确，对象创建后处于可用状态。要避免「属性注入」或「服务定位器」反模式——它们隐藏依赖，让对象的依赖关系不透明。

## 5. 跨生命周期陷阱

**不能从 Singleton 依赖 Scoped 服务**：

```csharp
builder.Services.AddSingleton<SingletonService>(); // 内部注入 Scoped 服务
builder.Services.AddScoped<IScopedService, ScopedService>();
```

`Singleton` 在整个应用存在，如果它持有 `Scoped` 服务，那个 `Scoped` 实例会随 `Singleton` 存活，失去「每请求一个」的语义，可能造成跨请求共享状态（如 `DbContext` 被并发复用）的严重 bug。

规则：生命周期只能「向下兼容」——`Singleton` 可依赖 `Singleton`，`Scoped` 可依赖 `Scoped`/`Singleton`，`Transient` 可依赖任意。容器在解析时会检查并可能抛异常，但最好在设计时避免。

## 6. 何时需要 DI 容器

ASP.NET Core 内置 DI 容器已满足大多数场景。真正需要的不是「容器」，而是「面向接口 + 构造函数注入」的组织方式。不要在业务代码里手动 `GetService`（服务定位器），那会重新引入耦合。

## 7. 后续阅读

- [配置与日志](./chapter-06-configuration-logging.md)解释 `IOptions<T>` 如何注入配置。
- [中间件管道](./chapter-04-middleware-pipeline.md)解释中间件如何通过构造注入服务。
- [数据访问](../06-data-access/chapter-02-ef-core.md)解释 `DbContext` 的 Scoped 生命周期。

> 本页的技术边界按 .NET 10 / C# 14 核对；内置 DI 容器自 ASP.NET Core 1.0 起提供。官方参考：[ASP.NET Core 文档](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/dependency-injection/)。
