---
type: explanation
level: advanced
---

# 为什么 Python 慢，如何变快

本页面向已经理解执行模型和 GIL 的读者，回答两个问题：Python 慢在哪里，有哪些加速手段、各适用什么场景。前置知识是本模块前几章的机制。

## 1. 慢在哪：两个根本原因

Python 慢，主要来自两个层层叠加的因素：

**动态类型**：变量没有固定类型，每次执行 `a + b`，解释器都要在运行时检查 `a` 和 `b` 是什么类型、`+` 对它们意味着什么。编译型语言在编译期就确定了类型，直接生成对应的机器指令；Python 每次运算都要走一遍"查类型 → 找方法 → 调用"。

**解释执行**：[执行模型](./chapter-01-execution-model.md)里讲过，每条字节码都要经过一次指令分派。同样一个循环体，编译执行是几条机器指令，Python 是几十上百条字节码逐条分发。

两个因素叠加，导致纯 Python 的计算密集代码通常比编译型语言慢一到两个数量级。

## 2. 先测量，再优化

优化之前先定位瓶颈，不要凭感觉。`timeit` 精确测一小段代码；`cProfile` 看整个程序的耗时分布：

```python
import timeit
print(timeit.timeit('sum(range(1000))', number=10000))
```

```python
import cProfile, pstats
cProfile.run('main()', 'prof.out')
p = pstats.Stats('prof.out')
p.sort_stats('cumulative').print_stats(10)
```

定位到热点函数后，再看它能不能用下面几种手段加速。

## 3. 最省事的加速：用对内置设施

很多时候慢不是因为 Python 本身，而是没用好现成的 C 实现。内置函数、标准库、推导式底层都是 C 写的，比纯 Python 循环快得多：

```python
# 慢：纯 Python 循环
def slow_sum(n):
    total = 0
    for i in range(n):
        total += i
    return total

# 快：内置 sum 是 C 实现
fast_sum = sum(range(n))

# 快：推导式比显式 append 循环快
squares = [i * i for i in range(n)]
```

规则：能用内置函数、标准库、推导式解决的，不要手写循环。

## 4. JIT：把解释执行变成编译执行

**JIT（即时编译）** 在运行时把热点代码编译成机器码，绕开"逐条分发"的开销。两条路：

- **CPython 的实验性 JIT**：Python 3.13 引入了实验性的 copy-and-patch JIT，到 3.14 仍是可选、默认关闭的。它目前收益有限，还在演进。
- **PyPy**：独立的 Python 实现，带成熟的 JIT。对纯 Python 的长运行程序（循环、数值计算）常有几倍提速，但对依赖 CPython C 扩展的生态（NumPy、pandas）兼容性差。

结论：JIT 是方向，但 CPython 的 JIT 还没到"开箱即用"的程度；PyPy 适合特定场景但不是万能替代。

## 5. 把热点下沉到编译型代码

对真正耗时的热点，最有效的是把它从 Python 挪到编译型代码里：

- **C 扩展**：用 C/C++ 写核心逻辑，通过 Python C API 暴露。性能最好，开发成本最高，适合库作者。
- **Cython**：写带类型注解的"类 Python"代码，编译成 C 扩展。性能和开发成本折中。
- **Numba**：给纯 Python 函数加 `@njit` 装饰器，即时编译成机器码。适合数值计算、NumPy 场景，不需要写 C。

```python
from numba import njit

@njit
def compute(n):
    total = 0
    for i in range(n):
        total += i * i
    return total
```

`@njit` 之后，这个纯 Python 循环会被编译成机器码，跑出接近 C 的速度。前提是代码里只用 Numba 支持的类型和操作。

选择建议：库/框架作者用 C 扩展或 Cython；数据科学、数值计算用 Numba；纯 Python 长运行服务可以先试 PyPy。

## 6. 动手实验

**实验 1：对比纯 Python 循环和内置函数**

```python
import timeit

def slow_sum(n):
    total = 0
    for i in range(n):
        total += i
    return total

n = 1000
print('手写循环:', timeit.timeit(lambda: slow_sum(n), number=1000))
print('内置 sum :', timeit.timeit(lambda: sum(range(n)), number=1000))
```

**实验 2：看一个循环的字节码开销**

```python
import dis

def loop(n):
    total = 0
    for i in range(n):
        total += i
    return total

dis.dis(loop)   # 循环体被编译成很多条字节码
```

## 7. 这一章要记住的结论

Python 慢在动态类型和解释执行两层叠加。优化顺序：先测量定位热点，再用内置设施替代手写循环，热点仍慢再考虑 Numba/Cython/C 扩展，纯 Python 长运行程序可试 PyPy。CPython 的 JIT 还在演进，不是当前默认选项。

接下来进入[内存分配器 pymalloc](./chapter-06-pymalloc.md)，看 Python 怎么高效分配小块内存。
