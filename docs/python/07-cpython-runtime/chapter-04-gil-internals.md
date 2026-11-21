---
type: explanation
level: advanced
---

# GIL 的内部实现

本页面向已经理解"GIL 让多线程不加速"、想深入机制的读者，回答两个问题：GIL 到底怎么工作、何时释放，free-threaded 模式如何去掉它。前置知识是语言核心[并发模型与 GIL](../01-python-language/chapter-09-concurrency.md)和上一章的引用计数。

## 1. GIL 是什么：一把保护引用计数的锁

语言核心章节讲过，GIL（全局解释器锁）保证同一时刻只有一个线程执行 Python 字节码。它的存在，本质是为了保护上一章讲的**引用计数**：如果两个线程同时改一个对象的 `ob_refcnt`，计数就会错乱。

在 CPython 早期，去掉 GIL 意味着给每个引用计数操作加锁或改成原子操作，这在当时会让单线程性能明显下降。权衡之下，CPython 选择了"用一把全局锁换来简单的内存管理"。

## 2. GIL 的获取与释放

一个线程要执行 Python 字节码，必须先拿到 GIL；执行一段时间后必须释放，让别的线程有机会运行。释放发生在两个时机：

1. **主动让出**：线程做 IO（读文件、等网络、`sleep`）时会释放 GIL，等 IO 完成再抢回来。这就是 IO 密集任务多线程有效的原因。
2. **时间片耗尽**：线程执行字节码达到一定时长后，被迫释放 GIL，让其他线程有机会抢。这个时长由 `sys.setswitchinterval` 控制：

```python
import sys
print(sys.getswitchinterval())    # 0.005，即 5 毫秒
sys.setswitchinterval(0.001)      # 改成 1 毫秒
```

默认每 5 毫秒强制切换一次线程。这个"切换"是有代价的：线程被挂起、另一个线程被唤醒、重新抢锁，来回的上下文切换本身要花时间。

## 3. 为什么 CPU 密集多线程不加速

CPU 密集的纯 Python 代码，线程既不释放 GIL（没有 IO），又会被时间片强制切换。结果是：**多线程轮流执行，但任何时刻只有一个线程在真正算**，总计算量没变，反而多了切换开销：

```python
import threading, time

def spin(n):
    total = 0
    for i in range(n):
        total += i * i
    return total

N = 20_000_000
# 单线程
t0 = time.perf_counter()
spin(N); spin(N)
print('单线程:', time.perf_counter() - t0)

# 双线程
t0 = time.perf_counter()
t1 = threading.Thread(target=spin, args=(N,))
t2 = threading.Thread(target=spin, args=(N,))
t1.start(); t2.start(); t1.join(); t2.join()
print('双线程:', time.perf_counter() - t0)   # 不会比单线程快，甚至更慢
```

这不是 Python 的 bug，而是 GIL 的直接后果：多线程在 CPU 密集任务上**串行化**了。要真正并行，只能绕过 GIL——用多进程（[并发模型与 GIL](../01-python-language/chapter-09-concurrency.md)里讲过），或者用 C 扩展（C 代码在执行时可以释放 GIL）。

## 4. free-threaded：去掉 GIL

Python 3.13 引入了实验性的 free-threaded 模式（PEP 703），可以关掉 GIL；到 3.14 它已经成为**官方支持**的特性（PEP 779），但默认的 CPython 仍然带 GIL，free-threaded 是单独的构建。

去掉 GIL 要解决的核心问题，还是引用计数：没有全局锁保证原子性了，就必须给引用计数换一种实现。free-threaded 的方案包括：

- **偏向引用计数（biased reference counting）**：让"同一线程内反复增减"成为廉价操作，只有跨线程才需要同步。
- **延迟引用计数 + 用 GC 兜底**：部分计数操作延迟到 GC 统一处理。
- **对象级锁**：给可变容器加更细粒度的锁，替代全局锁。

代价是：单线程性能可能下降（引用计数变复杂了）、大量 C 扩展还不兼容（它们假设 GIL 存在）。所以 free-threaded 是**方向**，但不是现在默认的选择。

## 5. 动手实验

**实验 1：观察切换间隔**

```python
import sys
print(sys.getswitchinterval())   # 0.005
```

**实验 2：对比 CPU 密集单线程 vs 双线程**

运行上面第 3 节的完整代码，记录两次耗时，确认双线程不比单线程快。

**实验 3：验证 IO 密集多线程有效**

```python
import threading, time

def io_task(name):
    time.sleep(0.2)   # 模拟 IO，会释放 GIL
    print(name)

t0 = time.perf_counter()
threads = [threading.Thread(target=io_task, args=(i,)) for i in range(5)]
for t in threads: t.start()
for t in threads: t.join()
print('5 个 IO 任务总耗时:', time.perf_counter() - t0)   # 约 0.2s，而非 1s
```

对比实验 2 和实验 3：同样的多线程，CPU 密集不加速，IO 密集接近线性加速。差别就在于 IO 会释放 GIL。

## 6. 这一章要记住的结论

GIL 是一把保护引用计数的全局锁；线程在 IO 或时间片耗尽（默认 5ms）时释放它。CPU 密集多线程因此串行化、不加速；IO 密集多线程有效。free-threaded（PEP 703/779）在 3.14 正式支持但非默认，靠偏向引用计数等方案替代 GIL，代价是单线程性能和 C 扩展兼容性。

接下来进入[为什么 Python 慢，如何变快](./chapter-05-performance.md)，把这些机制串成"慢在哪、怎么加速"的完整图景。
