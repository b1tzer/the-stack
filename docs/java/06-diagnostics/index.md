# Java 诊断总览

诊断页面按故障域组织。先选择最接近的症状，再进入对应的原理页面验证根因。

## JVM 诊断

- [JVM 线上诊断](./01-jvm/chapter-01-jvm-diagnostics.md)：CPU、GC、OOM、线程和常用工具的排查流程。
- [CPU 与内存泄漏案例](./01-jvm/chapter-02-cases-cpu-memory.md)：正则回溯、无界缓存和 Metaspace 泄漏。
- [GC、资源与综合诊断案例](./01-jvm/chapter-03-cases-gc-resources.md)：Full GC、连接池耗尽以及 Arthas 与 JFR 组合排查。
- [GC 延迟与分配异常案例](./01-jvm/chapter-04-cases-gc-latency.md)：分配速率、对象寿命、SafePoint 和晋升异常。
- [TCP 层与堆外内存案例](./01-jvm/chapter-05-cases-offheap-network.md)：连接数限制、直接内存和容器 OOMKilled。

## 并发诊断

- [并发问题诊断与性能优化](./02-concurrency/chapter-01-concurrency-diagnostics.md)：死锁、锁竞争、线程池和虚拟线程诊断。
- [锁与执行模型案例](./02-concurrency/chapter-02-cases-lock-execution.md)：死锁和线程池饱和。
- [并发案例：可变键与虚拟线程 pinning](./02-concurrency/chapter-02-cases-mutable-key-pin.md)：并发集合键变更和虚拟线程 pinning。
- [异步任务与下游超时案例](./02-concurrency/chapter-03-cases-async-timeout.md)：任务丢弃、参数失效、调度阻塞和超时级联。

## 网络与数据访问

- [网络性能分析与故障排查](./03-network/chapter-01-network-diagnostics.md)：常见网络症状、抓包和 Java 网络诊断。
- [网络诊断：高并发优化与最佳实践](./03-network/chapter-01-network-optimization-practices.md)：高并发网络优化和最佳实践。
- [数据访问性能优化](../05-java-data-access/chapter-05-performance.md)：连接池、批处理、链路分析和常见故障。

## 使用方式

1. 记录症状、时间点和影响范围，不要先猜根因。
2. 选择对应诊断页，先确认数据来自正确的层级。
3. 用案例中的信号缩小范围，再回到原理页验证。
4. 修复后同时验证指标恢复、错误消失和业务结果正常。
