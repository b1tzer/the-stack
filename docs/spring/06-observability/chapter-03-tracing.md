# 链路追踪

> **一句话总结**：一个请求经过 A → B → C 三个服务，A 报 500，你不知道是 B 还是 C 出了问题。分布式追踪帮你画出完整的调用链路，traceId 是串联日志、指标、追踪三大支柱的钥匙。

## 1. 分布式追踪原理

### 1.1 核心概念

| 概念 | 说明 | 类比 |
|------|------|------|
| `Trace` | 一次完整的请求链路 | 一条快递单号 |
| `Span` | 链路中的一个操作单元 | 快递的一个中转站 |
| `TraceId` | 全局唯一追踪 ID | 快递单号 |
| `SpanId` | 当前操作 ID | 中转站编号 |
| `ParentSpanId` | 父操作 ID | 上一个中转站 |
| `Context Propagation` | 跨服务传递追踪上下文 | 快递单跟着包裹走 |

### 1.2 Span 树结构

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

### 1.3 Context Propagation 跨服务传递

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

> **踩坑提醒**：如果中间某个服务没有正确传递追踪头（`X-B3-*` 或 `traceparent`），链路就会断开——你在追踪系统里只能看到两段孤立的链路，无法关联。确保所有 HTTP 客户端（RestTemplate、Feign、WebClient）都配置了追踪传播。

## 2. Micrometer Tracing + Zipkin

### 2.1 依赖配置

Spring Cloud Sleuth 已停止维护（Spring Boot 3.x 不再支持），新标准是 Micrometer Tracing。

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

# 日志中自动注入 traceId 和 spanId
logging:
  pattern:
    level: "%5p [${spring.application.name},%X{traceId:-},%X{spanId:-}]"
```

### 2.2 采样率策略

| 策略 | 配置 | 适用场景 |
|------|------|----------|
| 全量采集 | `probability: 1.0` | 开发/测试环境 |
| 概率采样 | `probability: 0.1` | 生产环境（10% 采样） |
| 限流采样 | 自定义 `Sampler` | 高并发场景 |
| 尾部采样 | 外部 Collector | 只保留慢请求/错误请求 |

### 2.3 RestTemplate / WebClient 自动注入追踪头

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
        return builder.baseUrl("http://order-service").build();
    }
}
```

> **踩坑提醒**：生产环境 `probability: 1.0` 会导致追踪数据量巨大，Zipkin 存储很快撑满。建议从 `0.1` 开始，根据流量调整。另外，Spring Cloud Gateway / Spring MVC 默认会自动传播追踪上下文，但如果你用了自定义的 `HttpClient` 或 `OkHttp`，需要手动配置 `TracingHttpClientInterceptor`。

## 3. 日志-指标-追踪三者关联

**痛点**：告警说 P99 超过 2 秒（指标），你打开链路追踪看到某个 Span 很慢（追踪），然后想看这个请求的详细日志（日志）——三个系统之间怎么串起来？

### 3.1 traceId 是串联三大支柱的钥匙

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

### 3.2 排查路径 — 从告警到根因

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

### 3.3 一键关联的代码

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
