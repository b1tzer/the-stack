# Java 知识库

这套内容面向已经掌握 Java 基本语法、希望理解 Java 后端系统如何运行并能排查线上问题的开发者。页面以原理讲解为主，同时保留可执行的命令、配置和故障案例。

## 内容地图

- **01 Java 语言核心**：类型、对象语义、面向对象、泛型、注解、Lambda、异常、集合、Stream，以及 record、sealed 与模式匹配特性。
- **02 JVM 运行时**：字节码、类加载、运行时数据区、对象布局、GC、JIT 与堆外内存。
- **03 Java 并发**：内存模型、同步原语、并发工具、线程池、异步模型与虚拟线程。
- **04 Java 网络**：网络基础、Socket/NIO、Netty、HTTP、Servlet/Tomcat、RPC 与长连接协议。
- **05 Java 数据访问**：持久化思想、JDBC、连接池、MyBatis、ORM 与性能优化。
- **06 诊断**：按故障域组织 JVM、并发、网络与数据访问的排查流程与生产案例。

下面的三条入口索引同一批内容，但面向不同的阅读目标。

## 入口 A：按知识体系学习

适合系统学习，从语言机制逐步深入到运行与排障。

1. 完成 Java 语言核心：类型、对象语义、面向对象、泛型、注解、Lambda、异常、集合、Stream/Optional 和现代语言特性。
2. 沿字节码、运行时数据区、对象布局、GC、JIT 和堆外内存理解执行过程。
3. 学习 Java 内存模型、同步机制和并发工具。
4. 根据工作方向进入网络通信或数据访问。
5. 最后通过诊断方法与生产案例串联前面的机制。

想从某模块开头进入，按内容地图的链接即可。

## 入口 B：按故障现象排查

适合线上问题，从症状出发，而不是直接判断根因属于哪个技术域。

| 你看到的现象 | 先去的入口 |
| :-- | :-- |
| CPU 利用率高、计算繁忙 | [JVM 诊断](./06-diagnostics/01-jvm/chapter-01-jvm-diagnostics.md) 与 [并发诊断](./06-diagnostics/02-concurrency/chapter-01-concurrency-diagnostics.md) |
| 堆内存持续增长、OOM、Metaspace 增长 | [JVM 内存与 GC 案例](./06-diagnostics/01-jvm/chapter-02-cases-cpu-memory.md) |
| GC 频繁、停顿长、吞吐下降 | [GC 案例](./06-diagnostics/01-jvm/chapter-03-cases-gc-resources.md) 与 [GC 延迟案例](./06-diagnostics/01-jvm/chapter-04-cases-gc-latency.md) |
| 死锁、锁竞争、线程池饱和、异步超时 | [并发诊断](./06-diagnostics/02-concurrency/chapter-01-concurrency-diagnostics.md) |
| 接口超时、RT 高、连接失败、连接数异常 | [网络诊断](./06-diagnostics/03-network/chapter-01-network-diagnostics.md) |
| 获取连接超时、连接池耗尽、慢 SQL | [数据访问诊断](./06-diagnostics/04-data-access/index.md) |
| 容器 OOMKilled、堆外内存异常 | [堆外与网络案例](./06-diagnostics/01-jvm/chapter-05-cases-offheap-network.md) |

进入后对照相似案例确定第一步采集什么数据，再回到对应原理章节验证根因，而不是只复制修复参数。完整的跨域定位路径见 [诊断总览](./06-diagnostics/index.md)。

## 入口 C：按工具与证据查阅

适合你已经拿到了现场证据，需要判断它证明了什么、下一步去哪。

| 你手上的证据 | 能证明什么、去哪查 |
| :-- | :-- |
| 线程转储（jstack/Arthas） | 线程状态、锁持有、调用栈。去 [并发诊断](./06-diagnostics/02-concurrency/chapter-01-concurrency-diagnostics.md)。 |
| JFR / GC 日志 | 分配速率、GC 原因与停顿、SafePoint。去 [JVM 诊断](./06-diagnostics/01-jvm/chapter-01-jvm-diagnostics.md)。 |
| 堆转储（jmap/Arthas heapdump） | 对象占用、泄漏点。去 [JVM 内存与 GC 案例](./06-diagnostics/01-jvm/chapter-02-cases-cpu-memory.md)。 |
| 抓包（tcpdump/Wireshark） | 建连、重传、RTT、连接状态。去 [网络诊断](./06-diagnostics/03-network/chapter-01-network-diagnostics.md)。 |
| 连接池指标（活跃数、等待时间） | 连接供给与持有关系。去 [数据访问诊断](./06-diagnostics/04-data-access/index.md) 与 [并发诊断](./06-diagnostics/02-concurrency/chapter-01-concurrency-diagnostics.md)。 |
| Arthas 在线诊断 | 方法耗时、调用链、类加载。可同时对照 JVM 与并发诊断。 |

每条证据都先回答「证据指向哪一层」，再进入对应原理页，不要凭单一指标直接下结论。

## 内容边界

- Java 专题解释语言、JVM、并发、网络和数据访问的底层机制。
- JPMS 模块系统属于语言与部署边界，只在现代语言特性页说明定位，不扩展成独立主线章节。
- Spring 专题负责框架配置、API 和集成方式。
- 工程专题负责设计原则、架构和通用工程实践。
- MySQL、PostgreSQL 等专题负责数据库内核与 SQL 优化。

遇到跨专题问题时，各页面会给出下一跳链接，避免重复解释同一机制。
