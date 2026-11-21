---
type: explanation
level: advanced
---

# 并发模型与 GIL

本页面向开始写并发代码的读者，回答三个问题：GIL 是什么，为什么多线程不一定更快，`threading`、`multiprocessing`、`asyncio` 三者如何选。

对象模型与解释执行见[引用与对象模型](./chapter-07-references-and-objects.md)；协程依赖的生成器见[迭代协议与 Pythonic 写法](./chapter-08-pythonic.md)。

## 1. GIL 是什么

CPython（官方解释器）有一把全局解释器锁（Global Interpreter Lock，GIL）。它保证同一时刻只有一个线程在执行 Python 字节码，即使机器有多个 CPU 核心。

GIL 存在的历史原因是简化 CPython 的内存管理（引用计数）和 C 扩展的线程安全。它不是语言规范的一部分，而是 CPython 的实现细节——Jython、IronPython 没有 GIL；Python 3.13 起提供实验性的 free-threaded 模式（PEP 703）可关闭 GIL，但默认仍然启用。

## 2. GIL 对并发的实际影响

GIL 的影响取决于任务是 CPU 密集还是 IO 密集。

**CPU 密集任务**：多线程不会加速，甚至因锁切换而略慢。下面的实测在 4 核机器上把两次计算分别用单线程顺序跑和双线程并行跑：

```python
import threading, time

def cpu_bound(n):
    total = 0
    for i in range(n):
        total += i * i
    return total

N = 20_000_000
start = time.perf_counter()
cpu_bound(N); cpu_bound(N)
seq = time.perf_counter() - start

start = time.perf_counter()
t1 = threading.Thread(target=cpu_bound, args=(N,))
t2 = threading.Thread(target=cpu_bound, args=(N,))
t1.start(); t2.start()
t1.join(); t2.join()
par = time.perf_counter() - start
# sequential: 2.22s
# two threads: 2.27s  双线程没有更快
```

纯 Python 的 CPU 密集计算被 GIL 串行化，多线程只是徒增开销。

**IO 密集任务**：多线程仍然有效。线程在等待网络、磁盘、`sleep` 等 IO 时会释放 GIL，让其他线程运行。因此 `threading` 适合 IO 密集的并发。

## 3. 三种并发模型

### 3.1 threading：IO 密集的多线程

`threading` 用多个线程并发执行，适合 IO 密集任务：

```python
import threading

results = []
def fetch(url):
    results.append(f'done {url}')

threads = [threading.Thread(target=fetch, args=(u,)) for u in ['a', 'b', 'c']]
for t in threads: t.start()
for t in threads: t.join()
```

共享可变对象（如 `results`）在多线程下仍有竞态，需要锁或线程安全的数据结构，GIL 不消除数据竞争。

### 3.2 multiprocessing：CPU 密集的多进程

CPU 密集任务要绕过 GIL，用多进程。`multiprocessing` 启动独立进程，各自有独立的 GIL 和内存空间：

```python
from multiprocessing import Pool

def cpu_bound(n):
    return sum(i * i for i in range(n))

with Pool() as pool:
    print(pool.map(cpu_bound, [20_000_000] * 2))
```

多进程真正并行，但进程间不共享内存，通信需要序列化（pickle），开销大于线程。

### 3.3 asyncio：单线程协程

`asyncio` 在单线程内用事件循环调度协程，适合大量并发的 IO 任务（网络请求、长连接）。用 `async`/`await` 定义协程：

```python
import asyncio

async def fetch(url):
    await asyncio.sleep(1)   # 模拟 IO
    return f'done {url}'

async def main():
    results = await asyncio.gather(fetch('a'), fetch('b'), fetch('c'))
    print(results)

asyncio.run(main())
```

`asyncio` 在单线程内切换，无 GIL 竞争、无锁、开销小，但要求所有 IO 操作都是非阻塞的（用 `await` 的异步库）。异步库生态有"同步/异步两套 API"的问题，选库时要看它是否支持 `async`。

## 4. 如何选择

| 任务类型 | 选择 | 原因 |
| :-- | :-- | :-- |
| IO 密集、任务少 | `threading` | 简单，模型直观 |
| CPU 密集 | `multiprocessing` | 绕过 GIL，真正并行 |
| 大量并发 IO、长连接 | `asyncio` | 单线程高并发、低开销 |
| 既有同步库、不想改写 | `threading` | 避免同步库阻塞事件循环 |

三条规则：CPU 密集用进程不用线程；大量 IO 用协程；简单 IO 用线程。不要用多线程跑 CPU 密集的纯 Python 计算，这是最常见的错误。

## 5. 这一章要记住的结论

GIL 让 CPython 同一时刻只有一个线程执行字节码，CPU 密集多线程不加速，IO 密集多线程仍有效。CPU 密集用 `multiprocessing`，大量 IO 用 `asyncio`，简单 IO 用 `threading`。

接下来进入[标准库速查](./chapter-10-standard-library.md)，用标准库解决常见任务而不必引入第三方依赖。
