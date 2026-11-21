---
type: howto
level: advanced
---

# 生产诊断：性能、内存与异步排查

本页面向需要排查线上问题的读者，回答一个问题：Python 服务变慢、内存涨、请求卡住时，怎么定位原因。前置知识是[并发模型与 GIL](../01-python-language/chapter-09-concurrency.md)和 [asyncio、协程与事件循环](../01-python-language/chapter-11-asyncio.md)。

## 1. 性能诊断：找到慢在哪

**cProfile** 是标准库的性能分析器，统计每个函数的调用次数和耗时：

```python
import cProfile
import pstats

def main():
    ...

cProfile.run('main()', 'profile.out')
p = pstats.Stats('profile.out')
p.sort_stats('cumulative').print_stats(10)   # 按累计耗时打印前 10
```

关注 `cumulative`（累计耗时，含子调用）而不是 `tottime`（自身耗时），通常慢点在最外层入口函数附近。用 `pstats` 按字段排序、打印前 N 条，快速定位热点函数。

**py-spy** 是不需要改代码的采样分析器，能直接 attach 到运行中的进程：

```txt
pip install py-spy
py-spy top --pid 12345          # 实时看 CPU 热点
py-spy dump --pid 12345         # 抓一次调用栈
```

py-spy 适合诊断"已经在跑、不方便重启"的生产进程，因为它不侵入、开销低。

## 2. 内存诊断：找到谁占内存

**tracemalloc** 是标准库的内存追踪器，记录内存分配的调用栈：

```python
import tracemalloc

tracemalloc.start()
# ... 运行一段代码 ...
snapshot = tracemalloc.take_snapshot()
top = snapshot.statistics('lineno')   # 按行号统计
for stat in top[:10]:
    print(stat)
```

按分配最多的行号排序，能看到内存主要被哪些代码分配。发现内存持续增长时，先在两个时间点各取一个 snapshot，用 `compare_to` 看增量来自哪里。

内存增长最常见的原因：全局缓存只增不减、对象被意外持有（如放进全局 list 忘了清）、循环引用导致引用计数无法回收。

## 3. 异步与并发诊断

**事件循环卡住**：asyncio 是单线程，一个阻塞调用会卡住所有协程。症状是"所有请求同时变慢"。排查：检查有没有在协程里调用同步阻塞库（`requests`、`time.sleep`、同步数据库驱动）。

```python
import asyncio, time

# 慢：阻塞事件循环
async def bad():
    time.sleep(5)            # 卡住整个循环

# 对：用异步版本或丢线程池
async def good():
    await asyncio.sleep(5)   # 让出控制权
    await asyncio.to_thread(time.sleep, 5)   # 阻塞操作丢线程池
```

**死锁 / 任务未完成**：打开 asyncio 调试模式，让它在发现慢任务和未等待的协程时告警：

```txt
PYTHONASYNCIODEBUG=1 python3 main.py
```

调试模式会告警"任务执行过慢"和"协程从未被等待"，帮助发现没被 `await` 的任务。

**GIL 竞争**：CPU 密集任务多线程不加速，见[并发模型与 GIL](../01-python-language/chapter-09-concurrency.md)。判断是否 GIL 竞争：`py-spy` 看到大量时间在锁等待，或 CPU 密集但吞吐不随 worker 增加。

## 4. 日志与可观测性

生产必须有结构化日志，才能知道"发生了什么"：

```python
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(name)s %(message)s',
)
logger = logging.getLogger(__name__)
logger.info('请求处理完成: %s', request_id)
```

关键原则：每个请求带一个唯一 id（request_id）贯穿日志，出错时能串起整个请求链；异常要记录完整堆栈（`logger.exception`）；日志级别生产设为 INFO 或 WARNING，避免 DEBUG 刷屏。

## 5. 这一章要记住的结论

性能用 cProfile（离线分析）和 py-spy（在线采样）定位热点；内存用 tracemalloc 追踪分配来源；异步卡顿排查阻塞调用，用 asyncio 调试模式发现慢任务；生产用带 request_id 的结构化日志串联请求链。
