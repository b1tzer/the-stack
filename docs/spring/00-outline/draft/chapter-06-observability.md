# 第 06 章：可观测性

> **一句话总结**：系统出了问题，你能在 5 分钟内定位根因吗？日志、指标、追踪是可观测性的三大支柱，缺了任何一个你都只能靠猜。

---

## 6.1 日志体系

### 6.1.1 SLF4J + Logback 配置

**痛点**：`System.out.println` 散落在代码里，没有级别、没有时间戳、没有线程信息，生产环境出问题根本没法排查。

**SLF4J 门面模式**：

```
你的代码
  │
  ▼
SLF4J（门面/接口）
  │
  ├──► Logback（实现，推荐）
  ├──► Log4j2（实现）
  └──► JUL（实现，不推荐）
```

SLF4J 是日志门面，只定义接口；Logback 是实现。你永远只依赖 SLF4J 的 API，底层实现可以随时切换。

```java
@Slf4j  // Lombok 注解，自动生成 private static final Logger log
@Service
public class OrderService {

    public Order createOrder(OrderRequest request) {
        log.info("创建订单, userId={}, amount={}",
            request.getUserId(), request.getAmount());

        try {
            Order order = doCreateOrder(request);
            log.info("订单创建成功, orderId={}", order.getId());
            return order;
        } catch (Exception e) {
            log.error("订单创建失败, userId={}", request.getUserId(), e);
            throw e;
        }
    }
}
```

**logback-spring.xml 完整配置**：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <!-- 引入 Spring 默认配置 -->
    <include resource="org/springframework/boot/logging/logback/defaults.xml"/>

    <!-- 变量定义 -->
    <property name="LOG_PATH" value="logs"/>
    <property name="APP_NAME" value="myapp"/>

    <!-- 控制台输出 -->
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] [%X{traceId:-}] %-5level %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>

    <!-- 文件输出 — 按日期滚动 -->
    <appender name="FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
        <file>${LOG_PATH}/${APP_NAME}.log</file>
        <rollingPolicy class="ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy">
            <fileNamePattern>${LOG_PATH}/${APP_NAME}.%d{yyyy-MM-dd}.%i.log.gz</fileNamePattern>
            <maxFileSize>100MB</maxFileSize>
            <maxHistory>30</maxHistory>
            <totalSizeCap>3GB</totalSizeCap>
        </rollingPolicy>
        <encoder>
            <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] [%X{traceId:-}] %-5level %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>

    <!-- ERROR 单独输出 -->
    <appender name="ERROR_FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
        <file>${LOG_PATH}/${APP_NAME}-error.log</file>
        <filter class="ch.qos.logback.classic.filter.ThresholdFilter">
            <level>ERROR</level>
        </filter>
        <rollingPolicy class="ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy">
            <fileNamePattern>${LOG_PATH}/${APP_NAME}-error.%d{yyyy-MM-dd}.%i.log.gz</fileNamePattern>
            <maxFileSize>50MB</maxFileSize>
            <maxHistory>60</maxHistory>
        </rollingPolicy>
        <encoder>
            <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] [%X{traceId:-}] %-5level %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>

    <!-- 异步 Appender — 防止日志 I/O 阻塞业务线程 -->
    <appender name="ASYNC_FILE" class="ch.qos.logback.classic.AsyncAppender">
        <queueSize>512</queueSize>
        <discardingThreshold>0</discardingThreshold>  <!-- 队列满时不丢弃 -->
        <neverBlock>true</neverBlock>                   <!-- 队列满时不阻塞 -->
        <appender-ref ref="FILE"/>
    </appender>

    <!-- 不同包的日志级别 -->
    <logger name="com.myapp" level="DEBUG"/>
    <logger name="org.springframework.security" level="WARN"/>
    <logger name="org.hibernate.SQL" level="DEBUG"/>  <!-- SQL 调试 -->

    <root level="INFO">
        <appender-ref ref="CONSOLE"/>
        <appender-ref ref="ASYNC_FILE"/>
        <appender-ref ref="ERROR_FILE"/>
    </root>
