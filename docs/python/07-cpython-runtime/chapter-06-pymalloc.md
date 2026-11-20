---
type: explanation
level: advanced
---

# 内存分配器 pymalloc

本页面向已经理解对象内存布局的读者，回答一个问题：Python 怎么高效地分配小块内存。前置知识是[对象的内存真相](./chapter-02-object-layout.md)。

## 1. 为什么需要专门的内存分配器

Python 程序里充满了小对象——整数、字符串、列表元素、字典节点。如果每个小对象都直接向操作系统 `malloc`，系统调用会很频繁，而且小对象的分配/释放会造成内存碎片。

CPython 因此内置了一个专门的内存分配器 **pymalloc**，它向操作系统一次性申请大块内存，再自己切成小块分发给小对象。这避免了频繁的系统调用，也提高了小块内存的复用效率。

## 2. 三层结构：Arena → Pool → Block

pymalloc 的内存分三层管理：

```txt
Arena（256 KB）
├── Pool（4 KB）
│   ├── Block（8~512 B，同一 Pool 内所有 Block 大小相同）
│   ├── Block
│   └── ...
├── Pool
└── ...
```

- **Arena**：向操作系统申请的最大单元，固定 256 KB。
- **Pool**：一个 Arena 切成的 4 KB 小块，一个 Arena 有 64 个 Pool。
- **Block**：真正分给对象的最小单元，大小按"size class"分级：8、16、24、…… 直到 512 字节。

同一个 Pool 里所有 Block 大小相同。要分配一个 24 字节的对象，就从"24 字节 size class"对应的 Pool 里取一个空闲 Block。

## 3. size class 与对齐

Block 大小是 8 字节对齐、8 到 512 字节之间的离散档位。分配时向上取整到最近的档位：

```python
import sys
for size in [1, 8, 9, 100, 512, 513]:
    b = bytes(size)
    print(size, sys.getsizeof(b))
```

注意 `bytes` 对象有头部开销，`getsizeof` 反映的是对象总大小，不是纯数据大小。关键结论是：**≤512 字节的对象走 pymalloc 的 block，>512 字节的对象直接走系统 malloc**，跳过 pymalloc。

## 4. 为什么这样设计

- **按 size class 分档**：避免每个对象都精确分配，减少碎片。一个 8 字节档位的 Pool 释放后，能复用于任何 ≤8 字节的对象。
- **同一 Pool 内 block 等大**：释放和复用都很简单，不需要复杂的分割合并。
- **大对象走 malloc**：大对象数量少、寿命差异大，直接交给系统更省事。

这一层对写 Python 代码几乎透明——你不需要直接操作 pymalloc，但理解它能解释一些现象：大量小对象的内存增长是"阶梯式"的（Arena 一块一块申请），而 `getsizeof` 看到的字节数是 size class 向上取整后的结果。

## 5. 动手实验

**实验 1：观察小对象的对齐与占用**

```python
import sys
for n in [0, 1, 2, 4, 8, 16, 32, 64]:
    print(n, sys.getsizeof(bytes(n)))
```

观察 `bytes(n)` 的对象大小随 n 的变化，注意头部开销和 8 字节对齐。

**实验 2：用 tracemalloc 看分配来源**

```python
import tracemalloc
tracemalloc.start()
a = [bytes(i) for i in range(1000)]
snapshot = tracemalloc.take_snapshot()
for stat in snapshot.statistics('lineno')[:5]:
    print(stat)
```

## 6. 这一章要记住的结论

pymalloc 用 Arena（256KB）→ Pool（4KB）→ Block 三层结构管理小块内存，Block 按 8 字节对齐的 size class 分档（8~512 字节），≤512 字节走 pymalloc、>512 字节走系统 malloc。这一层对代码透明，但解释了小对象内存的阶梯式增长和 `getsizeof` 的取整现象。
