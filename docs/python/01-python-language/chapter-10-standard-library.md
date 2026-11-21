---
type: reference
level: intermediate
---

# 标准库速查

本页按任务列出常用标准库模块，供写代码时快速定位"这个任务该用哪个模块"。以 Python 3.13+ 为标准。每个模块只给定位和一句话用途，详细用法以官方文档为准。

模块对应的基础概念（导入、`with`、类型）见[函数、作用域与模块](./chapter-04-functions.md)、[异常与资源管理](./chapter-05-exceptions-and-io.md)。

## 文件与路径

| 模块 | 用途 |
| :-- | :-- |
| `pathlib` | 面向对象的路径处理，`Path('a') / 'b'`、读写文本 |
| `os` | 操作系统接口：环境变量、进程信息、`os.path` 底层路径函数 |
| `shutil` | 高层文件操作：复制、移动、删除目录树 |
| `tempfile` | 创建临时文件和目录 |

## 数据序列化

| 模块 | 用途 |
| :-- | :-- |
| `json` | JSON 读写，`dump`/`load`（文件）、`dumps`/`loads`（字符串） |
| `csv` | CSV 表格读写 |
| `pickle` | Python 对象的二进制序列化，仅限可信数据 |

## 文本与正则

| 模块 | 用途 |
| :-- | :-- |
| `re` | 正则表达式，`search`/`match`/`findall`/`sub` |
| `string` | 常用字符常量和格式化辅助 |
| `difflib` | 文本差异比较 |

## 容器与迭代工具

| 模块 | 用途 |
| :-- | :-- |
| `collections` | 增强容器：`Counter`（计数）、`defaultdict`（带默认值）、`deque`（双端队列）、`namedtuple` |
| `itertools` | 迭代器组合：`chain`、`islice`、`product`、`groupby` |
| `heapq` | 堆队列 |
| `bisect` | 有序列表的二分查找 |

## 函数工具

| 模块 | 用途 |
| :-- | :-- |
| `functools` | 高阶函数：`lru_cache`（缓存）、`partial`（固定参数）、`wraps` |
| `operator` | 运算符的函数形式：`itemgetter`、`attrgetter` |

## 时间与日期

| 模块 | 用途 |
| :-- | :-- |
| `datetime` | 日期时间：`date`、`time`、`datetime`、`timedelta` |
| `time` | 时间戳、休眠、计时 |

## 系统与进程

| 模块 | 用途 |
| :-- | :-- |
| `sys` | 解释器参数、标准流、退出码、模块搜索路径 |
| `subprocess` | 运行外部命令、捕获输出 |
| `argparse` | 命令行参数解析 |

## 数学、随机与统计

| 模块 | 用途 |
| :-- | :-- |
| `math` | 数学函数和常量 |
| `random` | 伪随机数生成 |
| `statistics` | 均值、中位数、方差等统计量 |
| `decimal` | 十进制精确浮点运算 |

## 日志

| 模块 | 用途 |
| :-- | :-- |
| `logging` | 标准日志：级别、格式化、handler |

## 类型与抽象

| 模块 | 用途 |
| :-- | :-- |
| `typing` | 类型提示：`Optional`、`Protocol`、泛型 |
| `dataclasses` | 数据类装饰器 `@dataclass` |
| `abc` | 抽象基类 `ABC`、`@abstractmethod` |
| `enum` | 枚举 |

## 使用原则

标准库是 Python 的一部分，优先用它解决常见任务，再考虑第三方依赖。标准库能覆盖就不用第三方；引入第三方库时按[依赖管理与测试](../02-python-engineering/chapter-01-project-and-testing.md)声明依赖。
