# 可观测性

> 系统上线后，你如何知道它运行得好不好？用户反馈"接口很慢"，你如何定位是数据库慢、缓存穿透还是某个下游服务超时？凌晨三点收到告警，你如何快速判断影响范围并找到根因？可观测性（Observability）就是解决这些问题的系统化方法论。本章将从日志、指标、链路追踪三大支柱出发，构建完整的可观测体系，并给出线上问题的排查路径。

## 1. 日志体系

### 1.1 日志的定位

日志是可观测性中最古老也最基础的手段。它记录的是**离散事件**——某时某刻发生了什么。日志适合回答：

- 用户 10086 下单失败的具体原因是什么？
- 今天有多少次 NullPointerException？
- 某条 SQL 执行的参数和结果是什么？

### 1.2 Logback 日志配置

Spring Boot 默认使用 Logback 作为日志框架。一个生产级的 `logback-spring.xml` 配置如下：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <property name="LOG_HOME" value="./logs" />
    <property name="APP_NAME" value="order-service" />

    <!-- 控制台输出 -->
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] [%X{tid}] %-5level %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>

    <!-- 文件输出：按天滚动 -->
    <appender name="FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
        <file>${LOG_HOME}/${APP_NAME}.log</file>
        <rollingPolicy class="ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy">
            <fileNamePattern>${LOG_HOME}/${APP_NAME}.%d{yyyy-MM-dd}.%i.log.gz</fileNamePattern>
            <maxFileSize>100MB</maxFileSize>
            <maxHistory>30</maxHistory>
            <totalSizeCap>5GB</totalSizeCap>
        </rollingPolicy>
        <encoder>
            <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] [%X{tid}] %-5level %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>

    <!-- 错误日志单独输出 -->
    <appender name="ERROR_FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
        <file>${LOG_HOME}/${APP_NAME}-error.log</file>
        <filter class="ch.qos.logback.classic.filter.ThresholdFilter">
            <level>ERROR</level>
        </filter>
        <rollingPolicy class="ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy">
            <fileNamePattern>${LOG_HOME}/${APP_NAME}-error.%d{yyyy-MM-dd}.%i.log.gz</fileNamePattern>
            <maxFileSize>100MB</maxFileSize>
            <maxHistory>30</maxHistory>
        </rollingPolicy>
        <encoder>
            <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] [%X{tid}] %-5level %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>

    <!-- JSON 格式输出（供 Filebeat 采集） -->
    <appender name="JSON_FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
        <file>${LOG_HOME}/${APP_NAME}-json.log</file>
        <rollingPolicy class="ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy">
            <fileNamePattern>${LOG_HOME}/${APP_NAME}-json.%d{yyyy-MM-dd}.%i.log.gz</fileNamePattern>
            <maxFileSize>100MB</maxFileSize>
            <maxHistory>15</maxHistory>
        </rollingPolicy>
        <encoder class="net.logstash.logback.encoder.LogstashEncoder">
            <customFields>{"service":"${APP_NAME}"}</customFields>
        </encoder>
    </appender>

    <root level="INFO">
        <appender-ref ref="CONSOLE" />
        <appender-ref ref="FILE" />
        <appender-ref ref="ERROR_FILE" />
        <appender-ref ref="JSON_FILE" />
    </root>
</configuration>
```

### 1.3 ELK 日志采集架构

ELK（Elasticsearch + Logstash + Kibana）是最主流的日志采集方案。在高并发场景下，通常在 Logstash 前加一层 Kafka 做缓冲：

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        应用服务器集群                                 │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Order Service │  │ User Service │  │ Payment Svc  │              │
│  │ (JSON 日志)   │  │ (JSON 日志)   │  │ (JSON 日志)   │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │ Filebeat         │ Filebeat         │ Filebeat             │
└─────────┼─────────────────┼─────────────────┼───────────────────────┘
          ▼                 ▼                 ▼
   ┌─────────────────────────────────────────────┐
   │                  Kafka                        │
   │         (缓冲，削峰填谷)                       │
   └──────────────────────┬──────────────────────┘
                          ▼
                   ┌────────────┐
                   │  Logstash   │
                   │ (过滤/转换)  │
                   └─────┬──────┘
                         ▼
                ┌─────────────────┐
                │ Elasticsearch    │
                │ (存储/索引/搜索)  │
                └────────┬────────┘
                         ▼
                   ┌────────────┐
                   │   Kibana    │
                   │ (可视化/查询) │
                   └────────────┘
```

### 1.4 Filebeat 配置

```yaml
# filebeat.yml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/app/*-json.log
    json.keys_under_root: true
    json.overwrite_keys: true
    fields:
      env: production
    fields_under_root: true

output.kafka:
  hosts: ["kafka1:9092", "kafka2:9092", "kafka3:9092"]
  topic: "app-logs"
  partition.round_robin:
    reachable_only: true

# 或直接输出到 Elasticsearch（小规模场景）
# output.elasticsearch:
#   hosts: ["es1:9200", "es2:9200"]
#   index: "app-logs-%{+yyyy.MM.dd}"
```

