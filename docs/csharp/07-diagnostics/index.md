# C# 诊断总览

这套内容面向已经掌握 C# 与 .NET 运行时基础、希望系统排查线上问题的开发者。诊断从「故障现象」出发定位到具体机制，再回到对应原理章节验证根因，而不是凭单点指标下结论。

## 按故障现象定位

| 你看到的现象 | 先去的入口 |
| :-- | :-- |
| 内存持续增长、OOM、GC 频繁 | [内存诊断](./01-memory/chapter-01-memory-diagnostics.md) |
| 堆外/非托管内存增长 | [内存诊断](./01-memory/chapter-01-memory-diagnostics.md) |
| CPU 利用率高、响应变慢 | [CPU 与性能诊断](./03-performance/chapter-01-cpu-performance.md) |
| 请求卡死、死锁、线程池饥饿 | [并发诊断](./02-concurrency/chapter-01-concurrency-diagnostics.md) |
| 异步方法「没执行完」、`async void` 崩溃 | [并发诊断](./02-concurrency/chapter-01-concurrency-diagnostics.md) |
| 获取数据库连接超时、慢查询 | [数据访问](../06-data-access/chapter-03-query-tuning.md) |

## 诊断工具

.NET 提供一套诊断工具，按用途分：

| 工具 | 用途 |
| :-- | :-- |
| `dotnet-counters` | 实时查看 GC、线程池、分配速率等指标 |
| `dotnet-trace` | 采集 CPU、分配、事件追踪 |
| `dotnet-dump` | 生成和分析内存转储 |
| `dotnet-gcdump` | 采集托管堆快照，定位内存占用 |

这些工具是诊断的「证据采集」手段。先采集指标和转储，再回到对应原理章节解读证据，而不是先凭经验改配置。

## 诊断原则

1. **先现象后根因**：从症状（OOM、CPU 高、卡死）出发，不要先假设属于哪个技术域。
2. **先证据后结论**：采集指标、转储、日志，确认根因再动手，不要凭单一指标下判断。
3. **先测量后优化**：用工具量化问题，优化后再量化验证，确认是真实改进。
4. **机制优先于参数**：理解 GC、线程池、异步的机制，比记住几个配置参数更可靠。

## 内容边界

- 本专题负责 .NET 运行时、并发异步、性能的诊断方法与案例。
- 数据访问的慢查询、连接池问题在[数据访问](../06-data-access/chapter-03-query-tuning.md)专题。
- 通用可观测性、日志与监控实践由[工程](../../engineering/index.md)专题负责。
