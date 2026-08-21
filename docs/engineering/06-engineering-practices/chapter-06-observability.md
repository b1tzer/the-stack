# 可观测性

> **核心问题**：日志、指标、链路追踪三大支柱如何落地？如何快速定位线上问题？

---

## 1. 可观测性三大支柱

| 支柱 | 回答的问题 | 工具 |
|------|-----------|------|
| 日志（Logging） | 发生了什么？ | ELK、Loki |
| 指标（Metrics） | 系统状态如何？ | Prometheus、Grafana |
| 链路追踪（Tracing） | 请求经过了哪些服务？ | SkyWalking、Jaeger |

## 2. 结构化日志

```java
// 使用 SLF4J + Logback 结构化日志
@Slf4j
@Service
public class OrderService {
    
    public Long createOrder(CreateOrderCommand cmd) {
        // 使用 MDC 记录请求上下文
        MDC.put("userId", String.valueOf(cmd.getUserId()));
        MDC.put("traceId", Tracer.currentSpan().context().traceId());
        
        try {
            log.info("开始创建订单, amount={}", cmd.getAmount());
            
            Order order = new Order(cmd.getUserId(), cmd.getAmount());
            orderRepository.save(order);
            
            log.info("订单创建成功, orderId={}", order.getId());
            return order.getId();
            
        } catch (Exception e) {
            log.error("订单创建失败, userId={}, amount={}", 
                cmd.getUserId(), cmd.getAmount(), e);
            throw e;
        } finally {
            MDC.clear();
        }
    }
}

// 日志格式（JSON 格式，便于 ELK 解析）
// {"timestamp":"2024-01-15T10:30:00Z","level":"INFO","logger":"OrderService",
//  "message":"订单创建成功","orderId":12345,"userId":100,"traceId":"abc123"}
```

## 3. 指标监控

```java
// Spring Boot Actuator + Micrometer 指标暴露
// application.yml
// management:
//   endpoints:
//     web:
//       exposure:
//         include: health,metrics,prometheus
//   metrics:
//     tags:
//       application: order-service

// 自定义业务指标
@Component
public class OrderMetrics {
    private final Counter orderCounter;
    private final Timer orderTimer;
    private final Gauge orderGauge;
    
    public OrderMetrics(MeterRegistry registry) {
        this.orderCounter = Counter.builder("orders.created")
            .description("创建的订单数")
            .register(registry);
        
        this.orderTimer = Timer.builder("orders.processing.time")
            .description("订单处理耗时")
            .register(registry);
    }
    
    public void recordOrderCreated() {
        orderCounter.increment();
    }
    
    public <T> T recordProcessingTime(Supplier<T> supplier) {
        return orderTimer.record(supplier);
    }
}

// Grafana 告警规则示例
// - alert: HighErrorRate
//   expr: rate(http_server_requests_seconds_count{status=~"5.."}[5m]) / rate(http_server_requests_seconds_count[5m]) > 0.05
//   for: 5m
//   labels:
//     severity: critical
//   annotations:
//     summary: "错误率超过 5%"
```

## 4. 链路追踪

```java
// SkyWalking 自动注入，无需代码修改
// 通过 Java Agent 启动：
// java -javaagent:skywalking-agent.jar -jar app.jar

// 自定义 Span
@GetMapping("/orders/{id}")
public OrderVO getOrder(@PathVariable Long id) {
    // SkyWalking 自动创建 Span
    // 可以手动添加标签
    Span span = ContextManager.createLocalSpan("processOrder");
    try {
        span.tag("orderId", String.valueOf(id));
        Order order = orderRepository.findById(id);
        return OrderMapper.toVO(order);
    } finally {
        ContextManager.stopSpan();
    }
}

// 链路追踪的价值：
// 1. 快速定位慢请求（哪个服务、哪个方法耗时最长）
// 2. 发现服务间调用关系（调用拓扑图）
// 3. 分析错误传播路径（错误从哪个服务开始）
// 4. 容量规划（每个服务的 QPS 和延迟分布）
```

## 5. 监控体系设计

| 层次 | 监控内容 | 告警阈值 |
|------|---------|---------|
| 基础设施 | CPU、内存、磁盘、网络 | CPU > 80%、内存 > 90% |
| 应用层 | QPS、响应时间、错误率 | 错误率 > 5%、P99 > 1s |
| 业务层 | 订单量、支付成功率 | 支付成功率 < 95% |

> **核心原则**：可观测性不是事后补充，而是从第一天就设计进去。日志告诉你"发生了什么"，指标告诉你"系统状态如何"，链路追踪告诉你"问题在哪里"。三者缺一不可。

---

## 6. 线上问题定位方法论

### 6.1 三板斧：日志、指标、链路

线上问题排查的通用流程：

```text
发现问题（告警/用户反馈）
    │
    ▼
第一步：看指标（Grafana）
    │  QPS？错误率？P99？JVM？CPU？内存？
    │  → 确定问题的大致范围和影响
    │
    ▼
第二步：看链路（Jaeger/SkyWalking）
    │  找一个有问题的 Trace，看完整调用链
    │  → 定位到具体哪个环节出了问题
    │
    ▼
第三步：看日志（Kibana）
    │  用 TraceID 搜索相关日志
    │  → 找到具体的异常堆栈和错误原因
    │
    ▼
定位根因，制定修复方案
```

