# Java 技术体系

系统化的 Java 后端技术体系，从语言基础到 JVM 内核，从并发编程到网络通信。

## 目录结构

### 01-java-language
- [类型系统](01-java-language/chapter-01-type-system) — 基本类型与引用类型、对象模型、equals/hashCode、String 不可变
- [面向对象](01-java-language/chapter-02-oop) — 封装、继承、多态、SOLID、组合优于继承
- [泛型](01-java-language/chapter-03-generics) — 类型擦除、通配符与 PECS、桥接方法
- [注解与 Lambda](01-java-language/chapter-04-annotation-lambda) — 注解生命周期、APT、函数式接口、invokedynamic、Stream

### 02-jvm-runtime
- [字节码与类加载](02-jvm-runtime/chapter-01-bytecode-classloading) — Class 文件结构、字节码指令、双亲委派、打破委派
- [JVM 运行时数据区](02-jvm-runtime/chapter-02-memory-model) — 堆/栈/方法区/Metaspace、栈帧、StringTable
- [对象模型](02-jvm-runtime/chapter-03-object-model) — 对象创建、内存布局、Mark Word、Monitor、TLAB、逃逸分析
- [垃圾回收](02-jvm-runtime/chapter-04-gc) — 可达性分析、四种引用、CMS/G1/ZGC
- [JIT 编译](02-jvm-runtime/chapter-05-jit) — 分层编译、方法内联、逃逸分析优化、去优化
- [线上排查与诊断](02-jvm-runtime/chapter-06-diagnostics) — CPU 100%、Heap Dump、Arthas、JFR、参数速查
- [案例集（一）：CPU 飙升与内存泄漏](02-jvm-runtime/chapter-06-diagnostics-cases-part1) — 真实案例
- [案例集（二）：低内存低 CPU 的 GC 疑难](02-jvm-runtime/chapter-06-diagnostics-cases-part2) — 真实案例
- [案例集（三）：低内存低 CPU 的 GC 疑难](02-jvm-runtime/chapter-06-diagnostics-cases-part3) — 真实案例
- [案例集（四）：TCP 层与堆外内存](02-jvm-runtime/chapter-06-diagnostics-cases-part4) — 真实案例

### 03-java-concurrency
- [并发的本质](03-java-concurrency/chapter-01-why-concurrency) — 三大驱动力、并发与并行、数据竞争
- [线程：Java 的执行单元](03-java-concurrency/chapter-02-thread-model) — 1:1 模型、创建方式演进、生命周期
- [线程封闭：ThreadLocal](03-java-concurrency/chapter-03-threadlocal) — 存储结构、内存泄漏、InheritableThreadLocal
- [Java 内存模型（JMM）](03-java-concurrency/chapter-04-jmm) — 可见性/有序性/原子性、happens-before
- [volatile](03-java-concurrency/chapter-05-volatile) — 内存屏障、MESI、DCL
- [synchronized](03-java-concurrency/chapter-06-synchronized) — Monitor、Mark Word 锁状态、锁升级
- [CAS 与原子类](03-java-concurrency/chapter-07-cas-atomic) — CAS 原理、ABA 问题、LongAdder
- [LockSupport 与 AQS](03-java-concurrency/chapter-08-locksupport-aqs) — park/unpark、state + CLH 队列
- [并发集合](03-java-concurrency/chapter-09-concurrent-collections) — ConcurrentHashMap、CopyOnWrite、BlockingQueue
- [线程池](03-java-concurrency/chapter-10-thread-pool) — ThreadPoolExecutor、execute() 源码、拒绝策略、ForkJoinPool
- [异步编程](03-java-concurrency/chapter-11-async-model) — Future → CompletableFuture、响应式、Actor 模型
- [虚拟线程与结构化并发](03-java-concurrency/chapter-12-virtual-thread) — M:N 调度、pinning、StructuredTaskScope
- [诊断与优化](03-java-concurrency/chapter-13-diagnostics) — 死锁诊断、Thread Dump、锁竞争、优化策略
- [案例集：死锁、线程池与虚拟线程](03-java-concurrency/chapter-13-diagnostics-cases) — 真实案例

### 04-java-network
- [网络通信基础](04-java-network/chapter-01-network-basics) — 分层模型、数据封装旅程
- [TCP/IP](04-java-network/chapter-02-tcp-ip) — 三次握手/四次挥手、粘包拆包、性能参数
- [Socket 编程](04-java-network/chapter-03-socket) — fd 与五元组、系统调用链、内核队列
- [Java NIO](04-java-network/chapter-04-nio) — Channel/Buffer/Selector、Reactor 模式
- [Netty](04-java-network/chapter-05-netty) — EventLoop、Pipeline、ByteBuf、编解码
- [HTTP 协议](04-java-network/chapter-06-http) — 方法语义、状态码、HTTP/1.1→2→3 演进
- [Servlet 到 Spring MVC](04-java-network/chapter-07-servlet-springmvc) — Tomcat NIO、DispatcherServlet
- [RPC 与微服务](04-java-network/chapter-08-rpc) — 序列化、服务发现、Dubbo/gRPC
- [长连接与实时通信](04-java-network/chapter-09-long-connection) — WebSocket、SSE、IM 系统设计
- [网络诊断](04-java-network/chapter-10-network-diagnostics) — 抓包、netstat、优化策略

### 05-java-data-access
- [持久化思想](05-java-data-access/chapter-01-persistence-thought) — 对象-关系阻抗失配、三种层次
- [JDBC](05-java-data-access/chapter-02-jdbc) — 核心接口、PreparedStatement、性能瓶颈
- [MyBatis](05-java-data-access/chapter-03-mybatis) — Mapper 动态代理、缓存机制、插件机制
- [ORM 深入](05-java-data-access/chapter-04-orm-deep) — MyBatis vs Hibernate、Entity 生命周期、N+1 问题
- [数据库核心原理](05-java-data-access/chapter-05-db-principles) — B+Tree 索引、EXPLAIN、锁、事务隔离级别
- [Spring 事务](05-java-data-access/chapter-06-spring-transaction) — @Transactional、传播机制、失效场景
- [性能优化](05-java-data-access/chapter-07-performance) — HikariCP、批处理、链路分析

### 06-java-enterprise
- [企业系统部署](06-java-enterprise/chapter-08-security-deploy) — Docker、Kubernetes、多环境配置
- [可观测性](06-java-enterprise/chapter-09-observability) — ELK、Prometheus/Grafana、OpenTelemetry

### 07-performance-architecture
- [性能工程](07-performance-architecture/chapter-08-performance) — 指标体系、Profiling、JVM 诊断
- [架构案例](07-performance-architecture/chapter-09-case-studies) — 秒杀、Feed 流、支付系统
