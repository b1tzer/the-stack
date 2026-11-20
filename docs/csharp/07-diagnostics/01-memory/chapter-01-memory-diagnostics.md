---
type: explanation
level: advanced
---

# C# 内存诊断：GC 频繁、OOM 与内存泄漏

本页回答三个问题：内存持续增长或 OOM 时如何定位，GC 频繁和真正的内存泄漏如何区分，如何用转储和快照找到占用者。机制见[GC](../../02-dotnet-runtime/chapter-03-gc.md)。

## 1. 先分清现象

内存问题有三种不同表象，根因和排查方式不同：

- **内存缓慢增长后 OOM**：通常是泄漏——对象不再被业务使用，但仍被引用，GC 无法回收。
- **GC 频繁、CPU 高**：分配速率过高，或堆太小，GC 忙于回收。
- **非托管内存增长**：托管堆正常，但进程内存涨，通常是 P/Invoke 或原生资源泄漏。

先确认是哪种，再选择工具。用 `dotnet-counters` 看托管堆、分配速率和 GC 次数，区分「托管泄漏」和「非托管增长」。

## 2. 采集证据

用 `dotnet-counters` 观察实时指标：

```txt
dotnet-counters monitor --process-id <pid> System.Runtime
```

关注 `gc-heap-size`（托管堆大小）、`alloc-rate`（分配速率）、`% Time in GC`。若 `gc-heap-size` 持续增长且不回落，是托管泄漏；若进程内存涨但 `gc-heap-size` 稳定，是非托管泄漏。

用 `dotnet-gcdump` 采集托管堆快照：

```txt
dotnet-gcdump collect --process-id <pid>
```

生成快照后，用 Visual Studio 或 `dotnet-dump` 分析，找出占用内存最大的对象和持有它们的引用链。

## 3. 定位引用链

内存泄漏的根因是「对象被谁持有」。快照分析工具能给出「谁引用了这些对象」的引用链。常见泄漏来源：

- 静态集合或缓存：往 `static List`/`Dictionary` 里加对象却从不移除。
- 事件订阅：订阅了事件却没取消，发布者持有订阅者。
- 未释放的非托管资源：`IDisposable` 没被 `using`（见[非托管互操作](../../02-dotnet-runtime/chapter-05-unmanaged-interop.md)）。
- 长生命周期委托/闭包：Lambda 捕获了对象，存入长生命周期容器。

定位到引用链后，判断这条引用是否「本该断开却没断开」。GC 判断可达性是机械的，它无法区分「业务还需要」和「业务已不需要」。

## 4. 区分泄漏与缓存

不是所有内存增长都是泄漏。有界缓存（LRU、带上限）会增长到上限后稳定，这是预期行为。真正的泄漏是「无界增长」。观察内存是否随负载增加而持续单调增长、且负载停止后仍不回落，是判断泄漏的关键。

## 5. 修复与验证

修复内存问题通常是对症：

- 泄漏：断开不该存在的引用（移除静态集合条目、取消事件订阅、`Dispose` 非托管资源）。
- 分配过高：减少分配（值类型、`Span<T>`、对象池，见[类型布局与内存](../../02-dotnet-runtime/chapter-02-type-layout-memory.md)）。

修复后重新采集快照和指标，确认 `gc-heap-size` 或进程内存不再持续增长。内存问题修复要量化验证，不能凭「看起来好多了」。

## 6. 后续阅读

- [GC](../../02-dotnet-runtime/chapter-03-gc.md)解释分代回收与触发机制。
- [类型布局与内存](../../02-dotnet-runtime/chapter-02-type-layout-memory.md)解释分配如何产生。
- [非托管互操作](../../02-dotnet-runtime/chapter-05-unmanaged-interop.md)解释非托管资源泄漏。
- [缓存无界增长 OOM 案例](./chapter-02-oom-case.md)看一次完整的内存泄漏排查。

> 本页的技术边界按 .NET 10 / C# 14 核对；`dotnet-counters`、`dotnet-gcdump`、`dotnet-dump` 随 .NET SDK 提供。官方参考：[.NET 诊断](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/)、[分析内存使用](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-gcdump)。