</configuration>
```

**日志级别使用规范**：

| 级别 | 用途 | 示例 |
|------|------|------|
| `ERROR` | 系统错误，需要立即关注 | 异常堆栈、服务不可用 |
| `WARN` | 潜在问题，暂不影响业务 | 重试、降级、配置缺失 |
| `INFO` | 关键业务流程 | 订单创建、用户登录、支付完成 |
| `DEBUG` | 开发调试信息 | 方法参数、SQL 语句、缓存命中 |
| `TRACE` | 最详细的跟踪信息 | 循环内变量、详细数据流 |

> **踩坑提醒**：生产环境把 Hibernate SQL 日志开成 `DEBUG` 级别会严重影响性能——每条 SQL 都要格式化输出。调试完记得关掉。另外，`AsyncAppender` 的 `queueSize` 设太小，高并发时日志会丢失；设太大，OOM 风险增加。512-1024 是比较平衡的值。

---

### 6.1.2 结构化日志（JSON 格式）

**痛点**：非结构化日志在 ELK 中解析困难——一个异常堆栈跨了 20 行，Logstash 怎么把它拼成一条日志？

**JSON 格式日志让机器更容易解析**：

```xml
<!-- pom.xml -->
<dependency>
    <groupId>net.logstash.logback</groupId>
    <artifactId>logstash-logback-encoder</artifactId>
    <version>7.4</version>
</dependency>
```

```xml
<!-- logback-spring.xml 中替换 encoder -->
<appender name="JSON_FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
    <file>${LOG_PATH}/${APP_NAME}-json.log</file>
    <rollingPolicy class="ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy">
        <fileNamePattern>${LOG_PATH}/${APP_NAME}-json.%d{yyyy-MM-dd}.%i.log.gz</fileNamePattern>
        <maxFileSize>100MB</maxFileSize>
        <maxHistory>30</maxHistory>
    </rollingPolicy>
    <encoder class="net.logstash.logback.encoder.LogstashEncoder">
        <!-- 自定义字段 -->
        <customFields>{"app":"myapp","env":"${ENV:-dev}"}</customFields>
        <!-- 时间格式 -->
        <timestampPattern>yyyy-MM-dd'T'HH:mm:ss.SSS'Z'</timestampPattern>
        <!-- 包含 MDC 字段 -->
        <includeMdcKeyName>traceId</includeMdcKeyName>
        <includeMdcKeyName>userId</includeMdcKeyName>
        <includeMdcKeyName>requestId</includeMdcKeyName>
        <!-- 异常堆栈长度限制 -->
        <throwableConverter class="net.logstash.logback.stacktrace.ShortenedThrowableConverter">
            <maxDepthPerThrowable>30</maxDepthPerThrowable>
            <maxLength>2048</maxLength>
            <shortenedClassNameLength>20</shortenedClassNameLength>
        </throwableConverter>
    </encoder>
</appender>
```

**输出示例**：

```json
{
  "@timestamp": "2024-01-15T10:30:45.123Z",
  "level": "INFO",
  "logger_name": "com.myapp.service.OrderService",
  "thread_name": "http-nio-8080-exec-1",
  "message": "订单创建成功",
  "app": "myapp",
  "env": "prod",
  "traceId": "abc123def456",
  "userId": "user-1001",
  "orderId": "ORD-20240115-001",
  "amount": 299.00
}
```

**ELK 配置要点**：

| 组件 | 作用 | 关键配置 |
|------|------|----------|
| Filebeat | 日志采集 | `json.keys_under_root: true` |
| Logstash | 日志处理 | `json` filter 解析 JSON 行 |
| Elasticsearch | 日志存储 | 索引按日期分区 `myapp-2024.01.15` |
| Kibana | 日志查询 | 按 `traceId` 关联链路 |

```ruby
# Logstash pipeline 配置
input {
  beats {
    port => 5044
  }
}

filter {
  json {
    source => "message"
    target => "log"
  }
  # 提取时间戳
  date {
    match => ["[@timestamp]", "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"]
  }
}

output {
  elasticsearch {
    hosts => ["http://es:9200"]
    index => "myapp-%{+YYYY.MM.dd}"
  }
}
```

> **踩坑提醒**：JSON 日志会比纯文本大 2-3 倍，磁盘消耗增加明显。建议：① 只在生产环境用 JSON 格式，开发环境用可读的文本格式；② 用 Spring Profile 区分：`logback-spring.xml` 中 `<springProfile name="prod">` 标签内放 JSON encoder。

---

### 6.1.3 MDC 与日志上下文

**痛点**：一个请求经过 5 个服务、20 个方法调用，日志散落在不同地方——你怎么把它们串起来？

**MDC（Mapped Diagnostic Context）基于 ThreadLocal**：

```
请求进入
  │
  ├─ Filter 设置 MDC: traceId=abc123, userId=user1
  │
  ├─ Service A 日志: [abc123] 开始处理
  ├─ Service B 日志: [abc123] 调用下游
  ├─ DAO 日志:       [abc123] 执行 SQL
  │
  ├─ Filter 清除 MDC
  │
  └─ 响应返回
