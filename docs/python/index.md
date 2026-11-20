# Python 知识库

这套内容面向**没写过代码、或只写过一点脚本、想成为 Python 后端工程师的人**。它从零开始，不假设你懂任何其他语言，带你走完「学会语言 → 组织项目 → 对外提供服务 → 上生产排查」这条后端工程师的必经之路。

读完这条主线，你应能独立交付一个 Python 后端服务：用 FastAPI 写出带校验、鉴权和数据库的接口，用 pytest 保证它正确，用虚拟环境和依赖文件让它可复现，并能定位慢在哪里、内存泄漏在哪。

## 内容地图

按后端工程师的成长路径组织，每个模块以前一个模块为前提。

- **[01 语言核心](./01-python-language/chapter-00-getting-started.md)**：从安装和第一个程序起步，学值与类型、条件循环、容器、函数、异常、类与对象、引用与对象模型、迭代与 Pythonic 写法、并发（线程 / 进程 / asyncio 与 GIL）和标准库，共 12 章。
- **[02 工程化](./02-python-engineering/chapter-01-project-and-testing.md)**：虚拟环境、依赖管理、pytest 测试，把代码组织成可复现、可测试的项目。
- **[03 网络编程](./03-python-network/chapter-01-http-client.md)**：用 requests / httpx 访问 HTTP 接口，处理超时与错误。
- **[04 Web 后端](./04-fastapi/chapter-01-fastapi-core.md)**：用 FastAPI 搭带校验和依赖注入的接口，以及认证与鉴权。
- **[05 数据访问](./05-data-access/chapter-01-sqlalchemy.md)**：用 SQLAlchemy / asyncpg 读写数据库、管理事务。
- **[06 生产](./06-production/chapter-01-deployment.md)**：部署到生产环境，以及性能、内存与异步排查。
- **[07 CPython 运行时](./07-cpython-runtime/chapter-01-execution-model.md)**（进阶）：源码如何变成字节码、对象的内存真相、引用计数与垃圾回收、GIL 内部、性能优化、内存分配器，共 6 章。

## 学习路径

1. 装好 Python 3.13 及以上版本并能在命令行运行解释器，然后从[语言核心起步章](./01-python-language/chapter-00-getting-started.md)开始按顺序学完语言核心；每章先跑通例子再继续。
2. 学完语言后，用[依赖管理与测试](./02-python-engineering/chapter-01-project-and-testing.md)把项目组织起来，这一步是后面写 Web 服务的前提。
3. 进入[网络编程](./03-python-network/chapter-01-http-client.md)和 [Web 后端](./04-fastapi/chapter-01-fastapi-core.md)，学会用 FastAPI 对外提供服务。
4. 接上[数据访问](./05-data-access/chapter-01-sqlalchemy.md)让服务读写数据库；上线前看[生产](./06-production/chapter-01-deployment.md)章节完成部署和排查准备。
5. 想深挖底层原理的，进入 [CPython 运行时](./07-cpython-runtime/chapter-01-execution-model.md)，理解"为什么慢、GIL 为什么存在、内存怎么管理"。

## 按问题进入

已经能写一点 Python、遇到具体困惑时，按下面的表直接进入对应章节。

| 你现在的困惑 | 入口 |
| :-- | :-- |
| 从没写过 Python，第一步该装什么 | [起步：安装与第一个程序](./01-python-language/chapter-00-getting-started.md) |
| 值有哪些类型、变量到底是什么、除法取模怎么算 | [值、变量与类型](./01-python-language/chapter-01-values-and-variables.md) |
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

- 本专题讲 Python 语言和用 Python 做后端，目标是让你能独立交付一个后端服务。
- 用 Python 做 AI 应用，见 [AI 工程知识库](../ai/index.md)；那套内容假设你已具备本专题语言核心章节的基础。
- 消息队列、WebSocket、后台任务等进阶主题不在本专题范围，需要时按对应组件专题展开。
