---
type: explanation
level: advanced
---

# C# 并发诊断：死锁、线程池饥饿与异步卡死

本页回答三个问题：请求卡死时如何判断是死锁还是线程池饥饿，`async` 方法「没执行完」如何定位，如何采集并发现场的证据。机制见[并发异步](../../03-csharp-concurrency/chapter-01-why-async.md)。

## 1. 先分清卡死类型

请求卡死有三种常见根因：

- **死锁**：两个线程各自持锁又等对方（见[线程与同步](../../03-csharp-concurrency/chapter-04-threading-synchronization.md)）。
- **线程池饥饿**：大量任务阻塞线程池线程，新任务排队等不到线程。
- **异步死锁**：同步阻塞 `.Result`/`.Wait()` 与同步上下文冲突（见[常见并发缺陷](../../03-csharp-concurrency/chapter-06-concurrency-pitfalls.md)）。

三者表象都是「卡住」，但证据不同：死锁是锁竞争，饥饿是线程池队列堆积，异步死锁是同步上下文回不去。

## 2. 采集现场

用 `dotnet-dump` 采集转储，分析线程状态：

```txt
dotnet-dump collect --process-id <pid>
```

转储分析能看到每个线程正在等待什么：等锁、等 I/O、还是在线程池队列排队。用 `dotnet-trace` 也能观察线程池指标：

```txt
dotnet-counters monitor --process-id <pid> System.Runtime
```

关注 `ThreadPool Queue Length`（线程池队列长度）和 `ThreadPool Thread Count`（线程数）。队列长度持续增长而线程数不涨，是线程池饥饿的典型信号。

## 3. 定位死锁

转储中两个线程互相等待对方持有的锁，是死锁的直接证据。分析时找：

- 哪些线程在 `Monitor.Enter`/`lock` 等待。
- 这些锁被哪些线程持有。
- 是否形成环。

修复方向：统一加锁顺序、减少锁的数量、缩小临界区。详见[线程与同步](../../03-csharp-concurrency/chapter-04-threading-synchronization.md)。

## 4. 定位线程池饥饿

饥饿的根因通常是：在线程池线程上同步阻塞等待异步操作。

```csharp
// 反例：线程池线程上同步等待
string content = FetchAsync().Result;
```

线程池线程被 `.Result` 阻塞，异步操作完成后又要线程池线程来恢复，但线程都被占住，形成饥饿。证据是大量线程阻塞在 `.Wait`/`.Result`，同时线程池队列堆积。

修复：消除同步阻塞，一路 `async/await`（见[Task 与 async/await](../../03-csharp-concurrency/chapter-02-task-async-await.md)）。

## 5. 定位 async 卡死

`async` 方法「没执行完」或卡死，常见根因：

- 同步上下文死锁（UI 线程 `.Result`）。
- 未 `await` 的 `Task` 被丢弃（任务泄漏）。
- 死循环中的 `await` 永远不完成。

转储中看 `async` 状态机的暂停点：方法停在哪个 `await`，等待的 `Task` 是否完成。结合日志确认调用链是否 `async` 到底。

## 6. 排查顺序

1. 确认现象是「卡死」还是「慢」，是偶发还是必现。
2. 采集转储和线程池指标，定位是锁等待、队列堆积还是同步上下文问题。
3. 找到根因代码，修复后用小范围压测复现验证。
4. 并发问题难复现，修复要辅以日志和监控，而不是只依赖一次通过。

## 7. 后续阅读

- [线程与同步](../../03-csharp-concurrency/chapter-04-threading-synchronization.md)解释锁与原子操作。
- [Task 与 async/await](../../03-csharp-concurrency/chapter-02-task-async-await.md)解释同步上下文。
- [常见并发缺陷](../../03-csharp-concurrency/chapter-06-concurrency-pitfalls.md)汇总死锁与饥饿的模式。
- [线程池饥饿案例](./chapter-02-threadpool-starvation-case.md)看一次 `.Result` 阻塞的完整排查。

> 本页的技术边界按 .NET 10 / C# 14 核对；`dotnet-dump`、`dotnet-counters` 随 .NET SDK 提供。官方参考：[.NET 诊断](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/)、[分析死锁](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/debug-deadlock)。
