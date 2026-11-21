# Python 知识库

这套内容面向**已经能写 Python、希望系统回顾语言机制、深入 CPython 运行时底层、构建完整知识体系，并成长为高级 Python 开发人员的开发者**。内容分两条主线：一条往下吃透语言与运行时，一条往前交付工程与后端，两条线最终在[生产诊断](./06-production/chapter-02-diagnostics.md)处汇合。

读完这套内容，你应能对 Python 的关键机制回答「是什么、为什么、何时失效」：理解对象模型、迭代协议、并发与 asyncio 的调度原理；用 FastAPI、SQLAlchemy 构建可维护后端并完成生产诊断；并能从 CPython 实现层面解释性能瓶颈与内存行为，具备高级开发人员所需的体系化判断力。

## 怎么读这套内容

按你的目标选一条主线，不必从头读到尾。

**主线一 · 把 Python 吃透（语言与运行时）**——适合想把语言机制彻底搞懂、能解释「为什么」的读者。从[语言核心](./01-python-language/chapter-00-getting-started.md)开始，语法部分（值、条件循环、容器、函数、异常、类）快速回顾即可，把重点放在引用与对象模型、迭代协议、并发与 asyncio 这些决定代码质量的机制上；再进入 [CPython 运行时](./07-cpython-runtime/chapter-01-execution-model.md)，从字节码、对象内存、引用计数与 GC、GIL 内部到性能优化，建立对「为什么慢、GIL 为什么存在、内存怎么管理」的底层解释。

**主线二 · 用 Python 交付（工程与后端）**——适合想把 Python 变成可上线、可排查的生产级服务的读者。从[工程化](./02-python-engineering/chapter-01-project-and-testing.md)开始，依次走完[网络编程](./03-python-network/chapter-01-http-client.md)、[FastAPI](./04-fastapi/chapter-01-fastapi-core.md)、[数据访问](./05-data-access/chapter-01-sqlalchemy.md)与[生产](./06-production/chapter-01-deployment.md)，掌握从项目组织、接口开发到部署诊断的完整闭环。

两条线在[生产诊断](./06-production/chapter-02-diagnostics.md)处汇合：主线一讲的 GIL、asyncio、内存机制，正是主线二排查线上问题（服务变慢、内存涨、请求卡住）的依据。吃透语言机制的读者，排查线上问题时有更可靠的根因判断。

## 内容地图

### 主线一 · 把 Python 吃透（语言与运行时）

- **[01 语言核心](./01-python-language/chapter-00-getting-started.md)**（12 章）：从环境准备起步（已装好可直接跳过），回顾值与类型、条件循环、容器、函数、异常、类与对象，再深入引用与对象模型、迭代协议与 Pythonic 写法、并发（线程 / 进程 / asyncio 与 GIL）和标准库。
- **[07 CPython 运行时](./07-cpython-runtime/chapter-01-execution-model.md)**（6 章）：源码如何变成字节码、对象的内存真相、引用计数与垃圾回收、GIL 内部、性能优化、内存分配器。

### 主线二 · 用 Python 交付（工程与后端）

- **[02 工程化](./02-python-engineering/chapter-01-project-and-testing.md)**：虚拟环境、依赖管理、pytest 测试，把代码组织成可复现、可测试的项目。
- **[03 网络编程](./03-python-network/chapter-01-http-client.md)**：用 requests / httpx 访问 HTTP 接口，处理超时与错误。
- **[04 Web 后端](./04-fastapi/chapter-01-fastapi-core.md)**：用 FastAPI 搭带校验和依赖注入的接口，以及认证与鉴权。
- **[05 数据访问](./05-data-access/chapter-01-sqlalchemy.md)**：用 SQLAlchemy / asyncpg 读写数据库、管理事务。
- **[06 生产](./06-production/chapter-01-deployment.md)**：部署到生产环境，以及性能、内存与异步排查。

## 按问题进入

已经能写 Python、遇到具体困惑时，按下面的表直接进入对应章节。

