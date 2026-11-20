---
type: explanation
level: advanced
---

# asyncio、协程与事件循环

本页面向已经了解 GIL 和三种并发模型选择、想深入 asyncio 的读者，回答三个问题：事件循环怎么驱动协程，`create_task` 和 `gather` 如何并发，`async with` 和 `async for` 是什么。这是[并发模型与 GIL](./chapter-09-concurrency.md)里 asyncio 概述的深入。

生成器是协程的底层基础，见[迭代协议与 Pythonic 写法](./chapter-08-pythonic.md)。

## 1. 事件循环与协程

asyncio 的核心是事件循环（event loop）：一个单线程调度器，在协程之间反复切换。协程用 `async def` 定义，执行到 `await` 时让出控制权，事件循环切换到其他可运行的协程。

`asyncio.run()` 创建事件循环、运行入口协程并关闭循环：

```python
import asyncio

async def main():
    print('hello')

asyncio.run(main())
```

`await` 只能作用于可等待对象（awaitable）：协程、`Task` 和 `Future`。`await` 不是阻塞线程，而是把控制权交回事件循环，等被等待的对象就绪后再恢复。

## 2. 用 Task 并发

直接 `await` 协程是顺序执行。要并发，用 `asyncio.create_task` 把协程包装成 `Task` 交给事件循环，或直接用 `asyncio.gather` 并发等待多个：

```python
import asyncio

async def task(name, delay):
    await asyncio.sleep(delay)
    return f'{name} done'

async def main():
    t1 = asyncio.create_task(task('a', 0.3))
    t2 = asyncio.create_task(task('b', 0.1))
    t3 = asyncio.create_task(task('c', 0.2))
    return await asyncio.gather(t1, t2, t3)

asyncio.run(main())   # ['a done', 'b done', 'c done']，总耗时约 0.3s 而非 0.6s
```

三个任务并发执行，`gather` 按参数顺序返回结果，总耗时由最慢的任务决定。`gather` 默认在任一任务抛异常时立即抛出；需要"部分失败也能拿到其他结果"时用 `return_exceptions=True`。

## 3. async with 与 async for

协程里的资源管理和迭代有对应的异步版本，语义与同步版一致，只是挂起点用 `await`：

```python
async def use():
    async with open_resource() as r:      # 进入/退出时可能 await
        pass

    async for item in async_gen():        # 每次迭代之间可能 await
        pass
```

- **异步上下文管理器**实现 `__aenter__`/`__aexit__`，对应同步的 `__enter__`/`__exit__`，用于异步获取和释放连接、锁等资源。
- **异步迭代器**实现 `__aiter__`/`__anext__`，对应同步的 `__iter__`/`__next__`，用于从流式接口逐条读取数据。

## 4. 阻塞调用是 asyncio 的敌人

事件循环是单线程的，任何阻塞调用（同步网络请求、`time.sleep`、CPU 密集计算）都会卡住整个循环，让其他协程无法运行。三条规则：

- IO 用异步库（`httpx.AsyncClient`、`aiohttp`），不用同步的 `requests`、`urllib`。
- 阻塞的同步函数要放进线程池：`await asyncio.to_thread(sync_func, ...)`，避免卡住事件循环。
- CPU 密集任务交给 `multiprocessing`，不要放进 asyncio 协程。

异步库生态有"同步/异步两套 API"的问题：同一个库常有 `requests`（同步）和 `httpx.AsyncClient`（异步）两套接口，混用会导致异步函数里出现阻塞调用。选库时先确认它是否提供 `async` 版本。

## 5. 这一章要记住的结论

事件循环在单线程内调度协程，`await` 是让出控制权而非阻塞线程；`create_task`/`gather` 并发执行协程；异步资源管理和迭代用 `async with`/`async for`；阻塞调用会卡死整个循环，IO 必须用异步库或 `asyncio.to_thread`。

接下来进入[HTTP 客户端与网络编程](../03-python-network/chapter-01-http-client.md)，把同步和异步的网络请求落到具体工具上。
