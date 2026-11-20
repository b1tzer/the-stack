---
type: explanation
level: intermediate
---

# 类、对象与特殊方法

本页面向已经能写函数、开始用类组织数据的读者，回答三个问题：Python 的类怎么定义和使用，特殊方法（dunder）是什么，继承与鸭子类型如何取舍。重点放在需要建立新认知的地方：没有真正的访问控制、`__init__` 不是构造器、特殊方法让对象参与内建行为。

函数与作用域见[函数、作用域与模块](./chapter-04-functions.md)；迭代协议与生成器见[迭代协议与 Pythonic 写法](./chapter-08-pythonic.md)。

## 1. 类与实例

类用 `class` 定义，实例方法第一个参数显式写 `self`，表示实例本身：

```python
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def distance(self, other):
        return ((self.x - other.x) ** 2 + (self.y - other.y) ** 2) ** 0.5
```

`__init__` 是初始化方法，在实例创建后设置属性，不是真正的构造器（真正的构造是 `__new__`，日常无需重写）。`self` 指向当前实例，调用时由 Python 自动传入，定义方法时必须显式写在第一个参数位置。

### 1.1 dataclass：数据类

手写 `__init__`、`__repr__`、`__eq__` 是重复劳动。`dataclasses.dataclass` 装饰器为字段声明式的类自动生成这些方法：

```python
from dataclasses import dataclass

@dataclass
class Point:
    x: int
    y: int

p = Point(1, 2)
print(p)           # Point(x=1, y=2)  __repr__ 自动生成
p == Point(1, 2)   # True             __eq__ 自动生成
```

定义纯数据类（DTO、配置、返回值）时优先用 `dataclass`，而不是手写样板方法。字段类型注解会被 `dataclass` 读取，但运行时不做类型检查（见[函数、作用域与模块](./chapter-04-functions.md)第 5 节）。

## 2. 没有真正的访问控制

很多语言用 `private`、`protected`、`public` 控制访问权限。Python 没有这层强制机制，只有约定：

- 单下划线 `_x`：约定为"内部属性"，外部不应访问，但解释器不阻止。
- 双下划线 `__y`：触发名字改写，`self.__y` 在类外变成 `_类名__y`，用于避免子类命名冲突，**不是**真正的私有。

```python
a._x      # 可以访问
a._A__y   # 双下划线改写后仍可访问
```

Python 社区默认"大家都是成年人"，靠约定和文档约束，不靠强制。不要把封装习惯机械翻译成 `__` 前缀；大多数场景用单下划线加文档说明即可。

## 3. 特殊方法

特殊方法（dunder，double underscore，双下划线）让自定义对象参与语言内建行为——比如让 `print` 能打印出有意义的内容、让 `==` 能比较两个实例：

```python
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __repr__(self):
        return f'Point({self.x}, {self.y})'   # 面向开发者，repr(p)

    def __eq__(self, other):
        return (self.x, self.y) == (other.x, other.y)   # == 比较

p1 = Point(1, 2)
p2 = Point(1, 2)
print(p1)        # Point(1, 2)
p1 == p2         # True，由 __eq__ 决定
```

常用特殊方法：

| 特殊方法 | 触发 |
| :-- | :-- |
| `__init__` | 实例初始化 |
| `__repr__` | `repr()`、交互式显示 |
| `__str__` | `str()`、`print` |
| `__eq__` | `==` |
| `__hash__` | `hash()`、作为字典键 |
| `__len__` | `len()` |
| `__getitem__` | `obj[i]` |

重写 `__eq__` 而不重写 `__hash__` 时，对象会变成不可哈希，不能再作为字典键或集合元素。这条约束和 `__eq__` 是配套的。

## 4. 属性与 @property

一种常见习惯是用 getter/setter 方法暴露字段。Python 可以直接访问属性，需要控制读写时用 `@property` 把方法伪装成属性：

```python
class Circle:
    def __init__(self, r):
        self._r = r

    @property
    def area(self):
        return 3.14159 * self._r ** 2

Circle(2).area   # 12.56636  像属性一样读取，实际调用方法
```

`@property` 让调用方不必先写 `getArea()`，后续需要校验时再补 `@x.setter`，不影响既有调用代码。这是 Python 的"先简单、按需收紧"思路。

### 4.1 类变量、实例变量与静态方法

Python 里需要分清三个概念：

```python
class Counter:
    total = 0            # 类变量：所有实例共享

    def __init__(self):
        self.value = 0    # 实例变量：每个实例独立

    @classmethod
    def create(cls):      # 类方法：第一个参数是类本身
        return cls()

    @staticmethod
    def helper(x):        # 静态方法：不依赖实例或类
        return x * 2
```

- **类变量**定义在类体，通过类或实例访问时指向同一个值。但通过实例给类变量赋值会创建同名实例属性，遮蔽类变量，这是常见的隐蔽 bug——修改类变量应用 `Counter.total = ...`，而不是 `instance.total = ...`。
- **`@classmethod`** 第一个参数是 `cls`（类本身），常用于工厂方法。
- **`@staticmethod`** 不依赖实例或类，只是把函数放进类的命名空间。

## 5. 继承与组合

Python 支持单继承和多继承。单继承用 `super()` 调用父类方法：

```python
class Dog(Animal):
    def __init__(self, name):
        super().__init__(name)
```

组合通常优先于继承：继承表达"是一个"，组合表达"有一个"。Python 支持多继承，但菱形继承的方法解析顺序（MRO）复杂，能用组合或单继承解决时不要用多继承。

需要约束子类必须实现某些方法时，用抽象基类 `abc.ABC` 配合 `@abstractmethod`：

```python
from abc import ABC, abstractmethod

class Shape(ABC):
    @abstractmethod
    def area(self):
        ...

class Circle(Shape):
    def area(self):
        return 3.14159
```

没有实现 `area` 的子类无法实例化，抽象方法到实例化时才报错。多数场景鸭子类型已经够用，抽象基类只在需要显式约束接口时引入。

## 6. 鸭子类型

很多语言靠接口约束"能做什么"。Python 靠鸭子类型：不检查对象的类型，只检查它有没有需要的方法。

```python
def make_sound(obj):
    return obj.speak()   # 只要对象有 speak() 就行，不管它是什么类
```

这取代了"定义接口 + 实现接口 + 声明参数类型"的流程。代价是错误延迟到运行时（调用不存在的方法抛 `AttributeError`），类型注解（[函数、作用域与模块](./chapter-04-functions.md)第 5 节）和测试用来补偿这层缺失的静态保证。

## 7. 这一章要记住的结论

Python 没有真正的访问控制，靠约定；`__init__` 是初始化不是构造器；特殊方法让对象参与内建行为，重写 `__eq__` 要同步 `__hash__`；`@property` 按需替代 getter/setter；组合优先于继承，多继承谨慎使用；鸭子类型用运行时方法检查替代接口约束。

接下来进入[引用与对象模型](./chapter-07-references-and-objects.md)，把对象、引用和身份这些分散的概念串起来。
