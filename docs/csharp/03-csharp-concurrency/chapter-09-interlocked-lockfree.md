---
type: explanation
level: advanced
---

# Interlocked 与无锁编程：CAS 与 ABA 问题

本页回答三个问题：`Interlocked` 如何提供原子的读改写，CAS 如何成为无锁结构的基石，无锁编程有哪些陷阱。锁的机制见[lock 与 Monitor](./chapter-08-lock-monitor.md)。

## 1. Interlocked：原子的读改写

`Interlocked` 提供硬件级别的原子操作，避免「读-改-写」被其他线程打断：

```csharp
Interlocked.Increment(ref counter);      // 原子自增
Interlocked.Add(ref total, 5);           // 原子加
Interlocked.Exchange(ref flag, 1);       // 原子赋值并返回旧值
```

`Interlocked` 操作是全栅栏（full fence），既原子又带内存屏障（见[内存模型](./chapter-07-memory-model.md)）。对单个变量的更新，它比 `lock` 更轻——不需要进入互斥区，直接是 CPU 的原子指令。

但它只覆盖单个变量的单个操作。多个变量要一起更新、或需要「读后判断再写」的复合逻辑时，仍要用 `lock`。

## 2. CompareExchange 与 CAS

`CompareExchange` 是 `Interlocked` 的核心：只有当前值等于预期值时，才替换为新值，并返回原始值：

```csharp
int old = Interlocked.CompareExchange(ref target, newValue, expectedValue);
```

这是 CAS（Compare-And-Swap）的 .NET 形式。CAS 是无锁编程的基石：**先读预期值，比较，一致才写回**。并发修改时，若目标值已被别的线程改变，CAS 失败，调用方重试。

## 3. 无锁结构：以无锁计数器为例

一个无锁自增计数器直接基于 `Interlocked`：

```csharp
class AtomicCounter
{
    private int value;

    public int Increment() => Interlocked.Increment(ref value);
    public int Value => Volatile.Read(ref value);
}
```

更复杂的无锁结构（无锁栈、无锁队列）基于「读指针 → CAS 更新指针 → 失败重试」的模式。核心难点是处理 ABA 问题和内存回收。

## 4. ABA 问题

CAS 只比较「值是否相同」，不判断「值是否被改过又改回来」。考虑：

1. 线程 A 读到值 X。
2. 线程 B 把 X 改成 Y，又改回 X。
3. 线程 A 的 CAS 比较发现仍是 X，误以为没变，成功写入。

值相同但状态已经变了。对指针型无锁结构，ABA 可能导致节点被误重用，产生严重 bug。.NET 的 `Interlocked` 不直接解决 ABA；无锁结构通常用「版本号」或「带标签的指针」规避，或用 `GC` 保证被回收的节点不会立即被重用（.NET 的 GC 恰好缓解了部分 ABA 场景，但不是绝对保证）。

## 5. 无锁 vs 锁

无锁结构在极高并发下能避免锁的上下文切换，但代价巨大：

- **正确性极难保证**：内存模型、ABA、内存可见性都要精确处理。
- **可读性差**：CAS 循环比 `lock` 难懂得多。
- **收益有限**：多数业务场景锁竞争并不足以成为瓶颈。

经验法则：**默认用锁或并发集合，只有用基准证明锁是真实瓶颈、且团队有能力验证无锁正确性时，才自己写无锁结构**。`ConcurrentDictionary`、`ConcurrentQueue` 等已经由框架实现并验证，优先复用（见[并发集合](./chapter-10-concurrent-collections.md)）。

## 6. 后续阅读

- [内存模型](./chapter-07-memory-model.md)解释无锁结构依赖的内存屏障。
- [lock 与 Monitor](./chapter-08-lock-monitor.md)对比锁与无锁的选择。
- [并发集合](./chapter-10-concurrent-collections.md)解释框架提供的无锁/低锁集合。

> 本页的技术边界按 .NET 10 / C# 14 核对；`Interlocked.CompareExchange` 对应 CAS 语义，无锁结构需自行处理 ABA。官方参考：[Interlocked](https://learn.microsoft.com/en-us/dotnet/api/system.threading.interlocked)。
