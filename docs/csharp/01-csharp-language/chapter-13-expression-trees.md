---
type: explanation
level: advanced
---

# 表达式树与 IQueryable：把代码变成可分析的结构

本页回答三个问题：表达式树和委托有什么区别，`IQueryable` 与 `IEnumerable` 为什么是两种查询，表达式树如何让 LINQ 翻译成 SQL。这是理解 EF Core 查询翻译的关键。

## 1. 委托是「执行」，表达式树是「描述」

Lambda 既可以编译成委托（可直接调用），也可以编译成表达式树（可分析的结构）：

```csharp
Func<int, bool> predicate = x => x > 10;        // 委托：能直接调用
Expression<Func<int, bool>> expr = x => x > 10;  // 表达式树：描述这个表达式
```

委托是「一段可执行代码」，表达式树是「对代码的抽象语法树」。表达式树可以被遍历、分析、改写，这正是 LINQ-to-SQL 能工作的原因。

## 2. 遍历表达式树

表达式树由节点组成（`BinaryExpression`、`MemberExpression`、`ConstantExpression` 等）：

```csharp
Expression<Func<int, bool>> expr = x => x > 10;

// 根节点是 BinaryExpression（x > 10）
// 左子树是参数 x，右子树是常量 10
```

框架遍历这些节点，把 `x > 10` 翻译成 SQL 的 `> 10`。如果传给 EF Core 的是委托（`Func`）而不是表达式树（`Expression<Func>`），框架拿不到结构，就无法翻译。

## 3. IEnumerable vs IQueryable

这是两种查询的分水岭：

```csharp
// IEnumerable：内存查询，委托执行
IEnumerable<Blog> inMemory = blogs.Where(b => b.Id > 1);

// IQueryable：可翻译查询，表达式树
IQueryable<Blog> queryable = db.Blogs.Where(b => b.Id > 1);
```

`IEnumerable.Where` 接收 `Func`，在内存里遍历过滤；`IQueryable.Where` 接收 `Expression<Func>`，保留表达式树，交给提供程序（如 EF Core）翻译成 SQL 在数据库执行。

关键区别：**`IQueryable` 把「查询的意图」交给远端执行，而不是把数据拉回内存**。一旦调用 `ToList()` 或把 `IQueryable` 转成 `IEnumerable`，查询就在内存执行，失去数据库端优化的机会（见[查询与调优](../06-data-access/chapter-03-query-tuning.md)）。

## 4. 表达式树的应用

表达式树是「把代码当数据」的基石，应用广泛：

- **LINQ to SQL / EF Core**：把表达式翻译成 SQL。
- **动态构建查询**：运行时组合 `Where`/`OrderBy` 条件。
- **通用验证规则**：`Expression<Func<T, bool>>` 描述规则，供多场景复用。
- **序列化、消息路由**：把业务规则表达为可分析的结构。

本质上，表达式树让框架「读懂你的代码在做什么」，从而能在数据库、远端或运行时做优化。这是 C# 相对许多语言的独特能力。

## 5. 表达式树的边界

表达式树**不能**包含语句（赋值、循环）、`await`、方法体块等——它只能描述表达式。因此：

- `x => x + 1` 可以，`x => { x++; return x; }` 不行。
- 表达式树里的方法调用会被保留为节点，能否翻译取决于提供程序认不认这个方法。

EF Core 的查询里，调用数据库不认识的 C# 方法会导致翻译失败（见[查询与调优](../06-data-access/chapter-03-query-tuning.md)）。

## 6. 后续阅读

- [集合与 LINQ](./chapter-09-collections-linq.md)解释 LINQ 的查询与延迟执行。
- [委托与 Lambda](./chapter-07-delegates-lambda.md)解释委托与表达式的区别。
- [查询与调优](../06-data-access/chapter-03-query-tuning.md)解释表达式树如何翻译成 SQL。

> 本页的技术边界按 .NET 10 / C# 14 核对；表达式树由 `System.Linq.Expressions` 提供，自 C# 3 引入。官方参考：[表达式树](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/expression-trees/)。
