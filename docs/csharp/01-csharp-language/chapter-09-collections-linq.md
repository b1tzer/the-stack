---
type: explanation
level: intermediate
---

# C# 集合与 LINQ：按契约选择容器并查询数据

本页回答三个问题：C# 提供了哪些集合及如何选择，LINQ 如何用统一语法查询数据，延迟执行带来什么收益和陷阱。类型分类见[类型系统](./chapter-02-type-system.md)，泛型见[泛型](./chapter-05-generics.md)。

## 1. 集合如何选择

选择集合看两个维度：是否需要唯一性、访问模式是按下标还是按键。

| 集合 | 特点 | 适用场景 |
| :-- | :-- | :-- |
| 数组 `T[]` | 定长，按下标访问 | 已知长度、频繁随机访问 |
| `List<T>` | 动态扩容，按下标访问 | 需要增删、顺序遍历 |
| `Dictionary<TKey,TValue>` | 按键访问，键唯一 | 按键快速查找 |
| `HashSet<T>` | 元素唯一，无序 | 去重、成员判断 |
| `Queue<T>` | 先进先出 | 任务队列 |
| `Stack<T>` | 后进先出 | 回溯、撤销 |

```csharp
var list = new List<int> { 1, 2, 3 };
list.Add(4);
Console.WriteLine(list[0]); // 1

var map = new Dictionary<string, int>
{
    ["tom"] = 30,
    ["ada"] = 25
};
Console.WriteLine(map["tom"]); // 30
```

`Dictionary` 访问不存在的键会抛 `KeyNotFoundException`；不确定键是否存在时用 `TryGetValue` 而不是捕获异常。

## 2. `IEnumerable<T>`：统一的序列抽象

大多数集合实现 `IEnumerable<T>`，表示「可枚举的序列」。这是 LINQ 的共同基础：

```csharp
IEnumerable<string> names = new List<string> { "Tom", "Ada", "Ben" };
```

`IEnumerable<T>` 只承诺「可以遍历」，不承诺可以按下标或按键访问。方法参数尽量用 `IEnumerable<T>` 而不是具体集合类型，调用方就可以传入任何兼容序列。

## 3. LINQ：统一查询

LINQ（Language Integrated Query）对 `IEnumerable<T>` 提供一套统一的查询操作。方法语法直接调用扩展方法：

```csharp
var adults = names
    .Where(n => n.Length >= 3)
    .OrderBy(n => n)
    .Select(n => n.ToUpper());

foreach (var name in adults)
{
    Console.WriteLine(name); // ADA, BEN, TOM
}
```

查询语法是方法语法的等价糖：

```csharp
var adults = from n in names
             where n.Length >= 3
             orderby n
             select n.ToUpper();
```

两者编译结果等价，按团队习惯选用。方法语法在组合复杂操作（分组、连接）时更灵活，查询语法在简单筛选排序时更易读。

常用操作符：`Where`（筛选）、`Select`（投影）、`OrderBy`（排序）、`GroupBy`（分组）、`SelectMany`（展平）、`Aggregate`（聚合）、`First`/`FirstOrDefault`/`Single`（取元素）、`Any`/`All`（判断）、`Count`/`Sum`/`Average`（聚合）。

### 3.1 延迟执行

LINQ 查询大多延迟执行：定义查询时不运行，遍历结果时才运行：

```csharp
var query = list.Where(x => x > 10); // 未执行
list.Add(100);                        // 修改源
Console.WriteLine(query.Count());     // 此时才执行，包含 100
```

延迟执行意味着查询在遍历时才看到源的最新状态。它的陷阱在于多次遍历会重复执行：

```csharp
var query = list.Where(x => Expensive(x));
Console.WriteLine(query.Count()); // 执行一次
Console.WriteLine(query.Count()); // 又执行一次
```

需要稳定结果或只执行一次时，用 `ToList()`/`ToArray()` 把结果物化为具体集合：

```csharp
var materialized = list.Where(x => x > 10).ToList(); // 立即执行一次
```

只有 `ToList`、`ToArray`、`Count`、`First` 等终结操作才触发实际执行；`Where`、`Select`、`OrderBy` 等中间操作只构造查询。

## 4. 性能边界

LINQ 的便利有代价：委托调用和迭代器带来额外开销，热路径中可能不如手写循环快。但大多数业务代码中这点差异远小于可读性收益。真正影响性能的是：

- 多次枚举同一查询（重复执行）。
- 在大集合上反复 `ToList` 复制。
- 在循环内用 `Contains` 于 `List`（O(n)）而不是 `HashSet`（O(1)）。

先保证正确和可读，用基准测试定位到真实热点再优化。

## 5. 后续阅读

- [泛型](./chapter-05-generics.md)解释 `IEnumerable<T>` 与 LINQ 的泛型基础。
- [委托与 Lambda](./chapter-07-delegates-lambda.md)解释 LINQ 如何大量使用 `Func` 委托。
- [并行 LINQ](../03-csharp-concurrency/chapter-05-parallel-linq.md)解释 `AsParallel` 的并行查询。
- [表达式树与 IQueryable](./chapter-13-expression-trees.md)解释 `IEnumerable` 与 `IQueryable` 的分野。
- [EF Core 查询](../06-data-access/chapter-03-query-tuning.md)解释 LINQ 如何转译为 SQL。

> 本页的技术边界按 .NET 10 / C# 14 核对；LINQ 自 C# 3 引入。官方参考：[C# 语言参考](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/)、[LINQ](https://learn.microsoft.com/en-us/dotnet/csharp/linq/)。
