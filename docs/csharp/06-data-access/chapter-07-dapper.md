---
type: howto
level: intermediate
---

# Dapper：手写 SQL 的轻量 ORM

本页说明如何用 Dapper 做手写 SQL + 自动映射，以及它与 EF Core 如何取舍。前置：会 SQL、了解 ADO.NET（见[ADO.NET 与连接池](./chapter-06-adonet.md)）。

## 1. Dapper 是什么

Dapper 是 micro-ORM：它不生成 SQL、不跟踪变更，只做「执行 SQL → 自动映射结果到对象」。你手写 SQL，Dapper 负责参数化和结果映射：

```csharp
using var connection = new SqlConnection(connectionString);

var blogs = await connection.QueryAsync<Blog>(
    "SELECT * FROM Blogs WHERE Title LIKE @Pattern",
    new { Pattern = "%dotnet%" });
```

`QueryAsync<Blog>` 执行 SQL 并把结果映射成 `Blog` 列表。相比 ADO.NET 手工逐字段读取，Dapper 省掉了映射样板；相比 EF Core，它不隐藏 SQL。

## 2. 参数化

Dapper 用匿名对象传参，自动参数化：

```csharp
var blog = await connection.QuerySingleAsync<Blog>(
    "SELECT * FROM Blogs WHERE Id = @Id",
    new { Id = 1 });
```

参数以 `@Name` 引用，值与 SQL 分离，防 SQL 注入（见[ADO.NET 与连接池](./chapter-06-adonet.md)）。`QuerySingleAsync` 期望恰好一行，多于一行会抛异常。

## 3. 写操作

`ExecuteAsync` 执行增删改，返回影响行数：

```csharp
int rows = await connection.ExecuteAsync(
    "UPDATE Blogs SET Title = @Title WHERE Id = @Id",
    new { Title = "新标题", Id = 1 });
```

`rows` 是受影响的行数，可用于判断「是否真的更新到了」——比如 `rows == 0` 说明该 Id 不存在。

## 4. 多结果与映射

复杂映射（如一对多）可以用 `QueryMultipleAsync` 读多个结果集，或用多映射：

```csharp
var blogs = await connection.QueryAsync<Blog, Post, Blog>(
    @"SELECT * FROM Blogs b
      JOIN Posts p ON p.BlogId = b.Id
      ORDER BY b.Id",
    (blog, post) => { blog.Posts.Add(post); return blog; });
```

Dapper 的映射需要手写，比 EF Core 的 `Include` 繁琐，但也因此完全透明——你清楚每一条 SQL 长什么样。

## 5. Dapper vs EF Core

| | Dapper | EF Core |
| :-- | :-- | :-- |
| SQL | 手写，完全可控 | LINQ 生成 |
| 映射 | 自动，但手写配置 | 自动 + 变更追踪 |
| 学习成本 | 低，懂 SQL 即可 | 高，需理解追踪/翻译 |
| 适用 | 性能敏感、复杂 SQL | 常规 CRUD、团队协作 |

Dapper 适合：性能关键的查询、复杂报表 SQL、团队 SQL 能力强。EF Core 适合：常规业务 CRUD、需要变更追踪、快速开发。二者可共存——EF Core 做 CRUD，Dapper 做关键查询（见[持久化思想](./chapter-01-persistence-thought.md)）。

## 6. 失败信号

- `QuerySingleAsync` 在多行时报错：改用 `QueryFirstOrDefaultAsync` 或 `QueryAsync`。
- 参数名不匹配（SQL 里 `@Name` 但对象里是 `name`）：抛参数绑定异常。
- 结果映射失败（列名与属性名不一致）：结果属性为默认值，注意检查。

## 7. 后续阅读

- [ADO.NET 与连接池](./chapter-06-adonet.md)解释 Dapper 的底层。
- [持久化思想](./chapter-01-persistence-thought.md)解释三种方式的取舍。
- [索引与执行计划](./chapter-09-indexes-execution.md)解释手写 SQL 如何优化。

> 本页的技术边界按 .NET 10 / C# 14 核对；Dapper 是开源 micro-ORM，由 Stack Exchange 团队维护。官方参考：[Dapper](https://github.com/DapperLib/Dapper)。