```

**MDC Filter 实现**：

```java
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class MdcFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                     HttpServletResponse response,
                                     FilterChain filterChain)
            throws ServletException, IOException {
        try {
            // 从请求头获取或生成 traceId
            String traceId = request.getHeader("X-Trace-Id");
            if (!StringUtils.hasText(traceId)) {
                traceId = UUID.randomUUID().toString().replace("-", "");
            }

            MDC.put("traceId", traceId);
            MDC.put("requestId", UUID.randomUUID().toString().replace("-", ""));
            MDC.put("clientIp", getClientIp(request));
            MDC.put("requestUri", request.getRequestURI());

            // 响应头中也带上 traceId，方便前端排查
            response.setHeader("X-Trace-Id", traceId);

            filterChain.doFilter(request, response);
        } finally {
            MDC.clear();  // 必须清除，否则线程复用时会泄漏
        }
    }

    private String getClientIp(HttpServletRequest request) {
        String ip = request.getHeader("X-Forwarded-For");
        if (StringUtils.hasText(ip)) {
            return ip.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
```

**异步场景 MDC 丢失问题**：

```java
// ❌ 错误：子线程拿不到 MDC
@Async
public void processAsync(Long orderId) {
    // 这里的 MDC.get("traceId") 为 null！
    log.info("异步处理订单 {}", orderId);
}

// ✅ 正确：手动传播 MDC
@Async
public void processAsync(Long orderId) {
    // MDC 不会自动跨线程传播，需要在提交任务时捕获
    // 方案 1：使用 TaskDecorator
    log.info("异步处理订单 {}", orderId);
}

// ✅ 推荐：TaskDecorator 方案
@Configuration
public class AsyncConfig implements AsyncConfigurer {

    @Override
    public Executor getAsyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(5);
        executor.setMaxPoolSize(10);
        executor.setQueueCapacity(100);
        executor.setTaskDecorator(new MdcTaskDecorator());
        executor.setThreadNamePrefix("async-");
        executor.initialize();
        return executor;
    }
}

public class MdcTaskDecorator implements TaskDecorator {
    @Override
    public Runnable decorate(Runnable runnable) {
        // 在主线程中捕获 MDC
        Map<String, String> contextMap = MDC.getCopyOfContextMap();
        return () -> {
            try {
                // 在子线程中恢复 MDC
                if (contextMap != null) {
                    MDC.setContextMap(contextMap);
                }
                runnable.run();
            } finally {
                MDC.clear();
            }
        };
    }
}
```

**MDC 在 logback-spring.xml 中的使用**：

```xml
<!-- 在 pattern 中引用 MDC 变量 -->
<pattern>%d{HH:mm:ss.SSS} [%thread] [traceId=%X{traceId:-N/A}] [%X{userId:-anonymous}] %-5level %logger{36} - %msg%n</pattern>

<!-- JSON 格式中引用 -->
<encoder class="net.logstash.logback.encoder.LogstashEncoder">
    <includeMdcKeyName>traceId</includeMdcKeyName>
    <includeMdcKeyName>userId</includeMdcKeyName>
    <includeMdcKeyName>clientIp</includeMdcKeyName>
</encoder>
```

> **踩坑提醒**：MDC 基于 `ThreadLocal`，线程池复用线程时如果忘了 `MDC.clear()`，上一个请求的 traceId 会"污染"下一个请求。所以 `finally { MDC.clear(); }` 是必须的。另外，`CompletableFuture.supplyAsync()` 默认用 `ForkJoinPool`，不支持 TaskDecorator，你需要手动传 Executor。

---

## 6.2 指标监控

### 6.2.1 Micrometer 核心概念

**痛点**：你引入了 Prometheus，但不知道该监控什么、怎么监控——Micrometer 就是 Java 世界的指标标准 API。

**Micrometer = 指标领域的 SLF4J**：

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

**Meter 类型**：

| 类型 | 用途 | 示例 |
|------|------|------|
| `Counter` | 单调递增计数 | 请求总数、订单数 |
| `Gauge` | 可增可减的瞬时值 | 队列长度、内存使用 |
| `Timer` | 耗时统计 | 接口响应时间 |
| `DistributionSummary` | 值分布统计 | 订单金额分布 |
| `LongTaskTimer` | 长时间任务 | 批处理任务耗时 |

```java
// Micrometer 基本使用
@Component
@RequiredArgsConstructor
public class OrderMetrics {

    private final MeterRegistry registry;

    // 方式 1：直接使用 Counter
    public void recordOrderCreated(String channel) {
        Counter.builder("orders.created")
            .description("订单创建总数")
            .tag("channel", channel)   // 维度标签
            .register(registry)
            .increment();
    }

    // 方式 2：Timer 统计耗时
    public <T> T recordPaymentDuration(Callable<T> callable) throws Exception {
        return Timer.builder("payment.duration")
            .description("支付处理耗时")
            .tag("method", "alipay")
            .register(registry)
            .recordCallable(callable);
    }
}
```

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

---

### 6.2.2 自定义业务指标

**痛点**：Spring Boot 自带的 `http.server.requests` 指标只能看接口层面，你还需要业务层面的指标——订单数、支付耗时、队列积压。

**Counter — 订单数统计**：

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

**Timer — 支付耗时**：

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

**Gauge — 队列积压**：

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
        // 计算缓存命中率
        return 0.85;
    }
}
```

**DistributionSummary — 订单金额分布**：

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
            .sla(10, 50, 100, 500, 1000)  // 分桶：10元、50元、100元...
            .register(registry);
    }

    public void recordAmount(BigDecimal amount) {
        orderAmountSummary.record(amount.doubleValue());
    }
}
```

**使用 @Timed 注解自动统计**：

```java
@Configuration
public class MetricsConfig {
    // 启用 @Timed 注解支持
    @Bean
    public TimedAspect timedAspect(MeterRegistry registry) {
        return new TimedAspect(registry);
    }
}
```

> **踩坑提醒**：`DistributionSummary` 的 `publishPercentileHistogram()` 会生成大量 bucket 时间序列（每个 bucket 一个 Prometheus 指标），高基数标签 + 直方图 = 指标爆炸。只在真正需要 P99 分析的场景开启。

---

### 6.2.3 Prometheus + Grafana 集成

**痛点**：有了指标不知道怎么采集、怎么展示、怎么告警——Prometheus + Grafana 是最成熟的开源方案。

**架构**：

```
Spring Boot 应用
  │ /actuator/prometheus
  ▼
