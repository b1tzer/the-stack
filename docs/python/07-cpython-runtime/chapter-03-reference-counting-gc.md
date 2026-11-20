---
type: explanation
level: advanced
---

# 引用计数与垃圾回收

本页面向已经理解对象内存布局的读者，回答两个问题：内存什么时候被回收，循环引用怎么处理。前置知识是上一章[对象的内存真相](./chapter-02-object-layout.md)里的引用计数。

示例基于 Python 3.13+；GC 的实现随版本有变化（见第 4 节的版本说明）。

## 1. 引用计数：立即回收的基础

每个对象头上的 `ob_refcnt` 记录引用次数。名字绑定、放进容器、作为参数传递都会让计数 +1；`del`、名字重新绑定、容器销毁会让计数 -1。计数降到 0 的那一刻，对象的内存立刻被回收：

```python
import sys

class Obj:
    pass

o = Obj()
print(sys.getrefcount(o) - 1)        # 1：只有 o 一个名字
lst = [o]
print(sys.getrefcount(o) - 1)        # 2：o 和 lst 里的指针
del o
print(sys.getrefcount(lst[0]) - 1)   # 1：只剩 lst 里的指针
```

引用计数是**立即**的：一旦没有名字指向对象，内存马上回收，不需要等一个后台的"垃圾回收"来扫描。这也是 Python 释放内存如此"及时"的原因。

## 2. 循环引用的困境

引用计数有个致命盲区：如果两个对象互相引用，它们的计数永远不为 0，谁也回收不了谁：

```python
class Node:
    def __init__(self):
        self.other = None

a = Node()
b = Node()
a.other = b   # a 引用 b
b.other = a   # b 引用 a
del a
del b         # 两个对象还互相引用，引用计数不为 0，内存泄漏了
```

这种"你指向我、我指向你"的环，引用计数自己解决不了。这正是 Python 还需要一套垃圾回收器（GC）的原因。

## 3. 分代垃圾回收

CPython 的 GC 专门处理循环引用。它只追踪**可能形成循环**的对象（容器类：列表、字典、类实例等），并把对象分成三代：

```txt
第 0 代（新生）：刚创建的对象，回收最频繁
第 1 代（中生）：熬过一次 0 代回收的存活对象
第 2 代（老生）：熬过多次回收的长寿对象
```

每一代有独立的触发阈值，默认是 `(700, 10, 10)`：

```python
import gc
print(gc.get_threshold())   # (700, 10, 10)
```

含义：第 0 代对象净增 700 个触发一次 0 代回收；每 10 次 0 代回收触发一次 1 代回收；每 10 次 1 代回收触发一次 2 代回收。越老的代回收越不频繁——因为长寿对象大概率会继续长寿，反复扫描它们是浪费。

回收的核心算法是**标记清除**：把每个容器对象的引用计数复制一份，从副本里减去容器内部的引用，副本归零的对象就是"只被循环引用撑着的垃圾"，可以安全回收。

```python
import gc

a = Node(); b = Node()
a.other = b; b.other = a
del a, b
print(gc.collect())   # 手动触发回收，返回回收掉的对象数（比如 2）
```

手动 `gc.collect()` 能立刻回收循环引用。`gc.disable()` 可以关闭自动回收，`gc.enable()` 重新打开。

## 4. 版本说明：GC 的实现有过变化

GC 的实现随版本演进，写代码或调参时要留意你用的是哪个版本：

- **Python 3.12 及更早、3.14.5 及以后**：分代回收（三代，阈值 `700/10/10`），即上文描述的行为。
- **Python 3.14.0 到 3.14.4**：曾短暂切换为增量回收（incremental GC），在 3.14.5 又回退到分代回收。
- **Python 3.13 及以后**：还引入了"永久代"（永久、静态对象从不回收）。

结论是：分代回收是长期稳定的默认行为，但不要假设某个小版本的具体实现，调优 GC 时先 `python3 -V` 确认版本。

## 5. 引用计数与 GIL 的关系

引用计数的增减必须**原子**：两个线程同时给一个对象 +1，如果各自读旧值再写回，计数就错了。CPython 用 GIL 保证"同一时刻只有一个线程在改引用计数"，从而省去了给每个引用计数操作加锁的开销。

这就是 GIL 存在的最根本原因——不是"防止程序员写多线程 bug"，而是**保护引用计数**。理解了这一层，就能明白为什么 free-threaded 模式（去掉 GIL）必须在引用计数上另想办法（见 [GIL 的内部实现](./chapter-04-gil-internals.md)）。

## 6. 动手实验

**实验 1：制造循环引用并回收**

```python
import gc
class Node:
    def __init__(self):
        self.other = None

a = Node(); b = Node()
a.other = b; b.other = a
del a, b
print(gc.collect())   # 返回 2 或更多，说明回收了循环引用
```

**实验 2：看阈值和调整**

```python
import gc
print(gc.get_threshold())     # (700, 10, 10)
gc.set_threshold(100, 5, 5)   # 更激进的回收
```

**实验 3：关闭自动 GC 观察对象数量**

```python
import gc

gc.disable()
a = []
for _ in range(10000):
    n = Node(); n.other = n; a.append(n)
before = len(gc.get_objects())
gc.collect()
gc.enable()
print('回收前对象数:', before)
```

## 7. 这一章要记住的结论

引用计数让内存**立即**回收，但解决不了循环引用；分代 GC（三代，阈值 700/10/10）专门回收循环引用，用标记清除算法；`gc.collect()` 手动回收、`gc.disable()` 关闭自动回收。引用计数需要原子性，这是 GIL 存在的根本原因。

接下来进入 [GIL 的内部实现](./chapter-04-gil-internals.md)，看这把锁到底怎么工作。