### 6.2 常见问题排查路径

| 问题现象 | 排查步骤 | 工具 | 常见根因 |
|---------|---------|------|---------|
| **接口响应变慢** | ① Grafana 看 P99 趋势 → ② Jaeger 找慢 Trace → ③ 定位慢在哪个 Span → ④ Kibana 看该 Span 的日志 | Grafana + Jaeger + Kibana | 慢 SQL、缓存穿透、下游超时、GC 暂停 |
| **偶发 500 错误** | ① Grafana 看错误率和时间分布 → ② Kibana 搜 ERROR 日志 → ③ 看异常堆栈 → ④ 关联 TraceID 看请求上下文 | Grafana + Kibana + Jaeger | 空指针、参数校验失败、并发竞争、连接池耗尽 |
| **内存泄漏** | ① Grafana 看堆内存趋势（只升不降） → ② 确认是 Old Gen 还是 Young Gen → ③ `jmap -dump` 生成堆转储 → ④ MAT 分析大对象 | Grafana + jmap + MAT | 大集合未清理、ThreadLocal 泄露、缓存无上限 |
| **CPU 飙高** | ① `top` 找到高 CPU 的 Java 进程 → ② `top -Hp <pid>` 找高 CPU 线程 → ③ 线程 ID 转 16 进制 → ④ `jstack` 找对应线程堆栈 | top + jstack | 死循环、频繁 Full GC、正则回溯、加密计算 |
| **频繁 Full GC** | ① Grafana 看 GC 频率和暂停时间 → ② 添加 GC 日志 `-Xlog:gc*` → ③ GCViewer 分析 → ④ jmap dump 分析对象分布 | Grafana + GC 日志 + MAT | 堆内存太小、内存泄漏、大对象直接进入老年代 |
| **数据库连接池耗尽** | ① Grafana 看 `hikaricp_connections_active` → ② 确认是否达到上限 → ③ 检查慢 SQL → ④ 检查事务是否正确关闭 | Grafana + Kibana | 慢 SQL 长时间占用连接、事务未提交/回滚、连接泄漏 |

### 6.3 接口变慢的详细排查

以"接口响应变慢"为例，详细展示排查过程：

![observability-troubleshoot](/spring/observability-troubleshoot.svg)

### 6.4 排查工具速查表

| 场景 | 命令/工具 | 说明 |
|------|----------|------|
| 查看 JVM 参数 | `jinfo -flags <pid>` | 确认 JVM 配置是否正确 |
| 查看堆内存 | `jmap -heap <pid>` | 查看各代内存使用情况 |
| 生成堆转储 | `jmap -dump:format=b,file=heap.hprof <pid>` | 用于 MAT 分析 |
| 查看线程状态 | `jstack <pid>` | 分析死锁、线程阻塞 |
| 查看 GC 日志 | `jstat -gcutil <pid> 1000` | 每秒输出 GC 统计 |
| 在线诊断 | Arthas（`java -jar arthas-boot.jar`） | 阿里开源，支持 trace/watch/monitor |
| CPU 分析 | `async-profiler` | 低开销的 CPU/内存火焰图生成 |

### 6.5 Arthas 常用命令

Arthas 是阿里巴巴开源的 Java 诊断工具，可以在不重启应用的情况下进行在线诊断：

```bash
# 启动 Arthas，连接到目标 JVM
java -jar arthas-boot.jar

# 查看方法调用耗时（追踪某个方法的调用链路和耗时）
trace com.example.service.OrderService getOrder

# 监控方法调用（统计 QPS、成功率、平均耗时）
monitor com.example.service.OrderService getOrder -c 10

# 观察方法入参和返回值
watch com.example.service.OrderService getOrder '{params, returnObj, throwExp}'

# 反编译线上类（确认代码版本）
jad com.example.service.OrderService

# 查看堆中的对象
dashboard                    # 实时面板（线程、内存、GC）
heapdump /tmp/heap.hprof     # 导出堆转储
thread -n 3                  # 查看最忙的 3 个线程
```

Arthas 的 `trace` 命令输出示例：

```text
$ trace com.example.service.OrderService getOrder
Press Q or Ctrl+C to abort.
Affect(class count: 1 , method count: 1) cost in 42 ms.
ts=2024-01-15 14:23:45; [cost=15.23ms] result=@ArrayList[
    @OrderService[getOrder],
    @ArrayList[
        @OrderMapper[selectById]=[cost=8.12ms],
        @PaymentClient[queryByOrderId]=[cost=5.67ms],
    ],
]
```

---

## 本章小结

可观测性三大支柱各司其职，又通过 TraceID 紧密关联：

| 支柱 | 回答的问题 | 数据形态 | 代表技术栈 |
|------|-----------|---------|-----------|
| **日志** | 发生了什么？ | 离散事件 | Logback → Filebeat → Elasticsearch → Kibana |
| **指标** | 整体状况如何？ | 时间序列数值 | Micrometer → Prometheus → Grafana |
| **链路追踪** | 请求经过了哪里？哪里慢？ | 调用树 | OpenTelemetry → Collector → Jaeger/SkyWalking |

三者不是互斥选择，而是互补关系。日志提供细节，指标提供全局视图，链路追踪提供调用路径。通过 TraceID 将三者串联，才能构建完整的可观测体系。
