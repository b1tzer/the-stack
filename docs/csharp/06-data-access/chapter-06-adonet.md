---
type: explanation
level: intermediate
---

# ADO.NET 与连接池：最底层的数据访问

本页回答三个问题：ADO.NET 如何直接执行 SQL，连接池如何复用连接，连接泄漏如何发生和避免。ORM 的取舍见[持久化思想](./chapter-01-persistence-thought.md)。

## 1. ADO.NET 是什么

ADO.NET 是 .NET 最底层的数据访问 API，直接操作 `DbConnection`、`DbCommand`、`DbDataReader`：

```csharp
using var connection = new SqlConnection(connectionString);
await connection.OpenAsync();

using var command = connection.CreateCommand();
command.CommandText = "SELECT Id, Title FROM Blogs WHERE Id > @Id";
command.Parameters.AddWithValue("@Id", 10);

await using var reader = await command.ExecuteReaderAsync();
while (await reader.ReadAsync())
{
    int id = reader.GetInt32(0);
    string title = reader.GetString(1);
}
```

开发者手写 SQL、手动映射结果。它最灵活也最繁琐——没有对象映射、没有变更追踪，一切都是手工。EF Core 和 Dapper 都建立在 ADO.NET 之上。

## 2. 连接池

连接是昂贵资源，ADO.NET 默认启用**连接池**：`Open` 时从池中取复用连接，`Close`/`Dispose` 时归还池，而不是真正关闭底层 socket：

```csharp
// 每次 Open/Dispose 都从池借还，底层连接被复用
using var conn1 = new SqlConnection(connStr);
conn1.Open();
// 使用 conn1
// Dispose 时连接归还池

using var conn2 = new SqlConnection(connStr);
conn2.Open(); // 很可能复用 conn1 归还的连接
```

连接池按**连接字符串**分组：只有连接字符串完全一致的连接才共享同一个池。字符串里一个空格或大小写差异都会导致不同的池。

## 3. 连接泄漏

连接泄漏是数据访问最常见的故障：**拿到连接却不归还**，池被耗尽，新请求「获取连接超时」：

```csharp
// 错误：未 using/Dispose，连接不归还
var conn = new SqlConnection(connStr);
conn.Open();
var cmd = conn.CreateCommand();
var reader = cmd.ExecuteReader();
// 忘记 Dispose，连接一直占用
```

正确做法是用 `using`/`await using` 保证连接、命令、读取器都归还。**凡是 `IDbConnection` 都要 `using`**，这是铁律。

泄漏的信号：连接池耗尽、`Timeout expired... pool` 异常、活跃连接数持续增长。排查时看是否有「打开连接却没关闭」的路径。

## 4. 参数化查询

ADO.NET 的参数化查询既防 SQL 注入，又提升性能：

```csharp
command.CommandText = "SELECT * FROM Users WHERE Name = @Name";
command.Parameters.AddWithValue("@Name", name);
```

不要用字符串拼接把用户输入拼进 SQL：

```csharp
// 危险：SQL 注入
command.CommandText = $"SELECT * FROM Users WHERE Name = '{name}'";
```

参数化让数据库把参数当作数据而不是代码，从根上消除 SQL 注入。这也适用于 Dapper 和 EF Core（它们都参数化）。

## 5. ADO.NET 的使用场景

直接写 ADO.NET 只在少数场景：极致性能、复杂 SQL、批量操作、需要完全控制底层。大多数业务用 EF Core（见[EF Core](./chapter-02-ef-core.md)）或 Dapper（见[Dapper](./chapter-07-dapper.md)）。ADO.NET 的价值在于理解它是 ORM 的底层，排查连接和性能问题时需要回到这一层。

## 6. 后续阅读

- [持久化思想](./chapter-01-persistence-thought.md)解释 ADO.NET、Dapper、EF Core 的取舍。
- [Dapper](./chapter-07-dapper.md)解释轻量 ORM 如何建立在 ADO.NET 上。
- [事务与隔离级别](./chapter-08-transactions-isolation.md)解释 `DbTransaction`。
- [诊断](../07-diagnostics/index.md)了解连接池问题的排查。

> 本页的技术边界按 .NET 10 / C# 14 核对；ADO.NET 连接池默认启用，按连接字符串分组。官方参考：[ADO.NET](https://learn.microsoft.com/en-us/dotnet/framework/data/adonet/)。
