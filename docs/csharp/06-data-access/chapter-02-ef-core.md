---
type: tutorial
level: intermediate
---

# EF Core：用 LINQ 操作数据库

本页带你从零建立 EF Core 数据访问，理解 `DbContext`、实体映射、变更追踪和基本查询。前置：会 C# 和 LINQ、了解关系数据库。读完你能用 EF Core 完成基本 CRUD。

## 1. 建立模型与上下文

`DbContext` 是 EF Core 的核心，代表一个数据库会话；`DbSet<T>` 代表一张表：

```csharp
public class Blog
{
    public int Id { get; set; }
    public string Title { get; set; }
    public List<Post> Posts { get; set; } = new();
}

public class Post
{
    public int Id { get; set; }
    public string Content { get; set; }
    public int BlogId { get; set; }
    public Blog Blog { get; set; }
}

public class BlogContext : DbContext
{
    public DbSet<Blog> Blogs => Set<Blog>();
    public DbSet<Post> Posts => Set<Post>();

    protected override void OnConfiguring(DbContextOptionsBuilder options)
        => options.UseSqlServer(connectionString);
}
```

实体类映射到表，`Blog.Posts` 和 `Post.BlogId` 表达一对多关系。EF Core 按约定识别主键（`Id`）和外键（`BlogId`），无需显式配置。

## 2. 查询

用 LINQ 查询，EF Core 把它转译为 SQL：

```csharp
using var db = new BlogContext();

var blogs = await db.Blogs
    .Where(b => b.Title.Contains("dotnet"))
    .OrderBy(b => b.Title)
    .ToListAsync();
```

LINQ 在数据库端执行（转成 `WHERE`/`ORDER BY`），而不是取回所有行再内存过滤。查询的详细调优见[查询与调优](./chapter-03-query-tuning.md)。

## 3. 插入、更新、删除

EF Core 跟踪实体的变更，`SaveChanges` 时生成对应的 SQL：

```csharp
using var db = new BlogContext();

// 插入
db.Blogs.Add(new Blog { Title = "新博客" });

// 更新：先查再改，EF 跟踪变更
var blog = await db.Blogs.FindAsync(1);
blog.Title = "改过的标题";

// 删除
db.Blogs.Remove(blog);

await db.SaveChangesAsync(); // 一次提交所有变更
```

`FindAsync` 先查主键，命中则返回已跟踪实体。变更追踪记录实体状态（Added/Modified/Deleted），`SaveChanges` 统一生成 SQL 并在事务中提交。

## 4. 变更追踪

`DbContext` 默认跟踪查询返回的实体，记录它们的修改。这带来便利（只更新变化字段），也占用内存和 CPU。只读查询应关闭追踪：

```csharp
var blogs = await db.Blogs
    .AsNoTracking()
    .Where(b => b.Title.Contains("dotnet"))
    .ToListAsync();
```

`AsNoTracking` 让查询结果不被跟踪，适合只读展示场景。需要修改实体时保留跟踪。

## 5. 关系与导航属性

访问导航属性会触发关联查询：

```csharp
var blog = await db.Blogs
    .Include(b => b.Posts)   // 立即加载关联的 Post
    .FirstAsync(b => b.Id == 1);

foreach (var post in blog.Posts)
{
    Console.WriteLine(post.Content);
}
```

`Include` 立即加载导航属性，避免后续按需查询导致的 N+1 问题（见[查询与调优](./chapter-03-query-tuning.md)）。不 `Include` 而直接访问 `blog.Posts`，依赖配置可能触发延迟加载或返回空。

## 6. 后续阅读

- [查询与调优](./chapter-03-query-tuning.md)解释 LINQ 转 SQL、N+1 与追踪开销。
- [迁移](./chapter-04-migrations.md)解释如何用迁移管理表结构。
- [测试](./chapter-05-testing.md)解释如何测试 EF Core 数据访问。
- [依赖注入](../04-aspnet-core/chapter-05-dependency-injection.md)解释 `DbContext` 的 Scoped 生命周期。

> 本页的技术边界按 .NET 10 / C# 14 核对；EF Core 与 .NET 版本独立演进，本页示例以 EF Core 最新版本为参考。官方参考：[EF Core 文档](https://learn.microsoft.com/en-us/ef/core/)。
