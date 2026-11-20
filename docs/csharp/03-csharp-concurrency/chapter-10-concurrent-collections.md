---
type: explanation
level: advanced
---

# 并发集合：ConcurrentDictionary、ConcurrentQueue 与 BlockingCollection

本页回答三个问题：并发集合解决什么、内部如何实现线程安全，单个操作线程安全为什么不够，`BlockingCollection` 如何做生产者-消费者。锁与原子操作见[线程与同步](./chapter-04-threading-synchronization.md)。

## 1. 为什么需要并发集合

普通集合（`List<T>`、`Dictionary<TKey,TValue>`）不是线程安全的。多线程同时读写会破坏内部结构，导致元素丢失甚至崩溃。一个选择是每次访问都 `lock`，但锁粒度粗、性能差。

并发集合把线程安全内置到数据结构里，用更细的粒度（分段锁、无锁 CAS）实现，兼顾正确性和性能。

## 2. ConcurrentDictionary

`ConcurrentDictionary<TKey,TValue>` 是线程安全的字典，内部用分桶（按哈希分到多个桶）减少竞争，桶内用细粒度锁：

```csharp
var dict = new ConcurrentDictionary<string, int>();

dict.TryAdd("a", 1);        // 不存在才添加
int value = dict.GetOrAdd("a", 2); // 存在返回，不存在添加并返回
dict.AddOrUpdate("a", 1, (k, old) => old + 1);
```

`TryAdd`、`GetOrAdd`、`AddOrUpdate` 是**原子复合操作**：一次调用完成「检查 + 写入」，不会被打断。这正是并发集合相对「锁一个普通字典」的价值——它提供了正确粒度的原子操作。

## 3. ConcurrentQueue 与 ConcurrentStack

`ConcurrentQueue<T>`（先进先出）和 `ConcurrentStack<T>`（后进先出）内部用无锁算法（CAS）实现入队/出队：

```csharp
var queue = new ConcurrentQueue<int>();
queue.Enqueue(1);
queue.Enqueue(2);

if (queue.TryDequeue(out int item))
{
    Console.WriteLine(item); // 1
}
```

`TryDequeue` 返回是否成功，避免「空队列出队」抛异常。无锁实现让它们在生产者-消费者场景下吞吐很高。

## 4. ConcurrentBag

`ConcurrentBag<T>` 是「无序、可重复、本地优先」的集合，适合「同一线程添加又消费」的场景（如线程本地暂存）。它不保证元素顺序，也不适合需要严格 FIFO 的场景——需要顺序用 `ConcurrentQueue`。

## 5. BlockingCollection：有界的生产者-消费者

`BlockingCollection<T>` 在并发集合上加了「有界 + 阻塞」语义，是生产者-消费者的标准工具：

```csharp
using var bc = new BlockingCollection<int>(boundedCapacity: 10);

// 生产者
Task.Run(() =>
{
    for (int i = 0; i < 100; i++)
    {
        bc.Add(i); // 队列满时阻塞，形成背压
    }
    bc.CompleteAdding();
});

// 消费者
foreach (var item in bc.GetConsumingEnumerable())
{
    Console.WriteLine(item);
}
```

`Add` 在队列满时阻塞（背压），`GetConsumingEnumerable` 在队列空时阻塞、`CompleteAdding` 后自动结束。它把「队列 + 限流 + 阻塞 + 结束信号」封装在一起，比手写 `Monitor.Wait/Pulse` 可靠得多。

## 6. 单个操作安全 ≠ 复合操作安全

并发集合的**单个方法**是线程安全的，但「先检查再写入」这种跨方法的复合逻辑仍然不安全：

```csharp
// 不安全：ContainsKey 和 Add 之间可能被其他线程插入
if (!dict.ContainsKey(key))
{
    dict.Add(key, value);
}

// 安全：用原子复合操作
dict.TryAdd(key, value);
```

要判断「这个操作是否原子」。并发集合提供 `GetOrAdd`、`TryAdd` 等原子方法覆盖常见复合操作；更复杂的跨集合/跨步骤逻辑仍需要额外的 `lock` 或事务化设计。

## 7. 后续阅读

- [线程与同步](./chapter-04-threading-synchronization.md)解释锁与原子操作。
- [Interlocked 与无锁编程](./chapter-09-interlocked-lockfree.md)解释并发集合内部的无锁实现。
- [线程池](./chapter-11-thread-pool.md)解释生产者-消费者如何调度。
- [异步流与 Channels](./chapter-12-async-streams-channels.md)解释异步版的生产者-消费者。

> 本页的技术边界按 .NET 10 / C# 14 核对；并发集合由 `System.Collections.Concurrent` 提供。官方参考：[并发集合](https://learn.microsoft.com/en-us/dotnet/standard/collections/thread-safe/)。
