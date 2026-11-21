---
type: explanation
level: advanced
---

# EF Core 查询与调优：LINQ 转 SQL、N+1 与追踪

本页回答三个问题：LINQ 如何转成 SQL、哪些写法会生成低效查询，N+1 问题如何产生和避免，变更追踪何时成为负担。基础见[EF Core](./chapter-02-ef-core.md)。

## 1. LINQ 如何转 SQL

EF Core 把 LINQ 表达式树翻译成 SQL，在数据库端执行：

```csharp
var result = await db.Orders
    .Where(o => o.Status == OrderStatus.Paid && o.Total > 1000)
    .Select(o => new { o.Id, o.Total })
    .ToListAsync();
```

生成类似：

```sql
SELECT [Id], [Total] FROM [Orders]
WHERE [Status] = 1 AND [Total] > 1000
```

翻译发生在运行时。不是所有 LINQ 都能翻译成 SQL——调用数据库不认识的方法（如自定义函数、部分字符串方法）会导致客户端求值或运行时异常。理解翻译边界，才能写出可下推的查询。

## 2. N+1 问题

N+1 是 ORM 最常见的性能陷阱：查询出 N 条父记录后，对每条再发一次查询取关联记录，共 N+1 次查询。

```csharp
// 1 次查询取所有博客
var blogs = await db.Blogs.ToListAsync();

// 每个博客再查一次 Posts，共 N 次
foreach (var blog in blogs)
{
    Console.WriteLine(blog.Posts.Count); // 触发 N 次查询
}
```

**修复**：用 `Include` 立即加载，一次查询带回关联数据：

```csharp
var blogs = await db.Blogs
    .Include(b => b.Posts)   // 一次 JOIN 或两条查询带回关联
    .ToListAsync();
```

判断依据是实际发出的 SQL 条数。用 EF Core 的日志或数据库慢查询日志观察，而不是凭代码直觉。`Include` 过多又会带回过大的结果集，需要在「查询次数」和「单次数据量」之间权衡。

## 3. 追踪 vs 无追踪

变更追踪（change tracking）让 EF Core 知道实体被修改，但也付出代价：每个实体都要存一份快照，用于比较变化。只读查询用 `AsNoTracking` 省掉这份开销：

```csharp
var blogs = await db.Blogs
    .AsNoTracking()
    .Where(b => b.Published)
    .ToListAsync();
```

批量读取、报表、只读展示都应 `AsNoTracking`。需要修改并 `SaveChanges` 的实体才保留追踪。追踪的另一个陷阱：同一 `DbContext` 里查询相同主键的实体，会返回已跟踪的旧实例，而不是数据库的最新值。

## 4. 投影代替整实体

只取需要的列时，用 `Select` 投影到匿名类型或 DTO，而不是拉回整个实体：

```csharp
// 不好：拉回所有列 + 启动追踪
var orders = await db.Orders.Where(o => o.Paid).ToListAsync();

// 好：只取需要的列，且无追踪
var summaries = await db.Orders
    .Where(o => o.Paid)
    .Select(o => new OrderSummary(o.Id, o.Total))
    .AsNoTracking()
    .ToListAsync();
```

投影只生成所需列的 SQL，减少网络和内存开销。投影出的匿名对象默认不被追踪。

## 5. 排查与测量

不要靠猜优化，先测量实际发出的 SQL 和耗时：

- 开启 EF Core 的 SQL 日志，看生成的 SQL 条数和内容。
- 用数据库的慢查询日志定位真正慢的查询。
- 用 `dotnet-trace`/性能分析器定位 CPU 和内存热点。

常见优化顺序：先消灭 N+1，再给过滤条件加索引，然后才考虑 `AsNoTracking`、投影等微观优化。索引缺失通常是慢查询的头号原因，而不是 ORM 本身。

## 6. 后续阅读

- [EF Core](./chapter-02-ef-core.md)解释追踪、`Include` 等机制。
- [持久化思想](./chapter-01-persistence-thought.md)解释 ORM 的收益与代价。
- [测试](./chapter-05-testing.md)解释如何验证查询性能。
- [诊断](../07-diagnostics/index.md)了解系统化排查。

> 本页的技术边界按 .NET 10 / C# 14 核对；`AsNoTracking` 与投影优化适用于 EF Core 各版本。官方参考：[EF Core 文档](https://learn.microsoft.com/en-us/ef/core/performance/)。