### 1.5 TraceID 关联日志

日志最大的问题是**上下文割裂**——一个请求跨越多个服务，每个服务的日志独立存储，无法关联。解决方案是将链路追踪的 TraceID 注入日志。

SkyWalking Agent 会自动将 `tid`（TraceID）注入 MDC。如果使用 OpenTelemetry，可以手动注入：

```java
@Component
public class TraceIdLogFilter extends Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
            FilterChain chain) throws IOException, ServletException {
        Span currentSpan = Span.current();
        if (currentSpan.getSpanContext().isValid()) {
            MDC.put("traceId", currentSpan.getSpanContext().getTraceId());
            MDC.put("spanId", currentSpan.getSpanContext().getSpanId());
        }
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove("traceId");
            MDC.remove("spanId");
        }
    }
}
```

有了 TraceID，日志就从"离散事件"变成了"有上下文的事件链"。在 Kibana 中搜索 `traceId:abc-123-def`，就能看到这个请求在所有服务中的完整日志。

## 2. 指标监控

### 2.1 指标的本质

如果说日志是"发生了什么"，那么指标就是"整体状况如何"。指标是**数值型的时间序列数据**，适合回答：

- 当前系统的 QPS 是多少？
- P99 响应时间是否超过 500ms？
- 错误率是多少？
- JVM 堆内存使用趋势如何？

### 2.2 Micrometer 指标采集

Micrometer 是 Spring Boot 的指标采集标准（类似日志领域的 SLF4J），它提供统一的 API，底层可以对接多种监控系统。

```java
@Component
public class OrderMetrics {

    private final MeterRegistry registry;
    private final Counter orderCounter;
    private final Timer orderTimer;
    private final Gauge activeOrders;

    public OrderMetrics(MeterRegistry registry) {
        this.registry = registry;

        // 计数器：订单总数
        this.orderCounter = Counter.builder("order.created.total")
            .description("Total number of orders created")
            .tag("service", "order-service")
            .register(registry);

        // 计时器：下单耗时
        this.orderTimer = Timer.builder("order.create.duration")
            .description("Order creation duration")
            .publishPercentiles(0.5, 0.95, 0.99)  // 输出 P50/P95/P99
            .register(registry);

        // 仪表：当前活跃订单数
        this.activeOrders = Gauge.builder("order.active.count",
                this, m -> getActiveOrderCount())
            .description("Current active order count")
            .register(registry);
    }

    public void recordOrderCreated() {
        orderCounter.increment();
    }

    public <T> T recordOrderDuration(Supplier<T> supplier) {
        return orderTimer.record(supplier);
    }
}
```

### 2.3 Prometheus + Grafana 监控体系

```text
┌──────────────────────────────────────────────────────┐
│                    应用集群                            │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │ Order Service │  │ User Service │  ...            │
│  │ /actuator/    │  │ /actuator/    │                │
│  │  prometheus   │  │  prometheus   │                │
│  └──────┬───────┘  └──────┬───────┘                 │
└─────────┼─────────────────┼──────────────────────────┘
          │ Pull (拉模式)    │
          ▼                 ▼
   ┌─────────────────────────────────┐
   │          Prometheus              │
   │  - 定时拉取各实例的 /metrics     │
   │  - 存储时间序列数据              │
   │  - 支持 PromQL 查询             │
   │  - 告警规则评估                  │
   └──────────┬──────────────────────┘
              │
     ┌────────┴────────┐
     ▼                 ▼
┌──────────┐    ┌──────────────┐
│ Grafana  │    │ Alertmanager │
│ (仪表盘)  │    │ (告警通知)    │
└──────────┘    └──────────────┘
```

Spring Boot 集成 Prometheus：

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
  metrics:
    tags:
      application: ${spring.application.name}
    distribution:
      percentiles-histogram:
        http.server.requests: true
```

Prometheus 配置抓取目标：

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'spring-boot-apps'
    metrics_path: '/actuator/prometheus'
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
```

### 2.4 核心监控指标

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
| **自定义** | `order_create_duration_seconds` | 业务操作耗时 | P99 > 500ms |

## 3. 链路追踪

### 3.1 三大支柱的关系

可观测性三大支柱不是孤立的，它们通过**关联标识**（TraceID、时间戳）串联起来：

```text
                        可观测性
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
         日志            指标           链路追踪
     (Logs)          (Metrics)       (Traces)
            │              │              │
            │   ┌──────────┘              │
            │   │                         │
            ▼   ▼                         ▼
     "5xx错误了"  "错误率1.2%"    "AccountService超时5s"
     "参数异常"   "P99=800ms"    "PaymentService重试3次"
            │              │              │
            └──────────────┼──────────────┘
                           │
                    通过 TraceID 关联
                           │
                           ▼
                  完整的问题定位图景
```

