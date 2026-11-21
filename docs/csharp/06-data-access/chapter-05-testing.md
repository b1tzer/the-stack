---
type: howto
level: intermediate
---

# 测试数据访问：单元测试与集成测试

本页说明如何测试 EF Core 数据访问，以及 InMemory 提供程序的局限。前置：会用 xUnit、了解 EF Core（见[EF Core](./chapter-02-ef-core.md)）。读完你能写出可靠的查询测试。

## 1. 测什么、不测什么

数据访问的测试分两类：

- **单元测试**：测业务逻辑，用替身隔离数据库，不真正连库。
- **集成测试**：测查询是否真的能正确翻译、执行，连一个真实但隔离的数据库。

要测的是「查询逻辑是否正确」，而不是「EF Core 能否生成 SQL」——后者由框架保证。因此重点应放在集成测试验证查询返回预期结果，而不是过度模拟。

## 2. 用 SQLite 内存库做集成测试

EF Core 的 InMemory 提供程序**不是**真实数据库，不执行 SQL、不支持事务和关系约束，用它测查询会漏掉真实翻译错误。更可靠的做法是用 SQLite 内存库：

```csharp
var connection = new SqliteConnection("DataSource=:memory:");
connection.Open();

var options = new DbContextOptionsBuilder<BlogContext>()
    .UseSqlite(connection)
    .Options;

using var db = new BlogContext(options);
await db.Database.EnsureCreatedAsync(); // 建表

db.Blogs.Add(new Blog { Title = "测试" });
await db.SaveChangesAsync();

var result = await db.Blogs.Where(b => b.Title.Contains("测试")).ToListAsync();
Assert.Single(result);
```

SQLite 是真正的 SQL 引擎，`Where` 会被翻译执行，能暴露「LINQ 无法翻译成 SQL」这类错误。注意 SQLite 与目标数据库（SQL Server/PostgreSQL）的 SQL 方言有差异，关键查询还应针对目标数据库做集成测试。

## 3. 隔离与清理

每个测试应使用独立的数据库，避免互相污染：

```csharp
public class QueryTests : IAsyncLifetime
{
    private SqliteConnection connection;
    private BlogContext db;

    public async Task InitializeAsync()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<BlogContext>()
            .UseSqlite(connection).Options;
        db = new BlogContext(options);
        await db.Database.EnsureCreatedAsync();
    }

    public async Task DisposeAsync()
    {
        await db.DisposeAsync();
        await connection.DisposeAsync();
    }
}
```

每个测试独立建库、独立释放，测试之间不共享状态，避免顺序依赖。

## 4. 单元测试用接口隔离

业务逻辑依赖 `IOrderRepository` 接口时，可以用替身（fake/mock）隔离数据库：

```csharp
class FakeOrderRepository : IOrderRepository
{
    private readonly List<Order> orders = new();

    public Task AddAsync(Order order)
    {
        orders.Add(order);
        return Task.CompletedTask;
    }
}
```

业务逻辑单元测试注入 `FakeOrderRepository`，不碰数据库。这依赖「面向接口」的组织方式（见[依赖注入](../04-aspnet-core/chapter-05-dependency-injection.md)）。替身只验证业务逻辑，不能替代集成测试验证真实查询。

## 5. 测试的边界

数据访问测试最容易犯的错是「测了不该测的」：

- 不要测 EF Core 本身（框架已测过）。
- 不要用 InMemory 替代真实数据库测查询。
- 不要只写单元测试而跳过集成测试——查询翻译错误只有连真库才暴露。

有价值的测试是：验证你的查询在目标数据库上返回正确结果，验证迁移能成功应用。

## 6. 后续阅读

- [EF Core](./chapter-02-ef-core.md)解释 `DbContext` 与查询。
- [迁移](./chapter-04-migrations.md)解释如何测试迁移。
- [查询与调优](./chapter-03-query-tuning.md)解释如何验证查询性能。

> 本页的技术边界按 .NET 10 / C# 14 核对；SQLite 内存库需 `Microsoft.EntityFrameworkCore.Sqlite` 包，InMemory 提供程序不适合查询测试。官方参考：[EF Core 测试](https://learn.microsoft.com/en-us/ef/core/testing/)。
