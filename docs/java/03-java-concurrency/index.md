# Java 并发

> 回答"多线程如何正确高效地共享资源"。按 竞争本质 → 线程 → 线程封闭 → JMM → volatile → synchronized → CAS → LockSupport/AQS → 并发集合 → 线程池 → 异步编程 → 虚拟线程 → 诊断 组织。

## 章节

- [并发的本质：从竞争到协作](/java/03-java-concurrency/chapter-01-why-concurrency) — 三大驱动力、并发与并行、数据竞争
- [线程：Java 的执行单元](/java/03-java-concurrency/chapter-02-thread-model) — 1:1 模型、创建方式演进、生命周期
- [线程封闭：`ThreadLocal` 与无共享编程](/java/03-java-concurrency/chapter-03-threadlocal) — 存储结构、内存泄漏、`InheritableThreadLocal`、TTL
- [Java 内存模型（JMM）](/java/03-java-concurrency/chapter-04-jmm) — 可见性/有序性/原子性、happens-before
- [`volatile`：最轻的同步](/java/03-java-concurrency/chapter-05-volatile) — 内存屏障、MESI、DCL
- [`synchronized`：JVM 内置锁](/java/03-java-concurrency/chapter-06-synchronized) — Monitor、Mark Word 锁状态、锁升级
- [CAS 与原子类](/java/03-java-concurrency/chapter-07-cas-atomic) — CAS 原理、ABA 问题、`LongAdder`
- [`LockSupport` 与 AQS](/java/03-java-concurrency/chapter-08-locksupport-aqs) — `park/unpark`、state + CLH 队列、`ReentrantLock` / `Semaphore` / `CountDownLatch`
- [并发集合](/java/03-java-concurrency/chapter-09-concurrent-collections) — `ConcurrentHashMap`、`CopyOnWrite`、`BlockingQueue`
- [线程池](/java/03-java-concurrency/chapter-10-thread-pool) — `ThreadPoolExecutor`、`execute()` 源码、拒绝策略、`ForkJoinPool`
- [异步编程](/java/03-java-concurrency/chapter-11-async-model) — `Future` → `CompletableFuture`、响应式、Actor 模型
- [虚拟线程与结构化并发（JDK 21）](/java/03-java-concurrency/chapter-12-virtual-thread) — M:N 调度、pinning、`StructuredTaskScope`
- [诊断与优化](/java/03-java-concurrency/chapter-13-diagnostics) — 死锁诊断、Thread Dump、锁竞争、优化策略
