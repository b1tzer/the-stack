# Actuator 监控端点

> 应用跑起来了，但你不知道它内部状态如何——Actuator 给你一个「透视镜」。它通过 HTTP 端点暴露应用的健康状态、指标、环境配置等信息，是生产监控的基础设施。日志、链路追踪等更深层的可观测能力，见独立章节。

## 1. Actuator 端点概览

```xml
<!-- 引入 Actuator -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

**核心端点一览：**

| 端点 | 路径 | 功能 | 默认暴露 |
|------|------|------|:-------:|
| 健康检查 | `/actuator/health` | 应用健康状态 | ✅ |
| 应用信息 | `/actuator/info` | 应用名称、版本 | ✅ |
| 指标 | `/actuator/metrics` | JVM、HTTP、自定义指标 | ❌ |
| 环境变量 | `/actuator/env` | 所有配置属性 | ❌ |
| Bean 列表 | `/actuator/beans` | 所有 Bean 信息 | ❌ |
| 条件评估 | `/actuator/conditions` | 自动配置生效/未生效原因 | ❌ |
| 配置属性 | `/actuator/configprops` | @ConfigurationProperties 绑定 | ❌ |
| 线程转储 | `/actuator/threaddump` | JVM 线程状态 | ❌ |
| 堆转储 | `/actuator/heapdump` | JVM 堆内存快照 | ❌ |
| Prometheus | `/actuator/prometheus` | Prometheus 格式指标 | ❌ |

```yaml
# 暴露端点配置
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus,metrics
  endpoint:
    health:
      show-details: always  # 显示健康检查详情
```

::: warning 生产安全
生产环境不要暴露 `env` 和 `configprops` 端点——它们会泄露数据库密码、API Key 等敏感信息。只暴露 `health`、`info`、`metrics`。
:::

## 2. 健康检查与自定义 Indicator

`/actuator/health` 返回 `UP` 不代表你的业务真的健康——数据库连接池满了但 health 依然是 UP，因为你没有自定义检查。

### 2.1 内置健康指示器

Spring Boot 自动配置了多个健康指示器：

| 指示器 | 检查内容 | 条件 |
|--------|---------|------|
| `DataSourceHealthIndicator` | 数据库连接 | 有 DataSource Bean |
| `RedisHealthIndicator` | Redis 连接 | 有 RedisConnectionFactory |
| `DiskSpaceHealthIndicator` | 磁盘空间 | 默认启用 |
| `PingHealthIndicator` | 应用存活 | 默认启用 |

### 2.2 自定义健康检查

```java
@Component
public class DatabaseHealthIndicator implements HealthIndicator {

    @Autowired
    private DataSource dataSource;

    @Override
    public Health health() {
        try (Connection conn = dataSource.getConnection()) {
            if (conn.isValid(3)) {
                return Health.up()
                    .withDetail("database", "MySQL")
                    .withDetail("connection_pool", getPoolStats())
                    .build();
            }
        } catch (SQLException e) {
            return Health.down()
                .withDetail("error", e.getMessage())
                .build();
        }
        return Health.down().build();
    }

    private Map<String, Object> getPoolStats() {
        return Map.of(
            "active", 5,
            "idle", 15,
            "total", 20
        );
    }
}
```

### 2.3 健康状态聚合

```json
// /actuator/health 响应示例
{
  "status": "UP",
  "components": {
    "db": {
      "status": "UP",
      "details": {
        "database": "MySQL",
        "connection_pool": {
          "active": 5,
          "idle": 15
        }
      }
    },
    "diskSpace": {
      "status": "UP",
      "details": {
        "free": "10GB",
        "threshold": "10MB"
      }
    },
    "customCheck": {
      "status": "DOWN"
    }
  }
}
```

::: warning 性能注意
`HealthIndicator` 的 `health()` 方法会在每次请求 `/actuator/health` 时调用。如果检查逻辑很重（如远程调用），考虑用 `@Scheduled` 缓存结果，避免每次请求都等待。
:::

## 3. Micrometer 指标集成

不知道接口 QPS、不知道慢请求、不知道 JVM 内存——没有指标就是盲飞。

### 3.1 引入 Prometheus 端点

```xml
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
</dependency>
```

```yaml
management:
  endpoints:
    web:
      exposure:
        include: prometheus,health,metrics
  metrics:
    tags:
      application: ${spring.application.name}
```

### 3.2 自定义指标

```java
@Component
public class OrderMetrics {

    private final Counter orderCounter;
    private final Timer orderTimer;
    private final AtomicInteger pendingOrders;

    public OrderMetrics(MeterRegistry registry) {
        // 计数器：统计订单总数
        this.orderCounter = Counter.builder("orders.created")
            .description("创建的订单总数")
            .tag("type", "online")
            .register(registry);

        // 计时器：统计处理耗时
        this.orderTimer = Timer.builder("orders.processing.time")
            .description("订单处理耗时")
            .publishPercentiles(0.5, 0.95, 0.99) // P50、P95、P99
            .register(registry);

        // 仪表盘：当前待处理订单数
        this.pendingOrders = registry.gauge("orders.pending",
            new AtomicInteger(0));
    }

    public void recordOrder() {
        orderCounter.increment();
    }

    public void recordProcessingTime(long durationMs) {
        orderTimer.record(durationMs, TimeUnit.MILLISECONDS);
    }
}
```

### 3.3 三大指标类型

| 类型 | 用途 | 示例 |
|------|------|------|
| Counter | 只增不减的计数器 | 请求总数、错误总数 |
| Timer | 耗时统计 | 接口响应时间 |
| Gauge | 可增可减的瞬时值 | 内存使用、队列长度 |

### 3.4 Prometheus + Grafana

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'my-app'
    metrics_path: '/actuator/prometheus'
    static_configs:
      - targets: ['localhost:8080']
```

::: warning Timer 单位
`Timer.record()` 的参数单位默认是纳秒（nanoseconds），如果你传的是毫秒，需要用 `record(durationMs, TimeUnit.MILLISECONDS)`。否则你的 P99 会显示为纳秒级别的「极快」响应。
:::

## 4. 核心监控指标

| 类别 | 指标 | 含义 | 告警阈值建议 |
|------|------|------|-------------|
| **HTTP** | `http_server_requests_seconds` | 请求响应时间 | P99 > 1s |
| **HTTP** | `http_server_requests_seconds_count` | 请求 QPS | 突增 200% |
| **HTTP** | `http_server_requests_seconds{status=~"5.."}` | 5xx 错误率 | > 1% |
| **JVM** | `jvm_memory_used_bytes` | 堆内存使用 | > 80% of max |
| **JVM** | `jvm_gc_pause_seconds` | GC 暂停时间 | P99 > 200ms |
| **JVM** | `jvm_threads_live_threads` | 活跃线程数 | > 80% of max |
| **DB** | `hikaricp_connections_active` | 活跃连接数 | > 80% of max |
| **DB** | `hikaricp_connections_timeout_total` | 连接超时次数 | > 0 |
