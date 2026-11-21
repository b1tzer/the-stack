---
type: explanation
level: intermediate
---

# 函数、作用域与模块

本页面向已经能写函数、但想系统弄清参数形态和作用域规则的读者，回答三个问题：函数怎么定义和调用，参数有哪几种形态，作用域如何解析名字。重点放在最容易踩坑的地方：无重载、传参语义、可变默认参数和 LEGB 作用域。

容器与可变性见[容器与可变性](./chapter-03-collections.md)；类与特殊方法见[类、对象与特殊方法](./chapter-06-classes.md)。

## 1. 定义与调用

函数用 `def` 定义，参数和返回值都没有类型声明（类型注解见第 5 节）：

```python
def add(a, b):
    return a + b

add(1, 2)   # 3
```

Python 没有函数重载：同一个函数名只能有一个定义，后定义覆盖前定义。需要"多种参数形态"时，用默认参数、`*args`、`**kwargs` 来表达，而不是写多个同名函数。

## 2. 参数机制

### 2.1 位置参数、默认参数与关键字参数

```python
def greet(name, greeting='hi'):
    return f'{greeting}, {name}'

greet('a')               # 'hi, a'
greet('b', 'hello')      # 'hello, b'
greet(greeting='hey', name='c')   # 'hey, c'  关键字参数可换序
```

默认参数在函数定义时求值一次，之后复用同一个对象。这引出下面 2.3 的可变默认参数坑。

### 2.2 *args 与 **kwargs

`*args` 收集多余的位置参数为元组，`**kwargs` 收集多余的关键字参数为字典：

```python
def f(a, b=10, *args, **kwargs):
    return a, b, args, kwargs

f(1, 2, 3, 4, x=5, y=6)
# (1, 2, (3, 4), {'x': 5, 'y': 6})
```

### 2.3 可变默认参数

默认参数若指向可变对象（列表、字典），会被所有调用共享，造成状态累积：

```python
def bad(a, lst=[]):
    lst.append(a)
    return lst

bad(1)   # [1]
bad(2)   # [1, 2]  第二次调用拿到的是同一个列表
```

正确写法是把默认值设为 `None`，在函数体内创建新对象：

```python
def good(a, lst=None):
    if lst is None:
        lst = []
    lst.append(a)
    return lst
```

### 2.4 传参语义

Python 传参是"传对象引用"：函数收到的是对象的引用，可以修改可变对象的内容，但不能让调用方的名字重新绑定到别的对象。

```python
def append_item(lst):
    lst.append(1)       # 修改了调用方传入的列表

def reassign(lst):
    lst = [9]           # 只是让函数内的 lst 指向新列表，不影响调用方

a = []
append_item(a)   # a 变成 [1]
reassign(a)      # a 仍是 [1]，不受影响
```

理解这个差异的关键是[引用与对象模型](./chapter-07-references-and-objects.md)里的结论：赋值只是重新绑定名字，不修改对象。

### 2.5 多返回值

`return a, b` 实际返回一个元组，调用方可解包接收：

```python
def swap(a, b):
    return b, a

x, y = swap(1, 2)   # x=2, y=1
```

## 3. 作用域

Python 用 LEGB 顺序解析名字：局部（Local）→ 闭包外层（Enclosing）→ 全局（Global）→ 内置（Built-in）。

关键规则：函数内对变量赋值，默认创建局部变量，不会修改同名的全局变量。

```python
x = 1

def f():
    x = 2   # 创建局部变量，不影响全局 x

f()
print(x)   # 1
```

需要修改外层变量时，显式声明 `global`（模块级）或 `nonlocal`（闭包外层）：

```python
def outer():
    y = 10
    def inner():
        nonlocal y
        y += 1
        return y
    return inner()

outer()   # 11
```

`global` 和 `nonlocal` 应谨慎使用：函数通过参数接收输入、通过返回值输出，比修改外部状态更易理解和测试。

## 4. 模块与导入

一个 `.py` 文件就是一个模块。`import` 导入模块，`from ... import ...` 导入模块内的名字：

```python
import math
math.sqrt(2)          # 1.4142135623730951

from datetime import datetime
datetime.now()
```

模块首次导入时执行一次并缓存，之后再次导入不会重新执行。

### 4.1 模块入口：`__name__ == '__main__'`

一个文件既能作为脚本运行，也能作为模块被导入。用 `if __name__ == '__main__':` 区分两种场景：

```python
def main():
    print('run as script')

if __name__ == '__main__':
    main()
```

直接运行该文件时 `__name__` 是 `'__main__'`，条件成立；被其他模块 `import` 时 `__name__` 是模块名，条件不成立。脚本的入口逻辑放在这个守卫里，导入时只加载函数定义而不执行入口逻辑。

### 4.2 包与相对导入

包是包含 `__init__.py` 的目录（Python 3.3 起也支持无 `__init__.py` 的命名空间包）。包内的模块用相对导入互相引用：

```txt
mypkg/
├── __init__.py
├── core.py
└── utils.py
```

```python
# core.py 内引用同包的 utils
from . import utils        # 相对导入，点表示当前包
from .utils import helper
```

相对导入只适用于包内模块，脚本直接运行的文件不能使用相对导入。跨包引用用绝对导入（`from mypkg.utils import helper`）。

## 5. 类型注解

Python 3.5 起支持类型注解，但注解只是元数据，运行时**不做**类型检查：

```python
def add(a: int, b: int) -> int:
    return a + b
```

注解本身不阻止传入错误类型，需要静态检查时配合 `mypy` 或 `pyright` 使用。

### 5.1 类型工具

Python 的类型保证靠工具补回，而不是语言本身提供：

- **`typing` 模块**提供泛型与组合类型：`list[int]`、`dict[str, int]`、`int | None`、`Callable` 等。
- **`Protocol`**（结构性子类型）声明"需要哪些方法"，不要求继承关系，与鸭子类型兼容。
- **`dataclass`** 用类型注解声明字段，见[类、对象与特殊方法](./chapter-06-classes.md)第 1.1 节。
- **静态检查工具** `mypy` 或 `pyright` 在 CI 或编辑器中检查类型。

类型注解是可选的、渐进式的：可以只给公共接口加注解，内部代码保持动态。这是 Python 在灵活性和安全性之间的折中。

### 5.2 数据校验：pydantic

类型注解只描述类型，不做运行时校验。需要校验输入数据（用户提交、外部接口）时用 `pydantic`，它把类型注解变成运行时约束：

```python
from pydantic import BaseModel, Field, ValidationError

class User(BaseModel):
    name: str
    age: int = Field(ge=0, le=150)

User(name='Tom', age=30)       # 正常
User(name='Tom', age='30')     # 自动把 '30' 转成 int
try:
    User(name='Tom', age=-1)   # 抛 ValidationError：age 不满足 ge=0
except ValidationError as e:
    print(e.error_count())     # 1
```

`pydantic` 在实例化时做类型转换和约束校验，失败抛 `ValidationError`，成功则得到类型正确的对象。它广泛用于配置加载、接口入参校验和序列化，FastAPI 就是基于它做请求体校验的（见 [FastAPI](../04-fastapi/chapter-01-fastapi-core.md)）。

## 6. 这一章要记住的结论

Python 函数无重载，靠默认参数和 `*args`/`**kwargs` 表达参数形态；默认参数在定义时求值，可变默认值要写成 `None` 兜底；传参是传对象引用；赋值默认创建局部变量，改外层要显式 `global`/`nonlocal`。

接下来进入[异常与资源管理](./chapter-05-exceptions-and-io.md)，处理运行时的错误和文件、资源释放。
