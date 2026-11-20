---
type: explanation
level: advanced
---

# 案例：LINQ 多次枚举导致 CPU 热点

本页还原一次 CPU 热点的定位：从「CPU 持续高」追溯到「LINQ 查询被反复枚举」。方法论见[CPU 与性能诊断](./chapter-01-cpu-performance.md)。

## 1. 现象

一个报表服务部署后 CPU 持续接近 100%，吞吐量远低于预期。没有明显的 I/O 等待，日志正常，请求都能返回，只是慢且 CPU 高。

## 2. 采集证据

用 `dotnet-trace` 采集 CPU 采样：

```txt
dotnet-trace collect --process-id <pid> --providers Microsoft-DotNETCore-SampleProfiler
```

采样分析显示，CPU 时间集中在报表生成方法，其中大部分花在一次 LINQ 查询的 `Where`/`Select` 上。`% Time in GC` 不高，排除 GC 主导，是纯计算热点。

## 3. 定位根因

读报表生成代码，发现同一个 LINQ 查询被反复枚举：

```csharp
var filtered = orders.Where(o => o.Status == OrderStatus.Paid)
                     .Select(o => ComputeSummary(o)); // 延迟执行，未物化

var total = filtered.Sum(o => o.Total);        // 第 1 次枚举
var count = filtered.Count();                  // 第 2 次枚举
var top = filtered.OrderByDescending(o => o.Total).First(); // 第 3 次枚举
```

`filtered` 是延迟执行的查询（见[集合与 LINQ](../../01-csharp-language/chapter-09-collections-linq.md)），每次 `Sum`、`Count`、`OrderBy` 都会**重新执行整个查询**，包括昂贵的 `ComputeSummary`。

## 4. 根因判断

LINQ 的延迟执行意味着「查询对象」只是描述，不是结果。同一个查询对象被枚举几次，就执行几次。这里 `ComputeSummary` 被重复执行了三次，CPU 白白浪费。

修复方向：把结果**物化一次**，后续复用。

## 5. 修复

用 `ToList()` 物化一次结果：

```csharp
var filtered = orders.Where(o => o.Status == OrderStatus.Paid)
                     .Select(o => ComputeSummary(o))
                     .ToList(); // 物化：立即执行一次

var total = filtered.Sum(o => o.Total);        // 复用已物化的结果
var count = filtered.Count();
var top = filtered.OrderByDescending(o => o.Total).First();
```

`ToList()` 立即执行一次查询并缓存结果，后续 `Sum`/`Count`/`OrderBy` 都基于内存里的列表，不再重复执行 `ComputeSummary`。

## 6. 验证

修复后重新采样：

- 报表生成方法的 CPU 占比显著下降。
- 吞吐量提升（同样 CPU 下处理更多请求）。
- 结果正确性不变（物化不改变语义，只改变执行次数）。

量化验证：对比修复前后 CPU 采样占比和吞吐量，确认热点消除。延迟执行的坑不容易从代码一眼看出，要靠采样定位「哪个查询被执行了多次」。

## 7. 后续阅读

- [CPU 与性能诊断](./chapter-01-cpu-performance.md)解释采样与热点定位。
- [集合与 LINQ](../../01-csharp-language/chapter-09-collections-linq.md)解释延迟执行与物化。
- [查询与调优](../../06-data-access/chapter-03-query-tuning.md)解释 EF Core 查询的类似问题。

> 本页的技术边界按 .NET 10 / C# 14 核对；`dotnet-trace` 随 .NET SDK 提供。官方参考：[.NET 诊断](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/)。
