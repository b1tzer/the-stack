# Java 知识库

这套内容面向已经掌握 Java 基本语法、希望理解 Java 后端系统如何运行并能排查线上问题的开发者。页面以原理讲解为主，同时保留可执行的命令、配置和故障案例。

## 内容地图

- **Java 语言核心**：类型、对象语义、面向对象、泛型、注解、Lambda、异常、集合、Stream，以及 record、sealed 与模式匹配特性。
- **Compiler 与 Class File**：源码如何被编译成字节码，以及字节码如何描述程序。
- **ClassLoader 与 JVM Runtime**：类如何加载，运行时数据区、GC 和 JIT 如何协作。
- **并发与通信**：线程如何共享数据，Java 如何完成网络、RPC 和长连接通信。
- **数据访问与诊断**：JDBC、MyBatis、ORM、连接池以及生产问题排查。

## 按问题选择入口

| 你现在的问题 | 入口 |
| :-- | :-- |
| 想理解 Java 为什么这样设计、代码如何运行 | [从“为什么是 Java”开始](./01-java-language/chapter-01-why-java.md) |
| 想理解对象在 JVM 中如何分配和回收 | [从 JVM 运行时开始](./02-jvm-runtime/chapter-01-bytecode-classloading.md) |
| 想解决共享数据、线程池和异步调用问题 | [从 Java 并发开始](./03-java-concurrency/chapter-01-why-concurrency.md) |
| 想理解 HTTP、Socket、NIO、RPC 的完整链路 | [从网络通信基础开始](./04-java-network/chapter-01-network-basics.md) |
| 想理解 JDBC、MyBatis、ORM 和连接池 | [从持久化思想开始](./05-java-data-access/chapter-01-persistence-thought.md) |
| 正在排查 CPU、GC、死锁或网络故障 | [进入诊断总览](./06-diagnostics/index.md) |

## 推荐阅读路径

### 系统学习路径

1. 完成 Java 语言核心：类型、对象语义、面向对象、泛型、注解、Lambda、异常、集合、Stream/Optional 和现代语言特性。
2. 沿字节码、运行时数据区、对象布局、GC、堆外内存和 JIT 理解执行过程。
3. 学习 Java 内存模型、同步机制和并发工具。
4. 根据工作方向进入网络通信或数据访问。
5. 最后通过诊断方法与生产案例串联前面的机制。

### 问题排查路径

1. 先根据症状进入 [JVM 诊断](./06-diagnostics/01-jvm/chapter-01-jvm-diagnostics.md)、[并发诊断](./06-diagnostics/02-concurrency/chapter-01-concurrency-diagnostics.md) 或 [网络诊断](./06-diagnostics/03-network/chapter-01-network-diagnostics.md)。
2. 对照相似案例确定第一步采集什么数据。
3. 回到对应原理章节验证根因，而不是只复制修复参数。

## 内容边界

- Java 专题解释语言、JVM、并发、网络和数据访问的底层机制。
- JPMS 模块系统属于语言与部署边界，只在现代语言特性页说明定位，不扩展成独立主线章节。
- Spring 专题负责框架配置、API 和集成方式。
- 工程专题负责设计原则、架构和通用工程实践。
- MySQL、PostgreSQL 等专题负责数据库内核与 SQL 优化。

遇到跨专题问题时，各页面会给出下一跳链接，避免重复解释同一机制。