典型排查流程：

1. **Grafana 告警**：`order-service 的 5xx 错误率超过 1%`
2. **Grafana 面板**：发现 P99 从 200ms 飙升到 2s
3. **Jaeger/SkyWalking**：用 TraceID 找到慢请求的调用链，发现 `AccountService` 的数据库查询耗时 1.5s
4. **Kibana 日志**：用同一个 TraceID 搜索，发现 `AccountService` 报了 `Connection pool exhausted`
5. **根因定位**：数据库连接池耗尽，需要扩容连接池或优化慢 SQL

### 3.2 OpenTelemetry 架构

OpenTelemetry（OTel）是 CNCF 的可观测性标准，统一了指标、日志、追踪的数据格式和采集方式：

```text
┌──────────────────────────────────────────────────────────┐
│                     应用层                                 │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │            OpenTelemetry Java Agent                  │ │
│  │   (自动埋点：HTTP、gRPC、JDBC、Redis、MQ...)         │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                         │ OTLP (gRPC/HTTP)               │
└─────────────────────────┼────────────────────────────────┘
                          ▼
              ┌───────────────────────┐
              │  OTel Collector        │
              │  (接收、处理、导出)      │
              └───────────┬───────────┘
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
     ┌────────────┐ ┌──────────┐ ┌──────────────┐
     │   Jaeger    │ │Prometheus│ │ Elasticsearch│
     │  (追踪)     │ │ (指标)   │ │   (日志)     │
     └────────────┘ └──────────┘ └──────────────┘
```

### 3.3 OTel Java Agent 使用

OpenTelemetry Java Agent 与 SkyWalking 类似，也是无侵入的字节码注入方式：

```bash
java -javaagent:/path/opentelemetry-javaagent.jar \
     -Dotel.service.name=order-service \
     -Dotel.exporter.otlp.endpoint=http://otel-collector:4317 \
     -Dotel.traces.sampler=parentbased_traceidratio \
     -Dotel.traces.sampler.arg=0.1 \
     -jar order-service.jar
```

**采样策略说明**：

| 策略 | 含义 | 适用场景 |
|------|------|---------|
| `always_on` | 100% 采样 | 开发/测试环境 |
| `always_off` | 不采样 | 关闭追踪 |
| `traceidratio` | 按比例采样（如 10%） | 生产环境，平衡开销和可观测性 |
| `parentbased_traceidratio` | 父 Span 已采样则子 Span 也采样 | 生产推荐，保证链路完整 |

### 3.4 OTel Collector 配置

```yaml
# otel-collector-config.yml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 1000

  # 尾部采样：对错误请求 100% 采样，正常请求 10%
  tail_sampling:
    decision_wait: 10s
    policies:
      - name: error-policy
        type: status_code
        status_code:
          status_codes: [ERROR]
      - name: probabilistic-policy
        type: probabilistic
        probabilistic:
          sampling_percentage: 10

exporters:
  jaeger:
    endpoint: jaeger-collector:14250
    tls:
      insecure: true

  prometheus:
    endpoint: "0.0.0.0:8889"

  elasticsearch:
    endpoints: ["http://es-node1:9200", "http://es-node2:9200"]
    logs_index: otel-logs

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, tail_sampling]
      exporters: [jaeger]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [elasticsearch]
```

### 3.5 SkyWalking vs Jaeger 对比

| 维度 | SkyWalking | Jaeger |
|------|-----------|--------|
| **出身** | Apache 顶级项目，国内社区活跃 | Uber 开源，CNCF 毕业项目 |
| **埋点方式** | Java Agent 无侵入 | OTel Agent 或手动埋点 |
| **存储** | ES、MySQL、BanyanDB、TiDB | ES、Cassandra、Kafka |
| **UI 功能** | 拓扑图、Trace、告警、指标、日志 | Trace 查看、对比、依赖图 |
| **指标能力** | 内置服务/端点/实例级指标 | 需配合 Prometheus |
| **扩展性** | 中等（自定义存储需开发插件） | 高（OTel 标准，生态丰富） |
| **国内生态** | 国内公司广泛使用，中文文档完善 | 国际化社区，文档以英文为主 |
| **推荐场景** | 国内团队、快速上手、一体化方案 | 国际团队、已有 OTel 基础设施 |

> 日志、指标、链路追踪三大支柱的具体落地（ELK、Prometheus、OpenTelemetry）见本文；跨服务的**线上问题定位方法论**（三板斧排查流程、Arthas 常用命令）已收敛到 [软件工程 · 可观测性](../../engineering/06-engineering-practices/chapter-06-observability.md)。

