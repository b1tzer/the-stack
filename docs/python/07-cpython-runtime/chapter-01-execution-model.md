---
type: explanation
level: advanced
---

# 执行模型：从源码到字节码

本页面向已经能写 Python、想理解"代码到底怎么被运行"的读者，回答一个问题：从你敲下的 `.py` 源码到屏幕上出现结果，中间发生了什么。前置知识是语言核心[值、变量与类型](../01-python-language/chapter-01-values-and-variables.md)里"程序如何执行"那一节。

示例基于 Python 3.13+，实验可在任意 3.x 版本复现。

## 1. 三步：源码 → 字节码 → 执行

Python 执行一段代码，中间有三次转换：

```txt
源码（.py 文本）
  → 词法分析 + 语法分析 → AST（抽象语法树）
  → 编译 → 字节码（bytecode）
  → 解释器逐条执行
```

第一步把文本解析成结构化的语法树，检查语法错误；第二步把语法树编译成字节码——一种只有 CPython 解释器认识的中间指令；第三步由解释器逐条执行字节码。

## 2. 用 ast 看第一步：语法树

`ast` 模块能直接看到源码解析后的结构：

```python
import ast

tree = ast.parse('x = 1 + 2')
print(ast.dump(tree, indent=2))
```

输出是一棵树，`x = 1 + 2` 被拆成一个 `Assign`（赋值）节点，右边是一个 `BinOp`（二元运算）节点，加号左右分别是常量 `1` 和 `2`。这一步做的是**结构化**：确认代码语法合法，并把它组织成树，方便下一步编译。

## 3. 用 dis 看第二步：字节码

`dis` 模块反汇编字节码，把中间指令变成可读文本：

```python
import dis

def add(a, b):
    return a + b

dis.dis(add)
```

输出类似：

```txt
  2           0 LOAD_FAST                0 (a)
              2 LOAD_FAST                1 (b)
              4 BINARY_ADD
              6 RETURN_VALUE
```

每一行是一条字节码指令：`LOAD_FAST` 把局部变量压入栈，`BINARY_ADD` 把栈顶两个值弹出、相加、再压回，`RETURN_VALUE` 返回栈顶值。第一列 `2` 是源码行号，`0 2 4 6` 是字节偏移，`(a)` `(b)` 是操作数。

字节码是**栈式虚拟机**的指令集：操作数放在一个栈上，指令从栈上取数、运算、把结果压回。理解"栈式"这个模型，就能看懂任何一条 `dis` 输出。

## 4. 第三步：解释器循环

字节码编译好之后，解释器进入一个循环：取一条指令、执行它、取下一条，直到遇到 `RETURN_VALUE` 或抛出异常。

```txt
loop:
    opcode = 下一条指令
    按 opcode 分派到对应的 C 实现
        比如 BINARY_ADD：弹出两个值，相加，压回
```

每一步都要经过一次指令分派，这就是"解释执行"和"编译执行"的本质区别：编译执行把源码直接变成机器码一次跑完，解释执行是在运行时逐条翻译。这个逐条分派的开销，是 Python 慢的重要原因之一，[为什么 Python 慢](./chapter-05-performance.md)会展开。

## 5. 动手实验

**实验 1：看一个完整函数的字节码**

```python
import dis

def f(x):
    if x > 0:
        return x * 2
    return -x

dis.dis(f)
```

找出 `LOAD_FAST`、`POP_JUMP_IF_FALSE`（条件为假时跳转）、`BINARY_OP` 这些指令，对照源码理解每条指令在做什么。

**实验 2：直接编译一段源码**

```python
code = compile('x = 1 + 2', '<string>', 'exec')
print(code.co_code)          # 字节码的原始字节
dis.dis(code)
```

`compile` 跳过执行，只做"源码 → 字节码"这一步。`code.co_code` 是字节码的原始形式。

**实验 3：看语法错误发生在哪一步**

```python
try:
    compile('x = ', '<string>', 'exec')
except SyntaxError as e:
    print(e)   # 在编译这一步就报错，还没进入执行
```

语法错误在"源码 → 字节码"的编译阶段就暴露，根本不进入执行循环。这解释了为什么语法错误能立刻被抓住，而类型错误要等运行到那一行才暴露。

## 6. 这一章要记住的结论

Python 执行分三步：源码解析成 AST，再编译成字节码，最后由解释器逐条执行。字节码是栈式虚拟机的指令集，用 `dis` 查看；`ast` 看语法树，`compile` 单独做编译。语法错误在编译期暴露，类型错误在执行期暴露。

接下来进入[对象的内存真相](./chapter-02-object-layout.md)，看这些字节码操作的对象在内存里长什么样。
