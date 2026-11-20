---
type: explanation
level: advanced
---

# 异步流与 Channels：流式数据与生产者-消费者

本页回答三个问题：`IAsyncEnumerable` 如何逐个产出异步结果，`await foreach` 与普通迭代有何不同，`Channel` 如何构建异步生产者-消费者。异步基础见[Task 与 async/await](./chapter-02-task-async-await.md)。

## 1. 为什么需要异步流

普通集合一次返回所有结果，异步方法一次返回一个 `Task<T>`。但有些场景需要**异步地、逐个地**产出多个结果——例如分页读取数据库、逐行读文件、订阅消息流。

`IAsyncEnumerable<T>`（C# 8 起）表达「可异步枚举的序列」，用 `await foreach` 消费：

```csharp
async IAsyncEnumerable<int> RangeAsync(int count)
{
    for (int i = 0; i < count; i++)
    {
        await Task.Delay(10);
        yield return i;
    }
}

await foreach (var item in RangeAsync(5))
{
    Console.WriteLine(item); // 逐个异步产出
}
```

每个 `yield return` 之间可以 `await`，消费者在每次产出时处理，而不是等全部完成。这避免了「一次性把所有结果装进内存」。

## 2. 异步流 vs 普通集合

| | `IEnumerable<T>` | `IAsyncEnumerable<T>` |
| :-- | :-- | :-- |
| 迭代 | `foreach`（同步） | `await foreach`（异步） |
| 产出 | 立即 | 每个元素间可 `await` |
| 资源释放 | `IDisposable` | `IAsyncDisposable` |
| 适用 | 内存数据 | 数据库流、文件流、消息流 |

异步流适合「边读边处理」的大数据量或持续数据源场景，用 `await foreach` 消费。

## 3. Channels：异步生产者-消费者

`System.Threading.Channels` 提供线程安全、异步友好的生产者-消费者通道：

```csharp
var channel = Channel.CreateBounded<int>(capacity: 10);

// 生产者
async Task ProduceAsync()
{
    for (int i = 0; i < 100; i++)
    {
        await channel.Writer.WriteAsync(i); // 满时异步等待，形成背压
    }
    channel.Writer.Complete(); // 标记写入结束
}

// 消费者
async Task ConsumeAsync()
{
    await foreach (var item in channel.Reader.ReadAllAsync())
    {
        Console.WriteLine(item);
    }
}
```

`Channel` 相对 `BlockingCollection` 的优势是**原生异步**：`WriteAsync`/`ReadAllAsync` 异步等待，不阻塞线程。有界通道（`capacity`）在写满时让生产者等待，形成背压，防止消费者被淹没。

## 4. 背压与取消

生产者快于消费者时，有界通道让生产者等待，这就是**背压**（backpressure）——用「减速生产者」替代「无限堆积内存」：

```csharp
await channel.Writer.WriteAsync(item, cancellationToken);
```

`WriteAsync` 支持取消，取消时抛 `OperationCanceledException`。结合 `CancellationToken`（见[取消](./chapter-03-cancellation.md)），可以在关闭时优雅停止生产。

## 5. 何时用 Channels

- 需要异步的生产者-消费者（多生产者、多消费者）。
- 需要背压控制的生产者-消费者。
- 消息/任务队列的轻量实现。

`Channel` 是比 `BlockingCollection`（同步阻塞）、`ConcurrentQueue` + 手工同步更现代的异步方案。适合「解耦生产与消费，且两端都异步」的场景。

## 6. 后续阅读

- [Task 与 async/await](./chapter-02-task-async-await.md)解释异步方法与状态机。
- [取消](./chapter-03-cancellation.md)解释如何取消进行中的流。
- [并发集合](./chapter-10-concurrent-collections.md)对比 `BlockingCollection` 与 `Channel`。

> 本页的技术边界按 .NET 10 / C# 14 核对；`IAsyncEnumerable` 自 C# 8 引入，`System.Threading.Channels` 由 .NET 提供。官方参考：[异步流](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/iteration-statements#await-foreach)、[Channels](https://learn.microsoft.com/en-us/dotnet/core/extensions/channels)。
