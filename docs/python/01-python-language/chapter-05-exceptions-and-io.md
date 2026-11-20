---
type: explanation
level: intermediate
---

# 异常与资源管理

本页面向已经能写函数、开始处理文件和输入输出的读者，回答两个问题：Python 怎么捕获和处理错误，`with` 如何保证资源被正确释放。重点放在最容易写错的地方：`except` 按类型捕获、`else` 子句、`with` 管理资源，以及错误在运行时才暴露的后果。

自定义上下文管理器见[迭代协议与 Pythonic 写法](./chapter-08-pythonic.md)。

## 1. try / except / else / finally

程序运行时可能出错（用户输入了非数字、文件不存在、除零），错误在 Python 里表现为"抛出异常"。用 `try` 把可能出错的代码包起来，用 `except` 捕获并处理：

```python
try:
    n = int('abc')
except ValueError as e:
    print('不是数字:', e)
else:
    print('转换成功:', n)   # try 未抛异常时执行
finally:
    print('清理')           # 无论如何执行
```

- `except 异常类型` 只捕获指定类型及其子类，`as e` 把异常对象绑定到变量 `e`。
- `else` 在 `try` 未抛异常时执行，用于放置"只在成功时才做"的逻辑，避免把它放进 `try` 而误被捕获。
- `finally` 无论如何都执行，即使 `try` 里有 `return`。

捕获异常时应指明类型，不要裸写 `except:`（那样会捕获包括 `KeyboardInterrupt` 在内的所有异常，反而掩盖真正的错误）。

## 2. 异常层次与常见类型

异常是类，按继承组织。常用类型：

| 异常 | 触发场景 |
| :-- | :-- |
| `ValueError` | 类型正确但值不合法，如 `int('abc')` |
| `TypeError` | 类型不匹配，如 `1 + 'a'` |
| `KeyError` | 字典键不存在 |
| `IndexError` | 序列下标越界 |
| `ZeroDivisionError` | 除零 |
| `FileNotFoundError` | 文件不存在 |

所有异常继承自 `BaseException`，程序逻辑应捕获其子类 `Exception`，而不是 `BaseException`（后者还包括 `SystemExit`、`KeyboardInterrupt` 这类系统级异常，通常不应被捕获）。

## 3. raise 与自定义异常

`raise` 抛出异常，可以定义自己的异常类：

```python
class MyError(Exception):
    pass

raise MyError('boom')
```

自定义异常继承 `Exception`，按需添加属性。捕获时按类型匹配。由于 Python 没有编译期检查，异常的抛出点只能靠文档和测试保证，这进一步强化了测试的必要性。

## 4. with 管理资源

打开文件、获取锁、建立连接这类操作，用完必须释放，否则会造成资源泄漏。`with` 确保资源在退出代码块时释放，无论是否抛异常：

```python
with open('data.txt') as f:
    content = f.read()
# 离开 with 块时文件自动关闭
```

文件写入：

```python
with open('data.txt', 'w') as f:
    f.write('hello')
```

`with` 依赖对象的上下文管理器协议（`__enter__`/`__exit__`）。文件、锁、数据库连接都支持 `with`；自定义上下文管理器见[迭代协议与 Pythonic 写法](./chapter-08-pythonic.md)。

手动 `open` 而不 `close` 会导致资源泄漏，尤其在异常路径下更容易遗漏，因此文件操作应统一用 `with`。

### 4.1 pathlib 处理路径

字符串拼接路径容易出错，现代写法用 `pathlib.Path`：

```python
from pathlib import Path

p = Path('data') / 'out.txt'   # 用 / 拼接路径
p.parent        # data
p.name          # out.txt
p.read_text(encoding='utf-8')  # 读文本，比 open + read 简洁
p.write_text('hi', encoding='utf-8')
```

`Path` 封装了路径拼接、拆分、读写和遍历，跨平台处理分隔符。优先用 `Path` 而不是 `os.path` 和字符串拼接。

### 4.2 JSON 序列化

数据交换用 `json` 模块，`dump`/`load` 面向文件，`dumps`/`loads` 面向字符串：

```python
import json

json.dumps({'a': 1, 'b': [1, 2]})   # '{"a": 1, "b": [1, 2]}'
json.loads('{"a": 1}')               # {'a': 1}
```

`json` 与 Python 类型的对应：`dict` ↔ 对象，`list`/`tuple` ↔ 数组，`str` ↔ 字符串，`int`/`float` ↔ 数字，`None` ↔ null。自定义对象需要提供序列化函数或转成字典，不能直接 `json.dumps`。

## 5. 异常在运行时才暴露

Python 没有编译期类型检查，类型错误、键不存在、下标越界都要到运行时抛异常。这意味着：

- 开发时依赖测试覆盖异常路径，而不是依赖编译器。
- 写函数时应明确"什么输入会抛什么异常"，并在调用方按类型捕获。
- 面向不可信输入（用户输入、外部数据）时，把转换和边界检查放进 `try`，失败给可理解的提示，而不是让程序崩溃。

### 5.1 调试

异常运行时才暴露，因此定位问题靠调试工具。Python 提供三种常见手段：

- **`print`**：最直接的临时观察手段，在关键位置打印变量值。
- **`pdb`**：标准库调试器，在代码里插入 `breakpoint()` 进入交互式断点，用 `n`（下一行）、`s`（进入函数）、`p 变量`（打印）、`c`（继续）逐步排查。
- **IDE 断点**：PyCharm、VS Code 都支持断点、单步和变量观察。

排查流程：先读堆栈定位抛出点，再看异常类型和消息，最后回到调用链核对输入。Python 的异常信息直接给出完整堆栈和出错行，这是排查的起点。

## 6. 这一章要记住的结论

Python 用 `try / except / else / finally` 处理异常，`except` 按类型捕获，`else` 只在成功时执行；`with` 保证资源释放，文件操作应统一用它；异常只到运行时暴露，正确性靠测试兜底。

接下来进入[类、对象与特殊方法](./chapter-06-classes.md)，用类组织数据和行为。
