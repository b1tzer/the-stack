---
type: explanation
level: intermediate
---

# C# 异步：为什么需要异步

本页回答三个问题：同步代码在 I/O 等待时浪费了什么，异步如何不阻塞线程，异步与并行有什么区别。这是理解 `Task` 与 `async/await` 的前提。

## 1. 同步代码的问题

同步代码在调用 I/O 时阻塞当前线程，直到 I/O 完成。以读文件为例：

```csharp
string content = File.ReadAllText("large.txt"); // 阻塞当前线程直到读完
Console.WriteLine(content);
```

`ReadAllText` 期间，当前线程什么都不做，只是等待磁盘返回数据。在 Web 服务里，一个线程通常对应一个请求；线程被阻塞时，新的请求就需要新的线程。当并发请求数超过线程数时，线程池会创建更多线程，但线程有内存和调度成本，且每线程固定占用约 1MB 栈空间——线程数无法无限增长。

结果是：**大量时间花在「等待」上，而不是「计算」上**。I/O 的耗时远大于 CPU 处理耗时，同步模型让稀缺的线程资源空转。

## 2. 异步如何解决

异步模型把「发起 I/O」和「等待完成」分开。发起 I/O 后线程可以去做别的事，I/O 完成时再回来处理结果：

```csharp
string content = await File.ReadAllTextAsync("large.txt"); // 等待期间线程可复用
Console.WriteLine(content);
```

`ReadAllTextAsync` 发起异步读取后立即返回一个 `Task`，`await` 让方法在等待期间「让出」当前线程。I/O 完成时，运行时恢复方法继续执行。关键点：**等待期间不占用线程**，一个线程可以服务多个并发请求。

对 I/O 密集的 Web 服务，异步能显著提升并发能力和资源利用率。一个阻塞在磁盘上的线程和一个空闲等待的线程，前者浪费了本可服务其他请求的能力。

## 3. 异步不是并行

异步和并行解决不同的问题，不要混淆：

| | 异步（async） | 并行（parallel） |
| :-- | :-- | :-- |
| 解决的问题 | 等待 I/O 时线程空转 | CPU 计算任务变快 |
| 手段 | 不阻塞线程 | 多核同时计算 |
| 适用场景 | I/O 密集（网络、磁盘） | CPU 密集（计算、图像） |

```csharp
// 异步：等待 I/O，不阻塞线程
var data = await client.GetStringAsync(url);

// 并行：多核同时计算
Parallel.For(0, 1000, i => HeavyCompute(i));
```

异步让「等待」变便宜，并行让「计算」变快。一个 CPU 密集的计算用异步不会更快——它不产生新的计算能力；它只是不阻塞线程。反过来，一个纯 I/O 等待用并行也帮不上忙。

## 4. 异步的代价

异步不是免费的：

- **代码复杂度**：`async/await` 展开为状态机，异常传播、取消和同步上下文的规则更复杂（见[Task 与 async/await](./chapter-02-task-async-await.md)）。
- **少量分配**：`Task` 和状态机带来额外分配，虽然运行时做了大量优化（值类型状态机等）。
- **传染性**：`async` 会向上传染——调用异步方法的方法通常也要变异步。

因此不要盲目把一切都变成异步。规则是：**I/O 密集且需要高并发的边界用异步，CPU 密集的计算不需要异步**。一个计算密集型的小工具用同步代码更简单。

## 5. 后续阅读

- [Task 与 async/await](./chapter-02-task-async-await.md)解释异步的具体语法和机制。
- [取消](./chapter-03-cancellation.md)解释如何优雅地停止进行中的异步操作。
- [线程与同步](./chapter-04-threading-synchronization.md)解释多线程下共享状态的保护。
- [并行与 LINQ](./chapter-05-parallel-linq.md)解释 CPU 密集任务的并行化。

> 本页的技术边界按 .NET 10 / C# 14 核对；`async/await` 自 C# 5 引入。官方参考：[.NET 文档](https://learn.microsoft.com/en-us/dotnet/)、[异步编程](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/)。
