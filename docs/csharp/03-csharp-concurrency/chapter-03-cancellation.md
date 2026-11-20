---
type: explanation
level: intermediate
---

# C# 异步取消：CancellationToken

本页回答三个问题：如何优雅地停止进行中的异步操作，`CancellationToken` 如何在整个调用链中传播，取消如何与异常区分。取消机制见[Task 与 async/await](./chapter-02-task-async-await.md)。

## 1. 为什么需要取消

长时间运行的操作（网络请求、批量处理）需要能被停止，否则用户取消、服务下线、请求超时都只能等操作自然结束，浪费资源。

取消是**协作式**的：发起方请求取消，执行方在检查点主动响应。.NET 的取消通过 `CancellationToken` 传递这一请求，没有「强制终止线程」的安全机制。

## 2. CancellationTokenSource 与 Token

`CancellationTokenSource` 产生 `CancellationToken`，前者是取消的「开关」，后者是传播的「令牌」：

```csharp
var cts = new CancellationTokenSource();
CancellationToken token = cts.Token;

cts.Cancel(); // 触发取消
Console.WriteLine(token.IsCancellationRequested); // True
```

取消源和令牌分离：发起方持有 `CancellationTokenSource` 负责触发，执行方只接收 `CancellationToken` 检查状态。这避免执行方反过来取消发起方。

## 3. 传播取消

`CancellationToken` 应贯穿整个调用链，作为方法参数从顶层传到底层：

```csharp
async Task ProcessAsync(CancellationToken token)
{
    var data = await FetchAsync(token);      // 传给底层
    await SaveAsync(data, token);            // 继续传递
}
```

底层 API（如 `HttpClient.GetAsync`、`File.ReadAllTextAsync`）通常都有接受 `CancellationToken` 的重载。取消触发时，它们抛 `OperationCanceledException`，异常沿 `await` 向上传播，直到被调用方识别为取消。

## 4. 检查点与超时

没有接收 `CancellationToken` 的代码里，需要手动检查：

```csharp
async Task LoopAsync(CancellationToken token)
{
    while (true)
    {
        token.ThrowIfCancellationRequested(); // 取消时抛异常
        await DoWorkAsync();
    }
}
```

`ThrowIfCancellationRequested` 在取消时抛 `OperationCanceledException`。频繁检查能更快响应取消，但检查本身也有开销，应放在循环边界或阶段之间，而不是最内层热路径。

超时可以用 `CancellationTokenSource.CancelAfter` 或带超时的取消令牌实现：

```csharp
using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
await FetchAsync(cts.Token); // 5 秒后自动取消
```

## 5. 取消与异常的区分

取消抛的是 `OperationCanceledException`。调用方通常单独处理它，因为取消不是错误，而是预期的正常退出：

```csharp
try
{
    await ProcessAsync(token);
}
catch (OperationCanceledException) when (token.IsCancellationRequested)
{
    Console.WriteLine("已取消");
}
catch (Exception ex)
{
    Console.WriteLine($"失败：{ex.Message}");
}
```

`when (token.IsCancellationRequested)` 区分「因取消而抛」和「其他原因恰好抛了 `OperationCanceledException`」两种情况，避免把非取消的异常误判为取消。

## 6. 后续阅读

- [Task 与 async/await](./chapter-02-task-async-await.md)解释取消异常如何沿 `await` 传播。
- [线程与同步](./chapter-04-threading-synchronization.md)解释同步代码中的取消与中断。
- [常见并发缺陷](./chapter-06-concurrency-pitfalls.md)汇总遗漏取消导致的资源泄漏。

> 本页的技术边界按 .NET 10 / C# 14 核对；`CancellationTokenSource.CancelAfter` 与带超时构造器由 .NET 提供，取消是协作式机制。官方参考：[.NET 文档](https://learn.microsoft.com/en-us/dotnet/)、[取消](https://learn.microsoft.com/en-us/dotnet/standard/threading/cancellation-in-managed-threads)。
