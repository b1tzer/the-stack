# 日志体系

> **一句话总结**：`System.out.println` 散落在代码里，没有级别、没有时间戳、没有线程信息，生产环境出问题根本没法排查。SLF4J + Logback + MDC 是 Java 日志的标准答案。

## 1. SLF4J + Logback 配置

### 1.1 SLF4J 门面模式

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

### 1.2 logback-spring.xml 完整配置

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

### 1.3 日志级别使用规范

| 级别 | 用途 | 示例 |
| :-- | :-- | :-- |
| `ERROR` | 系统错误，需要立即关注 | 异常堆栈、服务不可用 |
| `WARN` | 潜在问题，暂不影响业务 | 重试、降级、配置缺失 |
| `INFO` | 关键业务流程 | 订单创建、用户登录、支付完成 |
| `DEBUG` | 开发调试信息 | 方法参数、SQL 语句、缓存命中 |
| `TRACE` | 最详细的跟踪信息 | 循环内变量、详细数据流 |

> **踩坑提醒**：生产环境把 Hibernate SQL 日志开成 `DEBUG` 级别会严重影响性能——每条 SQL 都要格式化输出。调试完记得关掉。另外，`AsyncAppender` 的 `queueSize` 设太小，高并发时日志会丢失；设太大，OOM 风险增加。512-1024 是比较平衡的值。

## 2. 结构化日志（JSON 格式）

**痛点**：非结构化日志在 ELK 中解析困难——一个异常堆栈跨了 20 行，Logstash 怎么把它拼成一条日志？

### 2.1 JSON 格式配置

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

### 2.2 ELK 配置要点

| 组件 | 作用 | 关键配置 |
| :-- | :-- | :-- |
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

## 3. MDC 与日志上下文

**痛点**：一个请求经过 5 个服务、20 个方法调用，日志散落在不同地方——你怎么把它们串起来？

### 3.1 MDC Filter 实现

MDC（Mapped Diagnostic Context）基于 ThreadLocal，可以在整个请求链路中传递上下文信息：

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

### 3.2 异步场景 MDC 传播

**问题**：MDC 基于 `ThreadLocal`，子线程拿不到父线程的 MDC 值。

**解决方案：TaskDecorator**：

```java
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

### 3.3 在 logback-spring.xml 中使用 MDC

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