Prometheus（拉取指标）
  │
  ├──► Grafana（可视化 Dashboard）
  └──► AlertManager（告警通知）
```

**Spring Boot 配置**：

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

**Prometheus 配置**：

```yaml
# prometheus.yml
global:
  scrape_interval: 15s       # 每 15 秒采集一次
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'spring-boot-app'
    metrics_path: '/actuator/prometheus'
    static_configs:
      - targets: ['app:8080']
        labels:
          app: 'myapp'
    # 生产环境用服务发现
    # consul_sd_configs:
    #   - server: 'consul:8500'
    #     services: ['myapp']
```

**PromQL 常用查询**：

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

**Grafana Dashboard JSON 示例（简化版）**：

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

---

## 6.3 链路追踪

### 6.3.1 分布式追踪原理

**痛点**：一个请求经过 A → B → C 三个服务，A 报 500，你不知道是 B 还是 C 出了问题。分布式追踪帮你画出完整的调用链路。

**核心概念**：

| 概念 | 说明 | 类比 |
|------|------|------|
| `Trace` | 一次完整的请求链路 | 一条快递单号 |
| `Span` | 链路中的一个操作单元 | 快递的一个中转站 |
| `TraceId` | 全局唯一追踪 ID | 快递单号 |
| `SpanId` | 当前操作 ID | 中转站编号 |
| `ParentSpanId` | 父操作 ID | 上一个中转站 |
| `Context Propagation` | 跨服务传递追踪上下文 | 快递单跟着包裹走 |

**Span 树结构**：

```
Trace: abc123
│
├── Span A: API Gateway (0-500ms)
│   │
│   ├── Span B: User Service (10-200ms)
│   │   │
│   │   └── Span D: MySQL Query (20-100ms)
│   │
│   └── Span C: Order Service (200-400ms)
│       │
│       ├── Span E: Redis Cache (210-220ms)
│       │
│       └── Span F: Payment Service (250-380ms)
│           │
│           └── Span G: Alipay API (260-370ms)
```

**Context Propagation 跨服务传递**：

```
Service A                          Service B
    │                                  │
    │── HTTP Header ──────────────────►│
    │   X-B3-TraceId: abc123          │
    │   X-B3-SpanId: span-a           │
    │   X-B3-ParentSpanId: -          │
    │                                  │
    │                                  │ 创建 Span B
    │                                  │ parent = span-a
    │                                  │ traceId = abc123
```

> **踩坑提醒**：如果中间某个服务（比如老旧的内部 SDK）没有正确传递追踪头（`X-B3-*` 或 `traceparent`），链路就会断开——你在追踪系统里只能看到两段孤立的链路，无法关联。确保所有 HTTP 客户端（RestTemplate、Feign、WebClient）都配置了追踪传播。

---

### 6.3.2 Micrometer Tracing + Zipkin

**痛点**：Spring Cloud Sleuth 已经停止维护（Spring Boot 3.x 不再支持），新的标准是 Micrometer Tracing。

**依赖配置**：

```xml
<!-- pom.xml — Spring Boot 3.x -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
<!-- Micrometer Tracing 桥接 Brave（Zipkin 的追踪库） -->
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-tracing-bridge-brave</artifactId>
</dependency>
<!-- Brave 上报到 Zipkin -->
<dependency>
    <groupId>io.zipkin.reporter2</groupId>
    <artifactId>zipkin-reporter-brave</artifactId>