| 你现在的困惑 | 入口 |
| :-- | :-- |
| 环境没装好，或要管理多个 Python 版本 | [环境准备：安装与版本管理](./01-python-language/chapter-00-getting-started.md) |
| 值的类型、变量赋值语义、除法取模怎么算 | [值、变量与类型](./01-python-language/chapter-01-values-and-variables.md) |
| `for` 怎么遍历、循环 `else` 是什么 | [条件与循环](./01-python-language/chapter-02-control-flow.md) |
| 列表 / 字典被多处共享、浅拷贝和深拷贝 | [容器与可变性](./01-python-language/chapter-03-collections.md) |
| 为什么没有重载、默认参数怎么踩坑、作用域规则 | [函数、作用域与模块](./01-python-language/chapter-04-functions.md) |
| `with` 是什么、异常怎么按类型捕获 | [异常与资源管理](./01-python-language/chapter-05-exceptions-and-io.md) |
| 没有 private、`__eq__` / `__repr__` 怎么重写 | [类、对象与特殊方法](./01-python-language/chapter-06-classes.md) |
| `==` 和 `is` 到底比什么、赋值为什么改到别处 | [引用与对象模型](./01-python-language/chapter-07-references-and-objects.md) |
| 生成器、装饰器、自定义上下文管理器 | [迭代协议与 Pythonic 写法](./01-python-language/chapter-08-pythonic.md) |
| 多线程为什么没加速、CPU 密集该用进程还是协程 | [并发模型与 GIL](./01-python-language/chapter-09-concurrency.md) |
| 做某个任务该用哪个标准库模块 | [标准库速查](./01-python-language/chapter-10-standard-library.md) |
| 协程怎么调度、`create_task` 和 `gather` 如何并发 | [asyncio、协程与事件循环](./01-python-language/chapter-11-asyncio.md) |
| 怎么搭一个带 venv 和测试的项目 | [依赖管理与测试](./02-python-engineering/chapter-01-project-and-testing.md) |
| 发 HTTP 请求用什么、怎么处理超时和错误 | [HTTP 客户端与网络编程](./03-python-network/chapter-01-http-client.md) |
| 怎么用 FastAPI 搭一个带校验的接口 | [FastAPI 后端开发](./04-fastapi/chapter-01-fastapi-core.md) |
| 怎么给接口加登录和权限控制 | [认证与鉴权](./04-fastapi/chapter-02-auth.md) |
| 怎么连数据库、执行查询、管理事务 | [SQLAlchemy 与 asyncpg](./05-data-access/chapter-01-sqlalchemy.md) |
| 怎么把服务部署上线、用什么服务器 | [部署：从开发到生产](./06-production/chapter-01-deployment.md) |
| 服务变慢、内存涨、请求卡住怎么排查 | [生产诊断](./06-production/chapter-02-diagnostics.md) |
| Python 到底怎么执行代码、字节码是什么 | [执行模型](./07-cpython-runtime/chapter-01-execution-model.md) |
| 一个对象在内存里占多少、小整数为什么 `is` 成立 | [对象的内存真相](./07-cpython-runtime/chapter-02-object-layout.md) |
| 内存什么时候回收、循环引用怎么办 | [引用计数与垃圾回收](./07-cpython-runtime/chapter-03-reference-counting-gc.md) |
| GIL 到底怎么工作、free-threaded 是什么 | [GIL 的内部实现](./07-cpython-runtime/chapter-04-gil-internals.md) |
| Python 为什么慢、怎么加速 | [为什么 Python 慢](./07-cpython-runtime/chapter-05-performance.md) |
| 小块内存怎么分配 | [内存分配器 pymalloc](./07-cpython-runtime/chapter-06-pymalloc.md) |

## 内容边界

- 本专题讲 Python 语言机制、CPython 运行时和用 Python 做后端，目标是帮你从能写 Python 成长为具备体系化认知的高级开发人员。
- 用 Python 做 AI 应用，见 [AI 工程知识库](../ai/index.md)；那套内容假设你已具备本专题语言核心章节的基础。
- 消息队列、WebSocket、后台任务等主题不在本专题范围，需要时按对应组件专题展开。
- 工程化与网络模块目前各只有一章，覆盖依赖管理、测试与 HTTP 客户端；依赖锁、类型检查、CI、并发请求与流式等主题暂缺，留作后续扩展方向。
