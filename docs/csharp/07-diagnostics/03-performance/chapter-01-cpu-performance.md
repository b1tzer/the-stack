---
type: explanation
level: advanced
---

# C# CPU 与性能诊断：高 CPU、慢响应与启动慢

本页回答三个问题：CPU 高时如何定位热点，响应慢如何区分 CPU、I/O 和锁竞争，如何用工具量化性能。编译与运行机制见[JIT 与 AOT](../../02-dotnet-runtime/chapter-04-jit-aot.md)。

## 1. 先量化现象

「慢」是主观感受，先量化：

- CPU 利用率（`dotnet-counters` 的 `cpu-usage`）。
- 请求耗时（APM、日志、`Stopwatch`）。
- 吞吐量（单位时间处理的请求数）。

先确定是「CPU 高」还是「响应慢但 CPU 不高」。CPU 高通常是计算热点或 GC；CPU 不高但响应慢通常是 I/O 等待或锁竞争。二者定位方向完全不同。

## 2. 定位 CPU 热点

CPU 高时用 `dotnet-trace` 采集 CPU 采样：

```txt
dotnet-trace collect --process-id <pid> --providers Microsoft-DotNETCore-SampleProfiler
```

采样结果给出每个方法占用 CPU 的比例，按占比排序找到热点方法。热点可能是：

- 业务计算循环（排序、序列化、加密）。
- GC（`% Time in GC` 高，见[内存诊断](../01-memory/chapter-01-memory-diagnostics.md)）。
- 过度日志或字符串拼接。

找到热点后，针对具体方法优化：降低复杂度、减少分配、用更高效的数据结构。优化后再采样验证 CPU 占比下降。

## 3. 区分 I/O 等待与锁竞争

CPU 不高但响应慢，通常是线程在等 I/O 或锁：

- **I/O 等待**：请求耗时花在数据库、外部 API、磁盘。用链路追踪（APM）或日志定位是哪个下游慢。
- **锁竞争**：大量线程等同一把锁（见[并发诊断](../02-concurrency/chapter-01-concurrency-diagnostics.md)）。

用 `dotnet-trace` 或转储看线程等待原因，区分「等 I/O」和「等锁」。

## 4. 启动慢

启动慢单独一类问题。根因可能是：

- JIT 编译开销：冷启动时大量方法首次编译（见[JIT 与 AOT](../../02-dotnet-runtime/chapter-04-jit-aot.md)）。
- 依赖注入容器注册过多、启动时做重活。
- 静态初始化、配置加载。

启动敏感的 CLI 工具可评估 ReadyToRun 或 NativeAOT（见[JIT 与 AOT](../../02-dotnet-runtime/chapter-04-jit-aot.md)）。服务端启动慢更多是启动流程里塞了不该做的事。

## 5. 性能诊断原则

1. **先测量**：用 `dotnet-counters`、`dotnet-trace` 量化，不凭感觉。
2. **找热点**：用采样定位最耗时的少数方法，而不是漫无目的地优化。
3. **对症优化**：CPU 热点、I/O 等待、锁竞争、启动慢的优化手段不同。
4. **量化验证**：优化前后对比指标，确认是真实改进，避免「优化」引入新问题。

性能优化的最大浪费是优化了不慢的地方。用数据驱动，先优化真实热点。

## 6. 后续阅读

- [JIT 与 AOT](../../02-dotnet-runtime/chapter-04-jit-aot.md)解释编译模式与启动。
- [GC](../../02-dotnet-runtime/chapter-03-gc.md)解释 GC 对 CPU 的影响。
- [内存诊断](../01-memory/chapter-01-memory-diagnostics.md)解释 GC 高与内存问题。
- [并发诊断](../02-concurrency/chapter-01-concurrency-diagnostics.md)解释锁竞争。
- [CPU 热点案例](./chapter-02-cpu-hotspot-case.md)看一次 LINQ 多次枚举的完整排查。

> 本页的技术边界按 .NET 10 / C# 14 核对；`dotnet-trace`、`dotnet-counters` 随 .NET SDK 提供。官方参考：[.NET 诊断](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/)、[分析 CPU 使用](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-trace)。