</dependency>
```

```yaml
# application.yml
management:
  tracing:
    sampling:
      probability: 1.0    # 采样率：1.0 = 100%，生产建议 0.1
  zipkin:
    tracing:
      endpoint: http://zipkin:9411/api/v2/spans
  endpoints:
    web:
      exposure:
        include: health,prometheus

# 日志中自动注入 traceId 和 spanId
logging:
  pattern:
    level: "%5p [${spring.application.name},%X{traceId:-},%X{spanId:-}]"
```

**采样率策略**：

| 策略 | 配置 | 适用场景 |
|------|------|----------|
| 全量采集 | `probability: 1.0` | 开发/测试环境 |
| 概率采样 | `probability: 0.1` | 生产环境（10% 采样） |
| 限流采样 | 自定义 `Sampler` | 高并发场景 |
| 尾部采样 | 外部 Collector | 只保留慢请求/错误请求 |

**自定义采样器**：

```java
@Configuration
public class TracingConfig {

    @Bean
    public Sampler customSampler() {
        // 自定义采样策略：错误请求全量采集，正常请求 10% 采样
        return new Sampler() {
            @Override
            public boolean isSampled(long traceId) {
                // 检查当前请求是否有异常
                ServletRequestAttributes attrs = (ServletRequestAttributes)
                    RequestContextHolder.getRequestAttributes();
                if (attrs != null) {
                    Integer status = (Integer) attrs.getAttribute(
                        "javax.servlet.error.status_code",
                        RequestAttributes.SCOPE_REQUEST);
                    if (status != null && status >= 500) {
                        return true;  // 错误全量采集
                    }
                }
                return Math.random() < 0.1;  // 正常请求 10% 采样
            }
        };
    }
}
```

**RestTemplate / WebClient 自动注入追踪头**：

```java
@Configuration
public class RestTemplateConfig {

    @Bean
    public RestTemplate restTemplate(RestTemplateBuilder builder) {
        // Spring Boot 自动为 RestTemplate 注入追踪拦截器
        return builder.build();
    }

    @Bean
    public WebClient webClient(WebClient.Builder builder) {
        // 同样自动注入追踪头
        return builder.baseUrl("http://order-service").build();
    }
}
```

> **踩坑提醒**：生产环境 `probability: 1.0` 会导致追踪数据量巨大，Zipkin 存储很快撑满。建议从 `0.1` 开始，根据流量调整。另外，Spring Cloud Gateway / Spring MVC 默认会自动传播追踪上下文，但如果你用了自定义的 `HttpClient` 或 `OkHttp`，需要手动配置 `TracingHttpClientInterceptor`。

---

### 6.3.3 日志-指标-追踪三者关联

**痛点**：告警说 P99 超过 2 秒（指标），你打开链路追踪看到某个 Span 很慢（追踪），然后想看这个请求的详细日志（日志）——三个系统之间怎么串起来？

**traceId 是串联三大支柱的钥匙**：

```
指标（Prometheus）
  │ P99 > 2s @ 10:30
  ▼
追踪（Zipkin）
  │ traceId=abc123, Span "payment" 耗时 1.8s
  ▼
日志（ELK）
  │ traceId=abc123, 支付网关超时异常堆栈
```

**三者关联配置**：

```java
// 1. 日志中自动注入 traceId（已在 logback-spring.xml 配置）
// log pattern: [%X{traceId:-}]

// 2. 追踪中自动注入日志标记
@Configuration
public class TracingLogConfig {

    @Bean
    public ObservationHandler<Observation.Context> loggingHandler() {
        // Micrometer Observation 自动记录 Span 事件到日志
        return new TracingAwareObservationHandler<>(
            new Slf4JLoggingHandler());
    }
}

// 3. 指标中标记 traceId（通过 Meter Filter 注入标签，不推荐高基数）
```

**排查路径 — 从告警到根因**：

```
Step 1: Prometheus 告警
  "P99 latency > 2s for /api/orders"

Step 2: Grafana 看板
  确认是哪个 URI、哪个时间段、错误率是否上升

Step 3: 查看链路追踪
  在 Zipkin 中按 traceId 搜索，找到慢请求
  看 Span 耗时分布，定位最慢的 Span

Step 4: 查看日志
  用 traceId 在 Kibana 中搜索
  看详细错误堆栈、数据库慢查询、外部服务超时

Step 5: 定位根因
  比如：PaymentService 调用支付宝超时 → 支付宝 API 限流
