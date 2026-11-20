---
type: explanation
level: advanced
---

# lock 与 Monitor：互斥的内部机制

本页回答三个问题：`lock` 编译成什么，`Monitor` 如何基于对象实现互斥，`Monitor.Wait`/`Pulse` 如何实现条件等待。共享状态见[线程与同步](./chapter-04-threading-synchronization.md)。

## 1. lock 是 Monitor 的语法糖

`lock` 编译为 `Monitor.Enter`/`Monitor.Exit` 的 try/finally 结构：

```csharp
lock (sync)
{
    counter++;
}
```

等价于：

```csharp
bool lockTaken = false;
try
{
    Monitor.Enter(sync, ref lockTaken);
    counter++;
}
finally
{
    if (lockTaken)
    {
        Monitor.Exit(sync);
    }
}
```

`lockTaken` 标志保证「进入锁成功才释放」，避免在 `Enter` 抛异常时错误地 `Exit` 一把没持有的锁。

## 2. 锁基于对象的同步块

`Monitor` 利用每个托管对象的对象头（见[类型布局与内存](../02-dotnet-runtime/chapter-02-type-layout-memory.md)）里的同步信息来实现锁。锁住的是「对象」，因此：

- 锁同一个对象才互斥，锁不同对象互不影响。
- 应使用专用的 `private readonly object` 作为锁对象，不要锁 `this`、字符串或类型对象——它们可能被外部代码共享，导致不可控的竞争。

当锁竞争激烈时，运行时可能用更重的同步结构（如内核级事件）替代轻量的自旋，这一「膨胀」过程由运行时自动完成。

## 3. lock 提供两层保证

`lock` 同时提供两个正交的保证：

1. **互斥**：同一时间只有一个线程进入临界区。
2. **内存屏障**：进入是 acquire（之后的读写不重排到进入之前），退出是 release（之前的读写不重排到退出之后）。

因此锁内的共享变量读写天然满足可见性和顺序（见[内存模型](./chapter-07-memory-model.md)），不需要额外的 `volatile`。这是锁比手工内存屏障可靠的根本原因——它把「互斥」和「可见性」绑在一起。

## 4. Monitor.Wait 与 Pulse：条件等待

`Monitor.Wait`/`Pulse` 实现条件变量语义：线程在条件不满足时释放锁并等待，条件满足时被唤醒重新抢锁。

```csharp
private readonly object sync = new();
private readonly Queue<int> queue = new();

void Produce(int item)
{
    lock (sync)
    {
        queue.Enqueue(item);
        Monitor.Pulse(sync); // 唤醒一个等待的消费者
    }
}

int Consume()
{
    lock (sync)
    {
        while (queue.Count == 0)
        {
            Monitor.Wait(sync); // 释放锁并等待，被唤醒后重新抢锁
        }
        return queue.Dequeue();
    }
}
```

两个关键点：

- `Wait` 必须用 `while` 循环检查条件，而不是 `if`：被唤醒不代表条件一定满足（可能被其他线程抢先，或虚假唤醒）。
- `Wait` 在等待时释放锁，被唤醒后重新获取锁，再继续执行。

`Monitor.Wait`/`Pulse` 是手写生产者-消费者的低层工具。大多数场景用 `Channel`、`BlockingCollection` 等高层抽象（见[并发集合](./chapter-10-concurrent-collections.md)）更安全。

## 5. 锁的代价与选择

锁的代价来自竞争：无竞争时 `Monitor` 很快（轻量级），竞争激烈时会自旋、阻塞甚至进入内核态，开销显著上升。

选择依据：

- 临界区短、竞争低 → `lock` 足够。
- 单个变量的原子更新 → `Interlocked`（见[Interlocked 与无锁编程](./chapter-09-interlocked-lockfree.md)），比锁更轻。
- 读多写少 → `ReaderWriterLockSlim`。
- 需要限流 → `SemaphoreSlim`。

## 6. 后续阅读

- [内存模型](./chapter-07-memory-model.md)解释锁隐含的内存屏障。
- [Interlocked 与无锁编程](./chapter-09-interlocked-lockfree.md)解释锁之外的选择。
- [并发集合](./chapter-10-concurrent-collections.md)解释高层并发容器。
- [并发诊断](../07-diagnostics/02-concurrency/chapter-01-concurrency-diagnostics.md)解释死锁的排查。

> 本页的技术边界按 .NET 10 / C# 14 核对；`lock` 与 `Monitor` 的语义由 C# 语言规范与 .NET 运行时定义。官方参考：[C# 语言参考](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/lock)、[Monitor](https://learn.microsoft.com/en-us/dotnet/api/system.threading.monitor)。
