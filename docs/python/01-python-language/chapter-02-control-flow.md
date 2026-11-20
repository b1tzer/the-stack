---
type: explanation
level: basic
---

# 条件与循环

本页面向刚学完基本类型的读者，回答两个问题：Python 怎么写出"如果……就……否则……"的分支，怎么重复执行一段代码。重点放在 Python 特有的部分：真值判断、链式比较、`for` 遍历可迭代对象和 `else` 子句。

布尔值与比较运算符的细节见[值、变量与类型](./chapter-01-values-and-variables.md)；列表、字典等可迭代对象见[容器与可变性](./chapter-03-collections.md)。

## 1. 真值判断与链式比较

### 1.1 任何对象都能用于条件

在 Python 里，`if` 后面不一定写比较表达式，任何对象都能放进条件位置，解释器按"真值"判断：`0`、`0.0`、空字符串 `''`、空容器（`[]`、`{}`、`set()`）和 `None` 视为"假"，其余视为"真"。

```python
if []:
    print('不会执行')     # 空列表为假，这行不执行
if [1]:
    print('非空列表为真')  # 非空列表为真，这行执行
```

判断容器是否为空，直接写 `if items:` 即可，不需要写 `if len(items) > 0`。这是 Python 社区的惯用写法。

### 1.2 链式比较

Python 允许把多个比较连写，含义是逐对做 `and`：

```python
1 < 2 < 3    # True，等价于 1 < 2 and 2 < 3
1 < 3 < 2    # False
```

`1 < 2 < 3` 读作"1 小于 2，且 2 小于 3"。链式比较中每个中间表达式只求值一次。

## 2. 分支

分支用 `if / elif / else`，靠缩进定界（没有花括号）：

```python
x = -3
if x > 0:
    print('positive')
elif x == 0:
    print('zero')
else:
    print('negative')
```

`elif` 是"否则如果"的意思，可以有多个；`else` 是"以上都不满足时"的分支，最多一个。注意每个分支后面的代码要**缩进**（通常 4 个空格），Python 靠缩进判断哪些代码属于哪个分支。

### 2.1 match 结构模式匹配

Python 3.10 起提供 `match`，用于按结构匹配值、序列、映射和类型：

```python
def describe(x):
    match x:
        case 0:
            return 'zero'
        case int() if x > 0:
            return 'positive int'
        case [a, b]:
            return f'pair {a},{b}'
        case {'name': n}:
            return f'named {n}'
        case _:
            return 'other'

describe(0)             # 'zero'
describe(5)             # 'positive int'
describe([1, 2])        # 'pair 1,2'
describe({'name': 'x'}) # 'named x'
```

`match` 从上到下逐条尝试 `case`，匹配成功执行对应分支；`_` 是通配符，匹配任何值。它匹配的是结构（列表长度、字典键、类型），不是简单的值相等，也不需要 `break`。简单值比较用 `if/elif` 即可，需要按结构解构时才用 `match`。

## 3. for 遍历可迭代对象

Python 的 `for` 用来遍历"可迭代对象"——列表、字符串、字典、`range` 等能逐个取出元素的东西：

```python
for s in ['a', 'b', 'c']:
    print(s)
# a
# b
# c
```

`for s in [...]` 的意思是：把列表里的元素依次取出来，每次赋值给变量 `s`，执行循环体。

需要同时拿到下标和值时用 `enumerate`；需要按区间循环时用 `range`。

### 3.1 range 是惰性序列

`range(n)` 生成从 `0` 到 `n-1` 的整数序列，`range(start, stop, step)` 支持起止和步长：

```python
list(range(5))         # [0, 1, 2, 3, 4]
list(range(1, 10, 2))  # [1, 3, 5, 7, 9]
```

`range` 不会一次性生成所有元素，而是用到时才逐个产出，遍历大区间也不会占用大量内存。区间左闭右开，与切片一致。

### 3.2 enumerate 与 zip

遍历需要同时取下标和值时用 `enumerate`；并行遍历多个序列用 `zip`：

```python
for i, s in enumerate(['a', 'b', 'c']):
    print(i, s)          # 0 a / 1 b / 2 c

for a, b in zip([1, 2], ['x', 'y']):
    print(a, b)          # 1 x / 2 y
```

## 4. while、break 与 continue

`while` 在条件为真时重复执行；`break` 提前退出整个循环，`continue` 跳过本轮、进入下一轮：

```python
n = 0
while n < 3:
    n += 1
    if n == 2:
        continue
    print(n)   # 1 3
```

上面循环里，`n` 从 0 递增到 3：`n == 2` 时执行 `continue`，跳过了 `print`，所以只打印了 `1` 和 `3`。

## 5. for 和 while 的 else 子句

Python 的循环可以带 `else` 子句。它**不是**"循环结束后总是执行"，而是"循环**没有**被 `break` 提前结束时才执行"：

```python
for i in range(5):
    if i == 3:
        print('found', i)
        break
else:
    print('not found')
```

上面的循环找到 `3` 后 `break`，所以 `else` 不执行，只输出 `found 3`。这个语法常用于"遍历查找，没找到就执行兜底逻辑"的场景，省去一个额外的标志变量。

## 6. 这一章要记住的结论

Python 的条件可以用任何对象，靠真值判断；`for` 遍历可迭代对象而非下标，`range` 是惰性序列；循环的 `else` 子句在未 `break` 时执行；`break` 退出循环、`continue` 跳过本轮。

接下来进入[容器与可变性](./chapter-03-collections.md)，把分支和循环作用到列表、字典、集合和元组上。