```

**一键关联的代码**：

```java
@Slf4j
@RestController
@RequestMapping("/api/orders")
@RequiredArgsConstructor
public class OrderController {

    private final OrderService orderService;
    private final MeterRegistry meterRegistry;

    @PostMapping
    public Order createOrder(@RequestBody OrderRequest request) {
        long start = System.currentTimeMillis();

        try {
            Order order = orderService.create(request);

            // 指标：记录成功
            meterRegistry.counter("orders.created", "status", "success")
                .increment();

            // 日志：记录 traceId（自动注入，无需手动设置）
            log.info("订单创建成功, orderId={}, 耗时={}ms",
                order.getId(), System.currentTimeMillis() - start);

            return order;
        } catch (Exception e) {
            // 指标：记录失败
            meterRegistry.counter("orders.created",
                "status", "failure", "error", e.getClass().getSimpleName())
                .increment();

            // 日志：记录详细错误（traceId 自动关联）
            log.error("订单创建失败, request={}", request, e);

            throw e;
        }
    }
}
```

> **踩坑提醒**：三者关联的前提是 traceId 在全链路一致。如果你的日志系统用了自己的 requestId、追踪系统用了自己的 traceId、两者没有打通，那所谓的"关联"就是空谈。确保 `MDC.put("traceId", ...)` 使用的是追踪系统生成的 traceId。

---

## 6.4 生产问题排查

### 6.4.1 线上 CPU 飙高排查

**痛点**：监控告警 CPU 90%+，但你不知道是哪个线程、哪段代码在疯狂消耗 CPU。

**排查步骤**：

```bash
# Step 1: 找到 CPU 最高的 Java 进程
top -c
# 记下进程 PID，比如 12345

# Step 2: 找到该进程中 CPU 最高的线程
top -Hp 12345
# 记下线程 PID，比如 12367

# Step 3: 线程 PID 转 16 进制
printf "%x\n" 12367
# 输出: 304f

# Step 4: 在 jstack 中查找该线程
jstack 12345 | grep -A 30 "nid=0x304f"
```

**一键排查脚本**：

```bash
#!/bin/bash
# cpu-diagnosis.sh — CPU 飙高一键排查

PID=$1
if [ -z "$PID" ]; then
    echo "Usage: $0 <java-pid>"
    exit 1
fi

echo "=== CPU Top 10 线程 ==="
top -Hp $PID -b -n 1 | head -17

echo ""
echo "=== 高 CPU 线程堆栈 ==="
for tid in $(top -Hp $PID -b -n 1 | tail -n +8 | head -10 | awk '{print $1}'); do
    hex_tid=$(printf "%x" $tid)
    echo "--- Thread $tid (0x$hex_tid) ---"
    jstack $PID | grep -A 20 "nid=0x$hex_tid" | head -25
    echo ""
done
```

**Arthas 更强大的排查**：

```bash
# 下载并启动 Arthas
curl -O https://arthas.aliyun.com/arthas-boot.jar
java -jar arthas-boot.jar 12345

# 查看最繁忙的线程
thread -n 5       # 显示 CPU 占用最高的 5 个线程

# 查看某个线程的堆栈
thread 123        # 查看线程 ID 为 123 的堆栈

# 查看方法耗时
trace com.myapp.service.OrderService createOrder

# 监控方法调用
watch com.myapp.service.OrderService createOrder '{params, returnObj, throwExp}'
```

**常见 CPU 飙高原因**：

| 原因 | 特征 | 解决方案 |
|------|------|----------|
| 死循环 | 堆栈卡在同一行代码 | 修复循环条件 |
| 正则回溯 | `Pattern.compile` 相关堆栈 | 优化正则表达式 |
| 频繁 Full GC | CPU 高 + GC 日志有大量 Full GC | 增大堆内存 / 修复内存泄漏 |
| 序列化/反序列化 | JSON/XML 处理堆栈 | 换用更快的序列化库 |
| 加密/解密 | `Cipher` 相关堆栈 | 异步处理 / 硬件加速 |

> **踩坑提醒**：`jstack` 在某些 JVM 版本下会触发 Full GC（安全点），如果线上流量很大，建议用 Arthas 的 `thread` 命令代替。另外，如果 CPU 飙高是由 GC 引起的，`jstack` 看到的线程堆栈可能全是 GC 线程——先看 GC 日志确认。

---

### 6.4.2 内存泄漏排查

**痛点**：应用运行几天后 OOM，重启后又好了——典型的内存泄漏。你需要找到是哪个对象在不断增长。

**排查步骤**：

```bash
# Step 1: 确认内存使用情况
jmap -heap 12345
# 查看堆使用率，如果 Old 区持续增长 → 可能有泄漏

