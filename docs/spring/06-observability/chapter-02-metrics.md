# 指标监控

> **一句话总结**：你引入了 Prometheus，但不知道该监控什么、怎么监控——Micrometer 就是 Java 世界的指标标准 API，Prometheus + Grafana 是最成熟的监控方案。

## 1. Micrometer 核心概念

### 1.1 Micrometer = 指标领域的 SLF4J

```
你的代码
  │
  ▼
Micrometer（门面/API）
  │
  ├──► Prometheus（实现）
  ├──► Datadog（实现）
  ├──► CloudWatch（实现）
  └──► Graphite（实现）
```

**核心概念**：

| 概念 | 类比 | 说明 |
|------|------|------|
| `Meter` | 一条日志记录 | 一个指标实例 |
| `MeterRegistry` | Logger | 指标的注册中心 |
| `Tag` | MDC 变量 | 指标的维度标签 |
| `MeterBinder` | Appender | 自动绑定指标到 Registry |

### 1.2 Meter 类型

| 类型 | 用途 | 示例 |
|------|------|------|
| `Counter` | 单调递增计数 | 请求总数、订单数 |
| `Gauge` | 可增可减的瞬时值 | 队列长度、内存使用 |
| `Timer` | 耗时统计 | 接口响应时间 |
| `DistributionSummary` | 值分布统计 | 订单金额分布 |
| `LongTaskTimer` | 长时间任务 | 批处理任务耗时 |

```yaml
# application.yml — Micrometer 基础配置
management:
  metrics:
    tags:
      app: myapp        # 全局标签，所有指标都带
      env: ${ENV:dev}
    distribution:
      percentiles-histogram:
        http.server.requests: true  # 开启百分位直方图
      sla:
        http.server.requests: 100ms,200ms,500ms,1s  # SLA 分桶
```

> **踩坑提醒**：Tag 的基数（cardinality）不能太高！比如把 `userId` 当 Tag，100 万个用户就会产生 100 万个时间序列，Prometheus 会内存爆炸。高基数维度应该放在日志里，而不是指标里。

## 2. 自定义业务指标

**痛点**：Spring Boot 自带的 `http.server.requests` 指标只能看接口层面，你还需要业务层面的指标——订单数、支付耗时、队列积压。

### 2.1 Counter — 订单数统计

```java
@Component
public class OrderMetrics {

    private final Counter orderCreatedCounter;
    private final Counter orderFailedCounter;

    public OrderMetrics(MeterRegistry registry) {
        this.orderCreatedCounter = Counter.builder("business.orders.created")
            .description("成功创建的订单数")
            .tag("type", "total")
            .register(registry);

        this.orderFailedCounter = Counter.builder("business.orders.failed")
            .description("创建失败的订单数")
            .register(registry);
    }

    public void orderCreated() {
        orderCreatedCounter.increment();
    }

    public void orderFailed(String reason) {
        Counter.builder("business.orders.failed")
            .tag("reason", reason)
            .register(registry)
            .increment();
    }
}
```

### 2.2 Timer — 支付耗时

```java
@Service
@RequiredArgsConstructor
public class PaymentService {

    private final MeterRegistry registry;

    public PaymentResult pay(PaymentRequest request) {
        // 方式 1：手动计时
        Timer.Sample sample = Timer.start(registry);

        try {
            PaymentResult result = doPay(request);
            sample.stop(Timer.builder("business.payment.duration")
                .description("支付处理耗时")
                .tag("channel", request.getChannel())
                .tag("status", "success")
                .register(registry));
            return result;
        } catch (Exception e) {
            sample.stop(Timer.builder("business.payment.duration")
                .tag("channel", request.getChannel())
                .tag("status", "failure")
                .register(registry));
            throw e;
        }
    }

    // 方式 2：@Timed 注解（需要引入 AOP）
    @Timed(value = "business.payment.duration",
           description = "支付处理耗时",
           percentiles = {0.5, 0.95, 0.99})
    public PaymentResult payWithAnnotation(PaymentRequest request) {
        return doPay(request);
    }
}
```

启用 `@Timed` 注解：

```java
@Configuration
public class MetricsConfig {
    @Bean
    public TimedAspect timedAspect(MeterRegistry registry) {
        return new TimedAspect(registry);
    }
}
```

