---
type: explanation
level: advanced
---

# 线程池：工作线程、注入与饥饿

本页回答三个问题：线程池如何调度 `Task`，线程何时注入何时回收，饥饿如何发生和避免。异步模型见[Task 与 async/await](./chapter-02-task-async-await.md)。

## 1. 线程池是什么

线程池维护一组可复用的工作线程，`Task.Run`、`async` 恢复、`Parallel` 等都运行在它上面：

```csharp
Task.Run(() => DoWork()); // 排队到线程池
```

线程池避免频繁创建销毁线程：线程是昂贵资源（栈空间、调度成本），复用它们能显著提升吞吐。线程池动态调整线程数，按需注入、空闲时回收。

## 2. 工作线程与注入

线程池有两个关键指标：

- **工作线程数**：当前存在的线程。
- **队列长度**：排队等待执行的任务数。

当任务排队而线程都被占用时，线程池会**注入新线程**来消化队列。但注入不是瞬间完成的：它用「爬坡」策略，每秒钟注入有限数量的线程，避免突发流量下无节制创建线程。

这个「爬坡」意味着：突发大量任务时，队列会先堆积，线程数逐步上升。这是正常的自适应行为，不是故障。

## 3. 线程池饥饿

饥饿（starvation）是线程池最常见的严重问题：**线程都被阻塞占住，新任务排队等不到线程**。

典型根因是在线程池线程上**同步阻塞**等待异步操作：

```csharp
// 反例：线程池线程上 .Result/.Wait 同步阻塞
Task.Run(() =>
{
    var result = FetchAsync().Result; // 阻塞工作线程
});
```

工作线程被 `.Result` 阻塞，异步操作完成后又要线程池线程来恢复，但线程都被占住，形成「等线程 → 无线程」的死循环。证据是队列长度持续增长、线程数不涨或已到上限、请求大量超时。

**修复**：消除同步阻塞，一路 `async/await`（见[Task 与 async/await](./chapter-02-task-async-await.md)）。真正的 I/O 用异步等待，不让线程阻塞在 I/O 上。

## 4. 调优：SetMinThreads

`ThreadPool.SetMinThreads` 设置线程池的最小线程数，影响启动时的线程数和注入的初始值：

```csharp
ThreadPool.SetMinThreads(workerThreads, completionPortThreads);
```

它不能「解决」饥饿——饥饿的根因是同步阻塞，不是线程数不够。盲目调大 `MinThreads` 只是延迟暴露问题，还增加内存占用。正确做法是先修同步阻塞，再根据压测数据决定是否调整。

`SetMaxThreads` 设上限，但除非确知后果，否则不要随意调，避免限制线程池的正常注入。

## 5. 线程池与 async/await

`async/await` 正是为解决「线程阻塞在 I/O 上」而设计的（见[为什么需要异步](./chapter-01-why-async.md)）：

- 同步 I/O：线程阻塞等待，占住线程。
- 异步 I/O：`await` 让出线程，I/O 完成后再恢复，线程可服务其他任务。

因此异步模型下，线程池用少量线程就能服务大量并发 I/O 请求。反过来，在 `async` 方法里做 CPU 密集的阻塞计算，仍会占住线程——CPU 密集任务应 `Task.Run` 到线程池隔离，而不是阻塞当前上下文线程。

## 6. 后续阅读

- [Task 与 async/await](./chapter-02-task-async-await.md)解释线程池上的异步恢复。
- [为什么需要异步](./chapter-01-why-async.md)解释 I/O 与线程池的关系。
- [并发诊断](../07-diagnostics/02-concurrency/chapter-01-concurrency-diagnostics.md)解释饥饿的定位。
- [并行与 LINQ](./chapter-05-parallel-linq.md)解释 CPU 密集任务的并行。

> 本页的技术边界按 .NET 10 / C# 14 核对；线程池的注入与爬坡策略随运行时版本演进。官方参考：[线程池](https://learn.microsoft.com/en-us/dotnet/standard/threading/the-managed-thread-pool)。
