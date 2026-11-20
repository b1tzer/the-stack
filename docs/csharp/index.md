# C# 知识库

这套内容面向已经掌握任意一门编程语言、希望系统学习 C# 与 .NET 并具备独立开发能力的开发者。读完全部核心路径后，你能用 C# 写出结构清晰的程序，理解 .NET 的编译模型、运行时与核心库，并把它们用于 Web、数据访问与并发场景。

> 本专题以 **.NET 10 LTS + C# 14** 为基线，该版本支持至 2028-11-14。涉及版本差异的结论都会标明适用版本；版本支持状态见 [.NET 官方支持策略](https://dotnet.microsoft.com/platform/support/policy)。

## 内容地图

- **[01 C# 语言](./01-csharp-language/chapter-01-why-csharp.md)**：认识 .NET 与 C#、类型系统、对象与值语义、面向对象、泛型、特性、委托与 Lambda、异常、集合与 LINQ、序列化、反射、表达式树，以及 record、模式匹配与可空引用类型等现代特性。
- **[02 .NET 运行时](./02-dotnet-runtime/chapter-01-compilation-clr.md)**：编译与 CLR、类型布局与内存、GC、JIT 与 AOT、非托管互操作。
- **[03 C# 并发与异步](./03-csharp-concurrency/chapter-01-why-async.md)**：异步模型、Task 与 async/await、取消、线程与同步、并行与 LINQ、内存模型、lock 与 Monitor、无锁编程、并发集合、线程池、异步流与 Channels、常见并发缺陷。
- **[04 ASP.NET Core](./04-aspnet-core/chapter-01-why-aspnet-core.md)**：Minimal API、路由与 MVC、中间件管道、依赖注入、配置与日志。
- **[05 网络](./05-network/chapter-01-http-client.md)**：HttpClient 与 HttpClientFactory、Socket 与 TCP、gRPC、SignalR。
- **[06 数据访问](./06-data-access/chapter-01-persistence-thought.md)**：持久化思想、EF Core、查询与调优、迁移、测试、ADO.NET、Dapper、事务与隔离级别、索引与执行计划。
- **[07 诊断](./07-diagnostics/index.md)**：内存、并发、CPU 性能的排查方法与生产案例。

## 学习路径

适合按知识体系学习，从语言机制逐步深入：

1. 完成 C# 语言：类型系统、对象与值语义、面向对象、泛型、委托、异常、集合与 LINQ，以及序列化、反射和现代语言特性。
2. 沿编译模型、类型布局、GC、JIT/AOT 理解程序如何运行。
3. 学习异步模型、Task、内存模型、锁与并发原语。
4. 根据工作方向进入 ASP.NET Core、网络或数据访问。
5. 最后通过诊断方法与生产案例串联前面的机制。

## 内容边界

- C# 专题负责语言机制、类型系统、.NET 运行时、并发异步与应用开发。
- 设计模式、架构原则、可观测性等跨语言实践由 [设计模式](../design-pattern/index.md) 与 [工程](../engineering/index.md) 专题负责，本专题只解释它们在 C# 中的落地。
- Java 专题负责 JVM 生态的对应机制；两者内容并行，遇到相同概念时互相链接而非重复。
