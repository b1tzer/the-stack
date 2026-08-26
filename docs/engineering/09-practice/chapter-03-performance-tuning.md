# 性能调优

> **核心问题**：如何定位性能瓶颈？JVM 调优怎么做？SQL 慢查询如何优化？

## 1. 性能分析方法论

```java
// 性能分析三步法
// 1. 测量：用工具找到瓶颈
// 2. 分析：理解瓶颈的原因
// 3. 优化：针对性地解决问题

// 常用工具
// - JProfiler / VisualVM：JVM 分析
// - Arthas：在线诊断
// - MySQL EXPLAIN：SQL 分析
// - wrk / JMeter：压力测试
```

## 2. JVM 调优

```bash
# JVM 参数调优
# 堆内存设置
-Xms4g -Xmx4g          # 初始和最大堆大小相同，避免动态调整
-Xmn2g                   # 新生代大小（堆的 1/3 到 1/2）

# GC 选择
-XX:+UseG1GC             # G1 垃圾收集器（推荐）
-XX:MaxGCPauseMillis=200 # 目标停顿时间

# GC 日志
-Xlog:gc*:file=gc.log:time,uptime,level,tags

# 常见 JVM 问题
# 1. OOM（OutOfMemoryError）
#    - 堆内存不足：增大 -Xmx
#    - 内存泄漏：dump 堆分析（jmap -dump:format=b,file=heap.bin <pid>）
#
# 2. GC 停顿过长
#    - 新生代过小：增大 -Xmn
#    - 使用 G1/ZGC 减少停顿
#
# 3. 线程死锁
#    - jstack <pid> 查看线程状态
```

## 3. SQL 慢查询优化

```java
// 使用 EXPLAIN 分析查询计划
// EXPLAIN SELECT * FROM orders WHERE user_id = 123 AND status = 'PAID';
// 关注字段：type, key, rows, Extra

// type 性能排序（从好到差）
// system > const > eq_ref > ref > range > index > ALL

// 常见优化手段
// 1. 添加合适的索引
// 2. 避免 SELECT *
// 3. 避免在 WHERE 中使用函数
// 4. 小表驱动大表
// 5. 分页优化（深度分页用游标）

// 深度分页优化
// 差：OFFSET 大时性能差
// SELECT * FROM orders ORDER BY id LIMIT 1000000, 10;
// EXPLAIN: type=ALL, rows=1000010

// 好：使用游标分页
// SELECT * FROM orders WHERE id > 1000000 ORDER BY id LIMIT 10;
// EXPLAIN: type=range, rows=10
```

## 4. 应用层调优

```java
// 1. 批量操作替代循环操作
// 差：循环插入
for (Order order : orders) {
    orderRepository.save(order);  // N 次数据库操作
}
// 好：批量插入
orderRepository.saveAll(orders);  // 1 次数据库操作

// 2. 异步处理非关键路径
// 差：同步处理所有逻辑
orderRepository.save(order);
auditService.log(order);          // 非关键，可以异步
notificationService.notify(order); // 非关键，可以异步
return orderId;

// 好：异步处理非关键路径
orderRepository.save(order);
CompletableFuture.runAsync(() -> auditService.log(order));
CompletableFuture.runAsync(() -> notificationService.notify(order));
return orderId;

// 3. 连接池配置
// HikariCP 推荐配置
// maximum-pool-size: 20（CPU 核心数 × 2 + 磁盘数）
// minimum-idle: 5
// connection-timeout: 30000
// idle-timeout: 600000
// max-lifetime: 1800000
```

## 5. 性能测试

```bash
# 使用 wrk 进行压力测试
wrk -t12 -c400 -d30s http://localhost:8080/api/v1/users

# 输出示例
# Running 30s test @ http://localhost:8080/api/v1/users
#   12 threads and 400 connections
#   Thread Stats   Avg      Stdev     Max   +/- Stdev
#     Latency    45.23ms   12.34ms  156.78ms   85.62%
#     Req/Sec     1.23k   123.45     1.56k     78.33%
#   421234 requests in 30.05s, 123.45MB read
# Requests/sec:  14021.23
# Transfer/sec:      4.11MB
```

> **性能调优的核心**：不要过早优化，不要凭感觉优化。先测量，找到真正的瓶颈，然后针对性优化。80% 的性能问题出在 20% 的代码上。
