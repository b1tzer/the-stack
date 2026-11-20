---
type: explanation
level: advanced
---

# C# 并发常见缺陷：async void、死锁与共享状态

本页汇总 C# 并发编程中最常见、最难排查的几类缺陷，给出症状、成因和修复方式。各机制详见本域前文。

## 1. async void 吞噬异常

**症状**：异步方法抛异常后进程直接崩溃，调用方无法捕获。

**成因**：`async void` 方法没有可供等待的 `Task`，异常无法被正常捕获，直接抛到同步上下文，往往导致进程崩溃：

```csharp
async void OnButtonClick()
{
    await FetchAsync(); // 抛异常 → 崩溃
}
```

**修复**：除事件处理器外，异步方法一律返回 `Task` 或 `Task<T>`。事件处理器是唯一允许 `async void` 的位置，但也要在方法体内部 `try/catch` 兜底。

## 2. 同步阻塞异步导致死锁

**症状**：UI 或带同步上下文的场景中，`await` 卡死永不返回。

**成因**：在同步上下文里用 `.Result` 或 `.Wait()` 同步阻塞等待异步方法，而异步方法恢复时又需要回到被阻塞的同步上下文：

```csharp
// UI 线程上执行：
string content = FetchAsync().Result; // 阻塞 UI 线程等待
// FetchAsync 内部 await 后试图回到 UI 线程 → 死锁
```

同步阻塞占住了上下文线程，而异步方法完成后的恢复又被调度回同一个被占住的线程，形成死锁。

**修复**：不要用 `.Result`/`.Wait()` 同步阻塞异步方法。让调用链一路 `async` 到底；确需同步等待时，用 `GetAwaiter().GetResult()` 也不会解决根本问题——正确做法是消除同步阻塞。

## 3. 库代码未用 ConfigureAwait(false)

**症状**：库在调用方是 UI 时，性能下降或死锁。

**成因**：库方法 `await` 时捕获了调用方的同步上下文，恢复时强制回到该上下文，不必要的调度甚至死锁。

**修复**：库代码在 `await` 上统一 `ConfigureAwait(false)`，避免捕获上下文；应用顶层需要更新 UI 时再决定是否保留。

## 4. 共享可变状态未同步

**症状**：结果偶发错误，且难以复现。

**成因**：多个任务并发读写同一变量，形成数据竞争：

```csharp
var total = 0;
await Task.WhenAll(Enumerable.Range(0, 10000)
    .Select(_ => Task.Run(() => total++))); // 数据竞争
```

**修复**：优先消除共享状态（用不可变数据或任务内局部变量）；必须共享时用 `Interlocked`、`lock` 或并发集合（见[线程与同步](./chapter-04-threading-synchronization.md)）。

## 5. 闭包捕获变量

**症状**：循环中创建的委托捕获了预期之外的变量值。

**成因**：闭包捕获的是变量，不是值。旧版本 `for` 循环中，所有迭代共享同一个循环变量：

```csharp
for (int i = 0; i < 3; i++)
{
    tasks.Add(Task.Run(() => Console.WriteLine(i))); // 都打印 3
}
```

**修复**：在循环体内创建局部副本再捕获。注意 `foreach` 的循环变量自 C# 5 起每次迭代都是新的，已无此问题；但 `for` 循环变量仍共享。

```csharp
for (int i = 0; i < 3; i++)
{
    int local = i;
    tasks.Add(Task.Run(() => Console.WriteLine(local))); // 正确
}
```

## 6. 未等待的 Task（任务泄漏）

**症状**：操作「偶尔」没执行完就结束，或异常被吞掉。

**成因**：创建了 `Task` 却没 `await`，方法提前返回，任务在后台未被观察：

```csharp
async Task HandleAsync()
{
    DoWorkAsync(); // 未 await，异常被吞，可能未执行完
}
```

**修复**：始终 `await` 返回的任务。确实要「即发即忘」时，显式记录或观察异常，而不是默默丢弃。

## 7. 排查思路

并发缺陷的共同特点是难复现、依赖时序。排查时：

1. 先确认是否存在共享可变状态或跨线程访问。
2. 检查是否有 `.Result`/`.Wait()`/`async void` 的同步阻塞。
3. 用日志或调试器记录线程 ID 和执行顺序，缩小竞态窗口。
4. 修复后用小范围复现和压测验证，而不是只依赖一次通过。

## 8. 后续阅读

- [Task 与 async/await](./chapter-02-task-async-await.md)解释同步上下文与 `ConfigureAwait`。
- [线程与同步](./chapter-04-threading-synchronization.md)解释锁与原子操作。
- [诊断](../07-diagnostics/index.md)了解并发问题的系统化排查。

> 本页的技术边界按 .NET 10 / C# 14 核对；`foreach` 循环变量自 C# 5 起每次迭代独立。官方参考：[.NET 文档](https://learn.microsoft.com/en-us/dotnet/)、[异步编程](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/)。