### 2.3 Gauge — 队列积压

```java
@Component
public class QueueMetrics {

    private final Queue<Order> orderQueue = new LinkedBlockingQueue<>(1000);

    public QueueMetrics(MeterRegistry registry) {
        // Gauge 绑定到队列大小
        Gauge.builder("business.queue.size", orderQueue, Queue::size)
            .description("待处理订单队列长度")
            .tag("queue", "order")
            .register(registry);

        // Gauge 绑定到自定义值
        Gauge.builder("business.cache.hit.ratio", this,
                m -> m.getCacheHitRatio())
            .description("缓存命中率")
            .register(registry);
    }

    private double getCacheHitRatio() {
        return 0.85;
    }
}
```

### 2.4 DistributionSummary — 订单金额分布

```java
@Component
public class OrderAmountMetrics {

    private final DistributionSummary orderAmountSummary;

    public OrderAmountMetrics(MeterRegistry registry) {
        this.orderAmountSummary = DistributionSummary
            .builder("business.orders.amount")
            .description("订单金额分布")
            .baseUnit("yuan")
            .publishPercentiles(0.5, 0.75, 0.95, 0.99)
            .publishPercentileHistogram()
            .sla(10, 50, 100, 500, 1000)
            .register(registry);
    }

    public void recordAmount(BigDecimal amount) {
        orderAmountSummary.record(amount.doubleValue());
    }
}
```

> **踩坑提醒**：`DistributionSummary` 的 `publishPercentileHistogram()` 会生成大量 bucket 时间序列，高基数标签 + 直方图 = 指标爆炸。只在真正需要 P99 分析的场景开启。

## 3. Prometheus + Grafana 集成

### 3.1 Spring Boot 配置

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus,metrics
  endpoint:
    health:
      show-details: always
  metrics:
    export:
      prometheus:
        enabled: true
    tags:
      app: myapp
      env: ${ENV:dev}
```

```xml
<!-- pom.xml -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
</dependency>
```

### 3.2 Prometheus 配置

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'spring-boot-app'
    metrics_path: '/actuator/prometheus'
    static_configs:
      - targets: ['app:8080']
        labels:
          app: 'myapp'
```

### 3.3 PromQL 常用查询

```promql
# 1. 请求速率（QPS）
rate(http_server_requests_seconds_count{app="myapp"}[5m])

# 2. 请求延迟 P99
histogram_quantile(0.99, rate(http_server_requests_seconds_bucket{app="myapp"}[5m]))

# 3. 错误率
sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m]))
/
sum(rate(http_server_requests_seconds_count[5m]))

# 4. 自定义业务指标 — 订单创建速率
rate(business_orders_created_total[5m])

# 5. 队列积压
business_queue_size{queue="order"}

# 6. JVM 内存使用
jvm_memory_used_bytes{area="heap"} / jvm_memory_max_bytes{area="heap"}

# 7. 数据库连接池活跃连接
hikaricp_connections_active
```

### 3.4 Grafana Dashboard

```json
{
  "dashboard": {
    "title": "Spring Boot 应用监控",
    "panels": [
      {
        "title": "请求 QPS",
        "type": "graph",
        "targets": [
          {
            "expr": "sum(rate(http_server_requests_seconds_count{app=\"myapp\"}[5m])) by (uri)",
            "legendFormat": "{{uri}}"
          }
        ]
      },
      {
        "title": "响应时间 P99",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.99, sum(rate(http_server_requests_seconds_bucket{app=\"myapp\"}[5m])) by (le, uri))",
            "legendFormat": "{{uri}}"
          }
        ]
      },
      {
        "title": "JVM 内存",
        "type": "gauge",
        "targets": [
          {
            "expr": "jvm_memory_used_bytes{area=\"heap\",app=\"myapp\"} / jvm_memory_max_bytes{area=\"heap\",app=\"myapp\"} * 100",
            "legendFormat": "Heap 使用率 %"
          }
        ]
      }
    ]
  }
}
```

> **踩坑提醒**：Prometheus 默认 `scrape_interval` 是 15 秒，对于短时间的突发流量（比如秒杀），15 秒粒度太粗。可以调到 5 秒，但存储成本会线性增长。另外，`rate()` 函数的时间窗口至少要大于 2 个 scrape interval，否则结果不准。
