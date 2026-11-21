---
type: explanation
level: advanced
---

# 案例：.Result 同步阻塞导致线程池饥饿

本页还原一次线程池饥饿的定位：从「请求大量超时」追溯到「`.Result` 同步阻塞线程池线程」。方法论见[并发诊断](./chapter-01-concurrency-diagnostics.md)。

## 1. 现象

一个 Web API 在低流量时正常，流量一上来，请求就大面积超时。奇怪的是 CPU 利用率不高，数据库也没压力。请求像是「排队等不到处理」，而不是「处理慢」。

## 2. 采集证据

用 `dotnet-counters` 观察线程池：

```txt
dotnet-counters monitor --process-id <pid> System.Runtime
```

关键信号：

- `ThreadPool Queue Length`（队列长度）随流量持续增长，居高不下。
- `ThreadPool Thread Count`（线程数）涨到上限后不再增长。
- CPU 和 I/O 都空闲。

队列堆积 + 线程数封顶 + CPU 空闲，是**线程池饥饿**的典型画像：大量任务在排队，但线程都被占住，没有空闲线程去消化队列。

## 3. 定位根因

采集线程转储，发现大量线程池线程阻塞在 `.Result` / `.Wait()` 上：

```csharp
public Order GetOrder(int id)
{
    // 同步方法里用 .Result 阻塞等待异步调用
    var order = FetchOrderAsync(id).Result;
    return order;
}
```

根因链条是：

1. `GetOrder` 是同步方法，在请求线程上执行 `.Result`，把线程阻塞在等 `FetchOrderAsync` 完成。
2. `FetchOrderAsync` 内部的 `await` 完成后，需要**线程池线程**来恢复。
3. 但线程池线程都被 `.Result` 占住了，没有线程来恢复。
4. 新请求排队，线程池爬坡注入新线程，但新线程也被 `.Result` 占住。

形成「等线程 → 无线程」的死循环。CPU 空闲是因为线程都在**等待**，不是在计算。

## 4. 根因判断

本质是「同步阻塞 + 异步」混用：在应该异步的调用链里，用 `.Result`/`.Wait()` 把异步操作变回同步阻塞，占住了线程池的稀缺线程。调大线程数只是延迟暴露，不解决根因。

## 5. 修复

把调用链改成一路 `async/await`，消除同步阻塞：

```csharp
public async Task<Order> GetOrderAsync(int id)
{
    return await FetchOrderAsync(id); // 不阻塞线程
}
```

调用方（控制器动作）也改成 `async`，让异步一路到底。真正的 I/O 用 `await` 等待，线程在等待期间可服务其他请求。

## 6. 验证

修复后压测：

- `ThreadPool Queue Length` 不再堆积，随流量波动。
- 同样流量下不再超时。
- 线程数不再涨到封顶（异步模型用少量线程服务大量并发 I/O）。

量化验证：对比修复前后「队列长度」和「超时率」两个指标，确认根因消除，而不是只看一次压测通过。

## 7. 后续阅读

- [并发诊断](./chapter-01-concurrency-diagnostics.md)解释饥饿的定位方法。
- [Task 与 async/await](../../03-csharp-concurrency/chapter-02-task-async-await.md)解释同步上下文与阻塞。
- [线程池](../../03-csharp-concurrency/chapter-11-thread-pool.md)解释线程池注入与饥饿机制。
- [常见并发缺陷](../../03-csharp-concurrency/chapter-06-concurrency-pitfalls.md)汇总 `.Result` 等反模式。

> 本页的技术边界按 .NET 10 / C# 14 核对；`dotnet-counters`、`dotnet-dump` 随 .NET SDK 提供。官方参考：[.NET 诊断](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/)。
