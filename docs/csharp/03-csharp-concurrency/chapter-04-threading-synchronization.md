---
type: explanation
level: advanced
---

# C# 线程与同步：共享状态的保护

本页回答三个问题：线程与 `Task` 是什么关系，多线程访问共享状态会出什么问题，如何用锁和原子操作保护共享状态。异步模型见[Task 与 async/await](./chapter-02-task-async-await.md)。

## 1. 线程与线程池

线程是操作系统调度的执行单元。`Task` 是更高层的抽象，它由线程池调度执行，不保证每个 `Task` 独占一个线程：

```csharp
Task.Run(() => DoWork()); // 在线程池线程上执行
```

线程池维护一组可复用的线程，避免频繁创建销毁线程的开销。`Task.Run` 把工作排队到线程池，线程池挑一个空闲线程执行。因此 `Task` 是「要做什么」，线程是「谁来执行」。

## 2. 竞态条件

多个线程并发读写共享状态而没有同步时，结果取决于执行顺序，这就是竞态条件：

```csharp
var counter = 0;

Parallel.For(0, 10000, _ =>
{
    counter++; // 不是原子操作：读、加一、写回三步
});

Console.WriteLine(counter); // 结果不确定，小于等于 10000
```

`counter++` 编译为「读、加一、写回」三步，两个线程可能同时读到相同值，各自加一后写回，导致一次自增丢失。这是数据竞争（data race）——未同步的并发访问。

## 3. 锁：lock 与 Monitor

`lock` 保证同一时间只有一个线程进入临界区：

```csharp
private readonly object sync = new();
private int counter;

void Increment()
{
    lock (sync)
    {
        counter++;
    }
}
```

`lock` 是 `Monitor.Enter`/`Monitor.Exit` 的语法糖。锁住的对象应是专用的私有对象（`private readonly object`），不要锁 `this`、字符串或类型对象——它们可能被外部代码共享，导致不可控的锁竞争或死锁。

锁的代价：竞争时线程会阻塞。锁应保护尽可能小的临界区，且临界区内不要做耗时操作（I/O、调用外部代码），否则锁会被长时间持有。

### 3.1 死锁

两个线程各自持有一把锁、又等待对方释放，就形成死锁：

```csharp
// 线程 A：lock(a) 后 lock(b)
// 线程 B：lock(b) 后 lock(a)
```

避免死锁的关键是**一致的加锁顺序**：所有代码按相同顺序获取多把锁。更根本的办法是减少共享状态和锁的数量。

## 4. 原子操作：Interlocked

简单的自增、交换、比较交换可以用 `Interlocked`，它是硬件级别的原子操作，比 `lock` 更轻：

```csharp
Interlocked.Increment(ref counter);
Interlocked.Add(ref total, 5);
Interlocked.Exchange(ref flag, 1);
```

`Interlocked` 适合单个变量的原子更新。多个变量需要一起更新、或需要「读-改-写」复合操作时，仍要用 `lock`，因为 `Interlocked` 无法原子地完成跨变量的复合操作。

## 5. 其他同步原语

| 原语 | 用途 |
| :-- | :-- |
| `SemaphoreSlim` | 限制同时访问资源的线程数（限流） |
| `ReaderWriterLockSlim` | 读多写少时允许多个读者、单个写者 |
| `ManualResetEventSlim` | 线程间信号通知 |
| `ConcurrentDictionary` 等 | 线程安全的集合 |

`SemaphoreSlim` 是常见的限流手段，也支持异步等待：

```csharp
var semaphore = new SemaphoreSlim(3); // 最多 3 个并发
await semaphore.WaitAsync();
try
{
    await DoWorkAsync();
}
finally
{
    semaphore.Release();
}
```

并发集合（`ConcurrentDictionary`、`ConcurrentQueue` 等）内部实现了线程安全，但它们的单个操作线程安全，不等于「多个操作组成的复合逻辑」也线程安全——「检查再写入」这类复合操作仍需要额外的同步或使用集合提供的原子方法（如 `GetOrAdd`）。

## 6. 同步的边界

同步只在确实存在共享可变状态时需要。原则是：

- 优先避免共享状态：把数据隔离在线程/任务内部，或使用不可变数据（见[对象与值语义](../01-csharp-language/chapter-03-object-values.md)）。
- 需要共享时，用最小的同步原语：单个变量用 `Interlocked`，临界区用 `lock`，限流用 `SemaphoreSlim`。
- 锁内不做耗时操作，多把锁保持一致的顺序。

## 7. 后续阅读

- [Task 与 async/await](./chapter-02-task-async-await.md)解释异步场景下的同步上下文。
- [并行与 LINQ](./chapter-05-parallel-linq.md)解释 CPU 密集任务的并行化。
- [常见并发缺陷](./chapter-06-concurrency-pitfalls.md)汇总死锁与共享状态的陷阱。

> 本页的技术边界按 .NET 10 / C# 14 核对；`SemaphoreSlim`、`Interlocked` 等由 .NET 线程库提供。官方参考：[.NET 文档](https://learn.microsoft.com/en-us/dotnet/)、[线程与同步](https://learn.microsoft.com/en-us/dotnet/standard/threading/)。
