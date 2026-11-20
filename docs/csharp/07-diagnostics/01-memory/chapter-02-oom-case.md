---
type: explanation
level: advanced
---

# 案例：缓存无界增长导致 OOM

本页还原一次真实的内存泄漏排查：从「内存持续增长」定位到「静态缓存只增不减」，并给出修复和验证方式。方法论见[内存诊断](./chapter-01-memory-diagnostics.md)。

## 1. 现象

一个订单查询服务，运行几天后内存持续增长，最终被容器 OOMKilled。重启后短暂恢复，几天后再次 OOM。CPU 正常，吞吐量正常，唯独内存单调上升。

初步判断是内存泄漏：对象不再被业务使用，但仍被引用，GC 无法回收。

## 2. 采集证据

用 `dotnet-counters` 观察托管堆：

```txt
dotnet-counters monitor --process-id <pid> System.Runtime
```

关键指标显示 `gc-heap-size`（托管堆大小）随请求数单调增长，即使流量停止也不回落。这确认是**托管内存泄漏**（而非非托管增长），因为增长来自托管堆。

用 `dotnet-gcdump` 采集堆快照：

```txt
dotnet-gcdump collect --process-id <pid>
```

## 3. 定位根因

快照分析显示，堆上大量 `OrderSnapshot` 对象被一个 `static Dictionary<string, OrderSnapshot>` 持有。引用链是：

```txt
static Cache._dict → Dictionary 桶 → OrderSnapshot 列表
```

对应用户的「订单快照缓存」，代码是：

```csharp
static class Cache
{
    private static readonly Dictionary<string, OrderSnapshot> _dict = new();

    public static void Add(string key, OrderSnapshot value)
    {
        _dict[key] = value; // 只增不减，永不清理
    }
}
```

每次请求都往 `_dict` 里写入快照，但没有任何移除或淘汰逻辑。GC 判断可达性是机械的：只要 `_dict`（静态根）还引用这些对象，它们就「可达」，不会被回收。这与业务是否还需要它们无关。

## 4. 根因判断

这不是 GC 的 bug，而是「无界缓存」：缓存没有容量上限，也没有淘汰策略。有界缓存（LRU、带过期时间）会增长到上限后稳定，而无界缓存会持续增长直到 OOM。

## 5. 修复

把无界 `Dictionary` 换成有界缓存，加上淘汰策略：

```csharp
static class Cache
{
    private static readonly MemoryCache _cache = new(new MemoryCacheOptions
    {
        SizeLimit = 100_000 // 限制条目数
    });

    public static void Add(string key, OrderSnapshot value)
    {
        _cache.Set(key, value, new MemoryCacheEntryOptions
        {
            Size = 1,
            SlidingExpiration = TimeSpan.FromMinutes(30)
        });
    }
}
```

`MemoryCache` 提供容量上限（`SizeLimit`）和过期（`SlidingExpiration`），超限时自动淘汰。这样缓存增长到上限后稳定，不再无界扩张。

## 6. 验证

修复后重新部署，观察：

- `gc-heap-size` 随负载增长到上限后**稳定**，不再单调上升。
- 压力测试下内存曲线平稳，无 OOM。
- 缓存命中率仍满足业务要求（淘汰策略没有误伤热点数据）。

量化验证是关键：确认「内存不再持续增长」和「缓存仍有效」，而不是只看「看起来好了」。

## 7. 后续阅读

- [内存诊断](./chapter-01-memory-diagnostics.md)解释工具与定位方法。
- [GC](../../02-dotnet-runtime/chapter-03-gc.md)解释可达性与回收。
- [非托管互操作](../../02-dotnet-runtime/chapter-05-unmanaged-interop.md)区分托管与非托管泄漏。

> 本页的技术边界按 .NET 10 / C# 14 核对；`MemoryCache` 由 `Microsoft.Extensions.Caching.Memory` 提供。官方参考：[.NET 诊断](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/)、[MemoryCache](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.caching.memory)。
