---
type: explanation
level: advanced
---

# C# 并行与 PLINQ：加速 CPU 密集计算

本页回答三个问题：如何用 `Parallel` 和 PLINQ 并行化计算，并行化在什么条件下才能加速，并行化带来哪些额外约束。异步与并行的区别见[为什么需要异步](./chapter-01-why-async.md)。

## 1. 并行化什么才有意义

并行化只对 **CPU 密集** 且 **任务之间独立** 的工作有意义：

- 计算量大：每个任务耗时足够长，足以抵消并行化开销。
- 彼此独立：任务之间没有共享可变状态和顺序依赖。

I/O 密集的工作用异步（见[为什么需要异步](./chapter-01-why-async.md)），CPU 密集的工作才用并行。一个耗时的循环里如果大部分时间在等 I/O，并行化不会快，反而可能加剧资源竞争。

## 2. Parallel.For 与 Parallel.ForEach

`Parallel` 把循环体分配到多个线程并行执行：

```csharp
int[] inputs = Enumerable.Range(0, 1000000).ToArray();
int[] results = new int[inputs.Length];

Parallel.For(0, inputs.Length, i =>
{
    results[i] = ExpensiveCompute(inputs[i]); // 每个 i 独立，写入不同位置
});
```

每个迭代写入 `results[i]` 的独立位置，没有共享可变状态，因此安全。`Parallel.ForEach` 处理集合：

```csharp
Parallel.ForEach(items, item =>
{
    Process(item); // 每个 item 独立
});
```

## 3. PLINQ：并行 LINQ

`AsParallel` 把 LINQ 查询转为并行执行：

```csharp
var results = inputs
    .AsParallel()
    .Select(ExpensiveCompute)
    .ToArray();
```

PLINQ 会自动划分工作并多线程执行，`AsOrdered` 可保持顺序（有额外开销）：

```csharp
var results = inputs
    .AsParallel()
    .AsOrdered()
    .Select(ExpensiveCompute)
    .ToArray();
```

`WithDegreeOfParallelism` 限制并行度，避免占满所有核心影响其他任务。

## 4. 并行化的约束

并行化把「共享状态」和「顺序依赖」的问题放大：

- **共享可变状态**：任务间写同一个变量需要同步（见[线程与同步](./chapter-04-threading-synchronization.md)），同步又可能抵消并行收益。
- **顺序依赖**：迭代之间若有依赖（下一个迭代依赖上一个的结果），不能并行。
- **异常聚合**：多个任务同时失败，异常会包装进 `AggregateException`。

并行化还引入额外开销：任务划分、调度、同步都有成本。任务太小时，开销大于收益，并行反而更慢。

## 5. 如何判断并行化有效

不要凭感觉并行化，用基准测量：

1. 先写正确的串行版本。
2. 用 `Stopwatch` 或基准库测量串行耗时。
3. 并行化后再测量，确认有真实提升。
4. 检查结果正确性——并行化最容易引入难以复现的竞态 bug。

一个经验参考：单个任务耗时在毫秒级或以上、任务数足够多、任务独立，才值得并行化。纳秒级的小任务并行化通常是净损失。

## 6. 后续阅读

- [线程与同步](./chapter-04-threading-synchronization.md)解释并行任务如何保护共享状态。
- [集合与 LINQ](../01-csharp-language/chapter-09-collections-linq.md)解释串行 LINQ 的延迟执行。
- [常见并发缺陷](./chapter-06-concurrency-pitfalls.md)汇总并行化引入的竞态问题。

> 本页的技术边界按 .NET 10 / C# 14 核对；`Parallel` 与 PLINQ 由 .NET 提供，并行度默认等于可用处理器数。官方参考：[.NET 文档](https://learn.microsoft.com/en-us/dotnet/)、[PLINQ](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/introduction-to-plinq)。
