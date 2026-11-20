---
type: explanation
level: advanced
---

# 迭代协议与 Pythonic 写法

本页面向已经能写 Python 类、想写出地道代码的读者，回答三个问题：迭代协议和生成器怎么工作，装饰器是什么，如何自定义上下文管理器。这些机制是"把能跑的代码写成地道 Python"的分水岭，属于进阶内容，而不是入门语法。

特殊方法的基础见[类、对象与特殊方法](./chapter-06-classes.md)；`with` 的日常用法见[异常与资源管理](./chapter-05-exceptions-and-io.md)。

## 1. 迭代协议

`for` 能遍历任何实现迭代协议的对象。协议要求实现两个方法：`__iter__` 返回迭代器对象，`__next__` 返回下一个元素，元素耗尽时抛 `StopIteration`：

```python
class Count:
    def __init__(self, n):
        self.n = n

    def __iter__(self):
        self.i = 0
        return self

    def __next__(self):
        if self.i >= self.n:
            raise StopIteration
        self.i += 1
        return self.i

list(Count(3))   # [1, 2, 3]
```

理解协议后，自定义对象就能被 `for`、`list()`、`sum()`、解包等所有依赖迭代的操作使用，而不只是被 `for` 遍历。

## 2. 生成器

生成器是写迭代器的最简洁方式。含 `yield` 的函数是生成器函数，调用它返回生成器对象，每次 `yield` 暂停并保留状态：

```python
def squares(n):
    for i in range(n):
        yield i * i

list(squares(4))   # [0, 1, 4, 9]
```

生成器惰性产出，不会一次性生成全部元素，适合处理大序列或无限序列。它的状态由 `yield` 自动保存，比手写迭代器类简单得多。

生成器表达式是推导式的惰性版本，用圆括号表示：

```python
sum(x * x for x in range(1000))   # 惰性求和，不先构造列表
```

## 3. 装饰器

装饰器是接收函数、返回新函数的高阶函数。`@deco` 是语法糖，等价于 `fn = deco(fn)`：

```python
def deco(fn):
    def wrapper(*args, **kwargs):
        print('before')
        result = fn(*args, **kwargs)
        print('after')
        return result
    return wrapper

@deco
def hi():
    print('hi')

hi()
# before
# hi
# after
```

装饰器在运行时对函数做包装变换，用于日志、计时、权限校验、缓存等横切逻辑。注意它**直接替换函数**，是运行时行为，而不是给函数加元数据。

装饰器会改变被装饰函数的元信息（如 `__name__` 变成 `wrapper`），需要保留时用标准库的 `functools.wraps` 显式复制。

## 4. 自定义上下文管理器

`with` 依赖上下文管理器协议：`__enter__` 在进入时执行，`__exit__` 在退出时执行（含异常路径）。可以手写类实现，也可以用 `contextlib.contextmanager` 装饰一个生成器：

```python
from contextlib import contextmanager

@contextmanager
def managed():
    print('enter')
    try:
        yield
    finally:
        print('exit')

with managed():
    print('body')
# enter
# body
# exit
```

自定义上下文管理器用于封装成对出现的资源操作（加锁/解锁、连接/关闭、临时目录创建/删除）。

## 5. 惯用写法与 lambda 的边界

Pythonic 的常用写法包括：用 `enumerate` 替代下标循环、用 `in` 做成员判断、用推导式替代 `map`/`filter`、用真值判断替代 `len() > 0`。

`lambda` 用于需要一次性匿名函数的场景，如 `sorted(xs, key=lambda x: x[1])`。它只能是一个表达式，不能有语句；复杂的逻辑应写成命名函数。`map`、`filter` 与推导式功能重叠时，优先推导式——可读性更好，也是社区默认。

## 6. 这一章要记住的结论

迭代协议让对象被 `for` 和所有迭代操作使用，生成器是惰性迭代器的最简写法；装饰器是运行时函数变换；上下文管理器封装成对资源操作。这些机制共同构成"地道 Python"，而不是入门语法的堆叠。

掌握语言后，进入[依赖管理与测试](../02-python-engineering/chapter-01-project-and-testing.md)，把代码组织成可复现、可测试的项目。
