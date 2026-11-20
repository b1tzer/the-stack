---
type: explanation
level: advanced
---

# C# 内存模型与 volatile：跨线程的可见性

本页回答三个问题：为什么多线程下的读写可能「看不到」或「看到乱序」，`volatile` 提供什么保证，内存屏障在何时需要。这是理解锁和原子操作正确性的基础。

## 1. 为什么需要内存模型

单线程中，代码按书写顺序执行，读到的是自己刚写的值。多线程中，编译器和 CPU 会重排指令、用缓存提升性能，一个线程的写入不一定立即可见于另一个线程：

```csharp
// 线程 A
data = 42;
ready = true;

// 线程 B
while (!ready) { }
Console.WriteLine(data); // 不保证是 42
```

线程 B 可能看到 `ready == true` 却读到旧的 `data`。原因是：编译器可能重排 A 的两条赋值，CPU 缓存和指令重排也让写入的可见顺序与书写顺序不一致。内存模型就是规定「哪些读写顺序能被跨线程观察到」的规则。

## 2. 无同步 = 无保证

没有任何同步手段时，跨线程访问共享变量是数据竞争（data race），行为未定义。编译器只保证单线程语义，跨线程的可见性、顺序都没有保证：

```csharp
int counter = 0;
// 多个线程 counter++ —— 数据竞争，结果不确定
```

这不是「偶尔读错」的问题，而是语义上没有定义。任何依赖共享变量的并发逻辑都必须引入同步。

## 3. volatile

`volatile` 字段告诉编译器：对该字段的读写不能被重排，且每次读取都从主存读、每次写入都写到主存：

```csharp
private volatile bool ready;

// 线程 A
ready = true;   // 写入有释放语义

// 线程 B
while (!ready) { } // 读取有获取语义，之后的读能看到 ready 之前的写入
```

`volatile` 提供**获取/释放**语义：读取是 acquire（之后的读写不能重排到它之前），写入是 release（之前的读写不能重排到它之后）。它适用于「用单个标志位做发布」的场景，如上面的 `ready` 标志。

`volatile` 不是锁，它不能保证「读-改-写」的原子性。`counter++` 即使 `counter` 是 `volatile`，也仍然是三步非原子操作，多线程自增仍会丢失。

## 4. 内存屏障

`Thread.MemoryBarrier()` 是完整屏障，阻止屏障两侧的读写被跨过屏障重排：

```csharp
// 线程 A
data = 42;
Thread.MemoryBarrier(); // 屏障：data 的写入先于 ready
ready = true;
```

`Volatile.Read`/`Volatile.Write` 提供更精确的获取/释放语义：

```csharp
Volatile.Write(ref ready, true);  // 释放
bool r = Volatile.Read(ref ready); // 获取
```

显式内存屏障是低层工具，容易写错。大多数场景用 `lock`、`Interlocked`、`volatile` 字段等高层原语，它们内部已包含正确的内存屏障。

## 5. 锁与原子操作的隐含屏障

`lock`、`Interlocked` 等同步原语隐式提供内存屏障：

- `lock` 进入是 acquire，退出是 release。
- `Interlocked` 操作是全栅栏（full fence）。

这意味着用 `lock` 保护共享变量时，锁内的读写自动满足可见性和顺序要求，无需额外 `volatile`。正确使用锁，就无需手工内存屏障。

## 6. 何时需要关心内存模型

日常业务代码只要「用锁或原子操作保护共享状态」就足够，无需理解内存模型细节。需要直接关心内存模型的是：

- 写无锁数据结构（见[Interlocked 与无锁编程](./chapter-09-interlocked-lockfree.md)）。
- 用 `volatile` 做发布标志。
- 排查「偶发读到旧值」的诡异 bug。

经验法则：**优先用锁，只有锁成为瓶颈时才考虑无锁，且无锁代码必须深刻理解内存模型**。

## 7. 后续阅读

- [lock 与 Monitor](./chapter-08-lock-monitor.md)解释锁如何同时提供互斥和内存屏障。
- [Interlocked 与无锁编程](./chapter-09-interlocked-lockfree.md)解释无锁结构如何依赖内存屏障。
- [线程与同步](./chapter-04-threading-synchronization.md)解释共享状态的保护。
- [常见并发缺陷](./chapter-06-concurrency-pitfalls.md)汇总数据竞争的典型表现。

> 本页的技术边界按 .NET 10 / C# 14 核对；C# 内存模型由 ECMA-334 定义，.NET 实现提供了比规范更强的保证。官方参考：[C# 语言规范](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/)、[内存模型](https://learn.microsoft.com/en-us/dotnet/standard/threading/)。
