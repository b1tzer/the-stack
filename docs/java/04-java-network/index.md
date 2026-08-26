# 网络与通信

> 回答"数据如何从一个 JVM 到另一个 JVM"。覆盖 TCP/IP → Socket → NIO → Netty → HTTP → Servlet/Spring MVC → RPC → 长连接。

## 阅读路径

本卷 10 章按依赖关系组织，下面是四条不同目标的阅读路径：

```text
【路径 A：快速建立网络编程能力】（3-4 章）
  第1章 网络基础 ──► 第3章 Socket ──► 第4章 NIO
  适合：马上要用 NIO/Netty 写项目，需要快速理解 IO 模型

【路径 B：全面理解 Java 网络栈】（6-7 章）
  第1章 ─► 第2章 TCP ─► 第3章 Socket ─► 第4章 NIO ─► 第5章 Netty ─► 第6章 HTTP
  适合：有 2-3 年经验的开发者，系统补齐网络底层知识

【路径 C：Web 框架深度定制者】（5-6 章）
  第3章 Socket ─► 第7章 Servlet/Spring MVC ─► 第8章 RPC ─► 第9章 长连接
  适合：日常用 Spring Boot，想理解底层 Tomcat / Servlet / RPC 是怎么工作的

【路径 D：生产排错急救】（随查随走）
  第10章 网络诊断（独立）← 遇到问题直奔这章
  适合：线上出了网络问题，需要工具和排查思路
```

各章的内容深度和认知负荷：

| 章 | 定位 | 认知负荷 | 提前看下一章？ |
|----|------|---------|--------------|
| 网络基础 | 铺垫 | 低 | 不用，但第2、3章会重复核心概念 |
| TCP/IP | 深水区 | 高 | §2.3 读完可暂停，歇口气再继续 |
| Socket | 核心 | 中 | 与[第4章](./chapter-04-nio)前后呼应，建议连着读 |
| NIO | 核心 | 高 | §4.1 读完可直接跳到 §4.5 Selector |
| Netty | 实战 | 中 | 需要[第4章](./chapter-04-nio)的 Selector/Reactor 基础 |
| HTTP | 应用 | 低 | 独立性强，可跳读 |
| Servlet/Spring MVC | 实战 | 中 | 标注了快速路径和深入路径，可按需读 |
| RPC | 实战 | 中 | 依赖[第3章](./chapter-03-socket) Socket，建议读完后读 |
| 长连接 | 进阶 | 中 | 可选，不影响其他章理解 |
| 网络诊断 | 工具 | 低 | 独立，任何时候都可以翻 |

## 章节

- [网络通信基础](/java/04-java-network/chapter-01-network-basics) — 分层模型、数据封装旅程
- [TCP/IP](/java/04-java-network/chapter-02-tcp-ip) — 三次握手/四次挥手、粘包拆包、性能参数
- [Socket 编程](/java/04-java-network/chapter-03-socket) — fd 与五元组、系统调用链、内核队列、Socket 选项
- [Java NIO](/java/04-java-network/chapter-04-nio) — Channel/Buffer/Selector、Reactor 模式
- [Netty](/java/04-java-network/chapter-05-netty) — EventLoop、Pipeline、ByteBuf、编解码
- [HTTP 协议](/java/04-java-network/chapter-06-http) — 方法语义、状态码、HTTP/1.1→2→3 演进
- [Servlet 到 Spring MVC](/java/04-java-network/chapter-07-servlet-springmvc) — Tomcat NIO、DispatcherServlet
- [RPC 与微服务](/java/04-java-network/chapter-08-rpc) — 序列化、服务发现、Dubbo/gRPC
- [长连接与实时通信](/java/04-java-network/chapter-09-long-connection) — WebSocket、SSE、IM 系统设计
- [网络诊断](/java/04-java-network/chapter-10-network-diagnostics) — 抓包、netstat、优化策略