# Step 2: 查看对象分布
jmap -histo:live 12345 | head -30
# 查看实例数最多的类，如果某个类实例数异常多 → 嫌疑对象

# Step 3: 导出堆内存快照
jmap -dump:live,format=b,file=heap.hprof 12345

# Step 4: 用 MAT 分析
# 下载 Eclipse Memory Analyzer: https://www.eclipse.org/mat/
# 打开 heap.hprof，查看 Dominator Tree 和 Leak Suspects
```

**启动时自动 dump（推荐）**：

```bash
# JVM 参数：OOM 时自动 dump
java -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/data/heap-dumps/ \
     -XX:+UseG1GC \
     -Xms2g -Xmx2g \
     -jar myapp.jar
```

**常见内存泄漏场景**：

```java
// ❌ 场景 1: ThreadLocal 泄漏
public class UserContext {
    private static final ThreadLocal<User> CURRENT_USER = new ThreadLocal<>();

    public static void setUser(User user) {
        CURRENT_USER.set(user);
    }

    // 忘记调用 remove() → 线程复用时旧对象无法回收
    // 在 Web 应用中，Tomcat 线程池的线程会被复用
    public static void clear() {
        CURRENT_USER.remove();  // ✅ 必须在请求结束时调用
    }
}

// ❌ 场景 2: 静态集合不断增长
public class CacheManager {
    // 静态 Map 只增不减，最终 OOM
    private static final Map<String, Object> CACHE = new HashMap<>();

    public void put(String key, Object value) {
        CACHE.put(key, value);  // 永远不会被 GC
    }
}

// ✅ 修复：使用带过期的缓存
public class CacheManager {
    private final Cache<String, Object> cache = Caffeine.newBuilder()
        .maximumSize(10000)
        .expireAfterWrite(Duration.ofMinutes(30))
        .build();

    public void put(String key, Object value) {
        cache.put(key, value);
    }
}

// ❌ 场景 3: 数据库连接未关闭
public List<Order> findOrders() {
    Connection conn = dataSource.getConnection();
    PreparedStatement ps = conn.prepareStatement("SELECT * FROM orders");
    ResultSet rs = ps.executeQuery();
    // 如果中间抛异常，连接永远不会关闭！
    List<Order> orders = mapResults(rs);
    rs.close();
    ps.close();
    conn.close();
    return orders;
}

// ✅ 修复：try-with-resources
public List<Order> findOrders() {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement("SELECT * FROM orders");
         ResultSet rs = ps.executeQuery()) {
        return mapResults(rs);
    }
}

// ❌ 场景 4: 监听器/回调未注销
@Component
public class EventListener {
    @PostConstruct
    public void init() {
        eventBus.register(this);  // 注册
    }

    // 如果没有 @PreDestroy 注销，这个 Bean 永远被 eventBus 引用
    @PreDestroy
    public void destroy() {
        eventBus.unregister(this);  // ✅ 必须注销
    }
}
```

**MAT 分析技巧**：

| MAT 功能 | 用途 |
|----------|------|
| Leak Suspects Report | 自动分析泄漏嫌疑对象 |
| Dominator Tree | 按占用内存排序，找大对象 |
| Histogram | 按类统计实例数 |
| OQL | SQL 风格查询堆内存 |

```sql
-- OQL 示例：查找大于 1MB 的 byte 数组
SELECT * FROM byte[] b WHERE b.@retainedHeapSize > 1048576

-- 查找所有未关闭的 InputStream
SELECT * FROM java.io.FileInputStream WHERE in.@retainedHeapSize > 0
```

> **踩坑提醒**：`jmap -dump:live` 会触发 Full GC（因为 `live` 参数需要标记存活对象），线上大堆内存 dump 可能导致 STW 几秒到几十秒。生产环境建议用 `jcmd <pid> GC.heap_dump heap.hprof` 代替，或者直接用 Arthas 的 `heapdump` 命令。

---

### 6.4.3 接口慢查询排查

**痛点**：用户反馈"页面加载很慢"，你打开监控看到 P99 有 5 秒，但不知道是代码慢、数据库慢、还是网络慢。

**排查路径**：

```
用户反馈慢
  │
  ▼
链路追踪（Zipkin/Jaeger）
  │ 看到总耗时 5s，其中 DB 查询 4.5s
  ▼
慢查询日志（MySQL）
  │ 找到具体 SQL：SELECT * FROM orders WHERE status=?
  │ 执行计划：全表扫描，rows=500000
  ▼
根因：status 列没有索引
```

**Step 1: 链路追踪定位慢 Span**：

```java
// 自定义 Span 记录关键操作
@Service
@RequiredArgsConstructor
public class OrderService {

    private final Tracer tracer;
    private final OrderRepository orderRepository;

    public List<Order> searchOrders(OrderQuery query) {
        // 创建自定义 Span
        Span dbSpan = tracer.nextSpan().name("db-query-orders").start();
        try (Tracer.SpanInScope ws = tracer.withSpan(dbSpan)) {
            dbSpan.tag("query.status", query.getStatus());
            dbSpan.tag("query.limit", String.valueOf(query.getLimit()));

            List<Order> results = orderRepository.findByCriteria(query);

            dbSpan.tag("result.count", String.valueOf(results.size()));
            return results;
        } finally {
            dbSpan.end();
        }
    }
}
```

**Step 2: 数据库慢查询日志**：

```sql
-- MySQL 开启慢查询日志
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 1;        -- 超过 1 秒记录
SET GLOBAL log_queries_not_using_indexes = ON;  -- 记录未使用索引的查询

-- 查看慢查询
SHOW VARIABLES LIKE 'slow_query%';
```

```yaml
# application.yml — Spring Boot 慢查询日志
spring:
  jpa:
    properties:
      hibernate:
        format_sql: true
        use_sql_comments: true
  datasource:
    hikari:
      # 连接池监控
      register-mbeans: true
      metrics-tracker-factory: com.zaxxer.hikari.metrics.micrometer.MicrometerMetricsTrackerFactory
```

**Step 3: 连接池监控**：

```java
@Component
@RequiredArgsConstructor
public class DataSourceMetrics {

    private final DataSource dataSource;
    private final MeterRegistry registry;

    @PostConstruct
    public void bindMetrics() {
        if (dataSource instanceof HikariDataSource hikari) {
            // HikariCP 自动绑定 Micrometer 指标
            // 监控以下指标：
            // - hikaricp_connections_active    活跃连接数
            // - hikaricp_connections_idle      空闲连接数
            // - hikaricp_connections_pending   等待连接的线程数
            // - hikaricp_connections_timeout   获取连接超时次数
            hikari.setMetricRegistry(registry);
        }
    }
}
```

**慢查询优化 Checklist**：

| 检查项 | 方法 | 阈值 |
|--------|------|------|
| 是否有索引 | `EXPLAIN SELECT ...` | `type` 不应是 `ALL` |
| 扫描行数 | `rows` 列 | 应远小于总行数 |
| 是否有 filesort | `Extra` 列 | 避免 `Using filesort` |
| 是否有临时表 | `Extra` 列 | 避免 `Using temporary` |
| 连接池等待 | `hikaricp_connections_pending` | 应为 0 |
| 连接获取时间 | 日志/链路追踪 | 应 < 10ms |

```sql
-- EXPLAIN 分析示例
EXPLAIN SELECT * FROM orders WHERE status = 'PENDING' AND created_at > '2024-01-01';

-- 输出：
-- type: ALL          ← 全表扫描，危险！
-- rows: 500000       ← 扫描 50 万行
-- key: NULL          ← 没用索引

-- 修复：添加复合索引
ALTER TABLE orders ADD INDEX idx_status_created (status, created_at);

-- 再次 EXPLAIN：
-- type: ref          ← 索引查找
-- rows: 1200         ← 只扫描 1200 行
-- key: idx_status_created
```

**PromQL 监控慢查询**：

```promql
# 查询执行时间超过 1 秒的查询数量
increase(hikaricp_connections_timeout_total[5m])

# P99 查询耗时
histogram_quantile(0.99, rate(http_server_requests_seconds_bucket{uri="/api/orders"}[5m]))

# 数据库活跃连接 vs 最大连接
hikaricp_connections_active / hikaricp_connections_max
```

> **踩坑提醒**：HikariCP 的 `connection-timeout` 默认是 30 秒——如果连接池耗尽，请求会卡 30 秒才超时。生产环境建议设为 3-5 秒，并监控 `hikaricp_connections_pending` 指标。如果 `pending` 持续 > 0，说明连接池太小或有连接泄漏。

---

## 本章小结

| 支柱 | 工具 | 核心价值 |
|------|------|----------|
| 日志 | SLF4J + Logback + MDC | 告诉你"发生了什么"，traceId 关联全链路 |
| 指标 | Micrometer + Prometheus + Grafana | 告诉你"系统状态如何"，趋势和告警 |
| 追踪 | Micrometer Tracing + Zipkin | 告诉你"请求经过了哪里"，定位瓶颈 |
| 排查 | jstack/jmap/Arthas/MAT | 告诉你"代码哪里有问题"，定位根因 |

**可观测性黄金法则**：日志、指标、追踪三者必须通过 traceId 打通。只有这样，你才能在 5 分钟内从"P99 超标"定位到"某行代码导致数据库慢查询"。
