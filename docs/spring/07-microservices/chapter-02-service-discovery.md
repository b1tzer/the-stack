# 分布式系统治理

> 当单体应用拆分为数十个微服务后，配置散落各处、一个服务故障引发雪崩、流量突增时系统瘫痪、请求链路如同黑盒——这些是分布式系统必须直面的治理难题。本章将系统讲解配置中心、服务容错、限流降级和链路追踪四大核心治理手段，让你的微服务集群从"能跑"走向"可控"。

## 1. 配置中心（Nacos Config + @RefreshScope 热更新）

### 1.1 为什么需要配置中心

在单体时代，配置通常写在 `application.yml` 里，改一次重启一下就行。但微服务架构下，几十个服务实例分散在不同机器上，手动修改配置文件既低效又危险：

| 问题 | 具体表现 |
|------|---------|
| 配置散落 | 每个服务各有一份配置，修改需要逐个登录服务器 |
| 环境不一致 | 开发、测试、生产的配置值不同，手动管理容易出错 |
| 生效延迟 | 修改配置需要重启服务，影响线上可用性 |
| 缺乏版本管理 | 配置改错了无法快速回滚 |

配置中心的核心价值：**集中管理、动态生效、版本回滚、环境隔离**。

### 1.2 Nacos Config 架构

Nacos（Naming and Configuration Service）是阿里巴巴开源的服务发现与配置管理平台。其配置中心的工作流程如下：

```text
┌─────────────┐     ①发布配置      ┌─────────────┐
│  管理控制台   │ ──────────────────▶ │  Nacos Server │
└─────────────┘                     └──────┬──────┘
                                           │
                               ②长轮询/推送通知
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    ▼                      ▼                      ▼
             ┌───────────┐          ┌───────────┐          ┌───────────┐
             │ Service-A  │          │ Service-B  │          │ Service-C  │
             │ Instance 1 │          │ Instance 1 │          │ Instance 1 │
             └───────────┘          └───────────┘          └───────────┘
```

Nacos 使用**长轮询（Long Polling）**机制：客户端每隔 30 秒向服务端发起请求，服务端会 hold 住连接直到配置变更或超时。这样既避免了推送的连接维护成本，又比短轮询更及时。

### 1.3 Spring Boot 集成 Nacos Config

**第一步：引入依赖**

```xml
<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-nacos-config</artifactId>
    <version>2022.0.0.0</version>
</dependency>
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-bootstrap</artifactId>
</dependency>
```

**第二步：配置 bootstrap.yml**

```yaml
spring:
  application:
    name: order-service
  profiles:
    active: dev
  cloud:
    nacos:
      config:
        server-addr: 127.0.0.1:8848
        namespace: dev-namespace-id
        group: DEFAULT_GROUP
        file-extension: yml
        # 共享配置
        shared-configs:
          - data-id: common-datasource.yml
            group: SHARED_GROUP
            refresh: true
```

**第三步：在 Nacos 控制台创建配置**

在 Nacos 控制台创建 `order-service.yml`（Data ID），写入业务配置：

```yaml
order:
  timeout-seconds: 30
  max-retry: 3
  page-size: 20
```

**第四步：代码中读取并支持热更新**

```java
@RestController
@RefreshScope  // 关键注解：配置变更时自动刷新 Bean
public class OrderController {

    @Value("${order.timeout-seconds:30}")
    private int timeoutSeconds;

    @Value("${order.page-size:20}")
    private int pageSize;

    @GetMapping("/order/config")
    public Map<String, Object> getConfig() {
        return Map.of(
            "timeoutSeconds", timeoutSeconds,
            "pageSize", pageSize
        );
    }
}
```

### 1.4 @RefreshScope 的工作原理

`@RefreshScope` 是 Spring Cloud 提供的注解，其本质是将 Bean 的作用域设为 `refresh`：

```text
配置变更事件
    │
    ▼
ContextRefresher.refresh()
    │
    ▼
销毁 @RefreshScope 标注的 Bean（从 scope 缓存中移除）
    │
    ▼
下次访问时重新创建 Bean（使用新的 @Value 值）
```

**注意事项**：

- `@RefreshScope` 会导致 Bean 被重新创建，注意是否有状态需要保存
- 只有通过 `@Value` 和 `@ConfigurationProperties` 绑定的属性才会刷新
- 如果 Bean 被其他 Bean 以字段注入方式引用，刷新后引用方拿到的仍是旧对象，建议配合 `@Lazy` 或方法注入使用

### 1.5 配置的 Namespace / Group / Data ID 三层结构

Nacos 用三层结构组织配置，适合多团队、多环境的管理需求：

```text
Namespace（命名空间）── 通常按环境划分：dev / test / prod
    │
    ├── Group（分组）── 通常按业务域划分：order-group / user-group
    │       │
    │       ├── Data ID: order-service.yml
    │       ├── Data ID: order-service-datasource.yml
    │       └── Data ID: common-mq.yml
    │
    └── Group: shared-group
            ├── Data ID: common-redis.yml
            └── Data ID: common-datasource.yml
```

## 2. 服务容错（超时 / 重试 / 熔断）

### 2.1 分布式系统中的级联故障

在微服务调用链中，任何一个节点出问题都可能引发连锁反应：

```text
用户请求 → Gateway → OrderService → PaymentService → AccountService
                                            │
                                       AccountService 响应变慢（5s）
                                            │
                                            ▼
                                    PaymentService 线程被阻塞
                                    （Tomcat 线程池 200 个线程逐渐被占满）
                                            │
                                            ▼
                                    OrderService 调用 PaymentService 超时
                                    也开始积压线程
                                            │
                                            ▼
                                    Gateway 大量请求超时
                                    整个系统不可用 —— 雪崩
```

这就是**级联故障（Cascading Failure）**，也叫雪崩效应。服务容错的核心目标：**阻止故障扩散，保护系统整体可用性**。

### 2.2 三大容错策略对比

| 策略 | 含义 | 适用场景 | 风险 |
|------|------|---------|------|
| **超时（Timeout）** | 为每次调用设置最大等待时间，超时则快速失败 | 所有远程调用 | 超时值设置过短导致误判，过长则失去保护意义 |
| **重试（Retry）** | 调用失败后按策略重新发起请求 | 网络抖动、瞬时故障 | 重试放大效应：下游已过载，重试反而加重负担 |
| **熔断（Circuit Breaker）** | 检测到下游故障率超过阈值后，短时间直接拒绝请求 | 下游服务不稳定或不可用 | 熔断恢复时机不当可能导致反复熔断 |

### 2.3 超时设置原则

```java
// Feign 客户端超时配置
@FeignClient(name = "payment-service", configuration = FeignConfig.class)
public interface PaymentClient {

    @PostMapping("/api/payment/create")
    PaymentResult createPayment(PaymentRequest request);
}

// FeignConfig.java
public class FeignConfig {
    @Bean
    public Request.Options requestOptions() {
        return new Request.Options(
            2, TimeUnit.SECONDS,   // 连接超时
            5, TimeUnit.SECONDS,   // 读取超时
            true                    // 跟随重定向
        );
    }
}
```

超时值的计算逻辑：

```text
接口超时 = P99 响应时间 × 安全系数（1.5 ~ 2）
但不能大于上游能容忍的最大等待时间
```

建议：**逐层递减超时**。Gateway 层 10s → OrderService 8s → PaymentService 5s → AccountService 3s。这样每层都能在上游超时前返回。

### 2.4 重试策略设计

```java
// Spring Retry 示例
@Configuration
@EnableRetry
public class RetryConfig {

    @Bean
    public RetryTemplate retryTemplate() {
        RetryTemplate template = new RetryTemplate();

        // 重试策略：最多重试 3 次，仅对特定异常重试
        SimpleRetryPolicy policy = new SimpleRetryPolicy(3,
            Map.of(
                FeignException.class, true,       // Feign 调用异常可重试
                BusinessValidationException.class, false  // 业务校验异常不重试
            )
        );
        template.setRetryPolicy(policy);

        // 退避策略：指数退避 + 随机抖动
        ExponentialBackOffPolicy backOff = new ExponentialBackOffPolicy();
        backOff.setInitialInterval(100);   // 首次等待 100ms
        backOff.setMultiplier(2);          // 每次翻倍
        backOff.setMaxInterval(2000);      // 最大等待 2s
        template.setBackOffPolicy(backOff);

        return template;
    }
}
```

**重试的三条铁律**：

1. **只重试幂等操作**：查询、更新（带版本号）可以重试；创建订单这类非幂等操作不能盲目重试
2. **指数退避 + 随机抖动**：避免所有客户端同时重试形成"惊群效应"
3. **限制重试次数**：通常 2~3 次，超过则快速失败

### 2.5 熔断器状态机

熔断器（Circuit Breaker）是容错的核心机制，其工作状态可以用一个三态状态机描述：

```text
                    失败率超过阈值
    ┌──────────┐ ──────────────────▶ ┌──────────┐
    │  CLOSED  │                     │   OPEN   │
    │ (正常放行) │ ◀────────────────── │ (快速失败) │
    └──────────┘    探测请求成功      └────┬─────┘
         ▲                                │
         │                                │ 探测超时
         │         ┌───────────┐          │
         └─────────│HALF-OPEN  │◀─────────┘
          探测成功  │ (允许少量  │
                   │  请求通过)  │
                   └───────────┘
                        │
                        │ 探测请求失败
                        ▼
                   ┌──────────┐
                   │   OPEN   │
                   └──────────┘
```

| 状态 | 行为 | 触发条件 |
|------|------|---------|
| CLOSED | 正常放行所有请求，同时统计失败率 | 初始状态 |
| OPEN | 直接拒绝所有请求，返回降级响应 | 失败率超过阈值（如 50%） |
| HALF-OPEN | 放行少量探测请求，检验下游是否恢复 | OPEN 状态持续一段时间后自动进入 |

## 3. 限流与降级（Sentinel）

### 3.1 Sentinel 核心概念

Sentinel 是阿里巴巴开源的流量治理组件，其核心功能可以概括为四个方面：

| 功能 | 说明 | 典型场景 |
|------|------|---------|
| **流量控制** | 根据 QPS 或并发数控制入口流量 | 秒杀活动限制每秒只放 1000 个请求 |
| **熔断降级** | 检测调用异常比例/慢调用比例，自动熔断 | 下游服务响应变慢时快速降级 |
| **热点参数限流** | 针对请求中的热点参数做精细化限流 | 商品 ID=1001 访问量过大，单独限制 |
| **系统自适应保护** | 根据系统负载（CPU、RT、QPS）自适应调整流量 | 系统 CPU 超过 80% 时自动降低入口流量 |

### 3.2 流量控制规则

```java
// 代码方式定义流控规则
@PostConstruct
public void initFlowRules() {
    List<FlowRule> rules = new ArrayList<>();

    FlowRule rule = new FlowRule();
    rule.setResource("createOrder");          // 资源名称
    rule.setGrade(RuleConstant.FLOW_GRADE_QPS); // 限流阈值类型：QPS
    rule.setCount(100);                        // QPS 阈值：100
    rule.setControlBehavior(
        RuleConstant.CONTROL_BEHAVIOR_WARM_UP  // 预热模式
    );
    rule.setWarmUpPeriodSec(10);               // 预热时长 10 秒
    rules.add(rule);

    FlowRuleManager.loadRules(rules);
}
```

Sentinel 提供四种流控效果：

| 效果 | 说明 |
|------|------|
| 快速失败（默认） | 超过阈值立即拒绝 |
| Warm Up | 从低阈值逐步提升到高阈值，预热期结束后稳定 |
| 排队等待 | 匀速通过，多余的请求排队，超时则丢弃 |
| 关联限流 | 当关联资源的 QPS 超过阈值时，限制当前资源 |

### 3.3 热点参数限流

热点参数限流可以针对请求参数中的特定值做精细化控制：

```java
@GetMapping("/product/{id}")
@SentinelResource(value = "getProduct",
    blockHandler = "getProductBlockHandler")
public Product getProduct(@PathVariable("id") Long id) {
    return productService.getById(id);
}

// 热点参数限流规则
@PostConstruct
public void initParamFlowRules() {
    ParamFlowRule rule = new ParamFlowRule("getProduct")
        .setParamIdx(0)                    // 对第 0 个参数限流
        .setGrade(RuleConstant.FLOW_GRADE_QPS)
        .setCount(50);                     // 默认 QPS 限制 50

    // 特例：热点商品 ID=1001 允许更高的 QPS
    ParamFlowItem item = new ParamFlowItem()
        .setObject(String.valueOf(1001))
        .setClassType(long.class.getName())
        .setCount(200);
    rule.setParamFlowItemList(Collections.singletonList(item));

    ParamFlowRuleManager.loadRules(Collections.singletonList(rule));
}
```

这意味着：
- 访问 `/product/1001`（热门商品）：允许 200 QPS
- 访问其他商品：只允许 50 QPS

### 3.4 熔断降级规则

```java
@PostConstruct
public void initDegradeRules() {
    List<DegradeRule> rules = new ArrayList<>();

    DegradeRule rule = new DegradeRule();
    rule.setResource("callPaymentService");

    // 慢调用比例模式
    rule.setGrade(CircuitBreakerStrategy.SLOW_REQUEST_RATIO.getType());
    rule.setCount(0.5);            // 慢调用比例阈值 50%
    rule.setSlowRatioThreshold(1000); // RT 超过 1000ms 视为慢调用
    rule.setTimeWindow(10);        // 熔断持续 10 秒
    rule.setMinRequestAmount(10);  // 最少 10 次请求才触发统计
    rule.setStatIntervalMs(10000); // 统计窗口 10 秒

    rules.add(rule);
    DegradeRuleManager.loadRules(rules);
}
```

### 3.5 系统自适应保护

系统自适应保护不需要为每个资源配置规则，而是从全局视角保护系统：

```java
@PostConstruct
public void initSystemRules() {
    SystemRule rule = new SystemRule();
    rule.setHighestSystemLoad(3.0);      // 系统 Load 超过 3 时触发
    rule.setAvgRt(1000);                 // 平均 RT 超过 1000ms 触发
    rule.setMaxThread(200);              // 并发线程数超过 200 触发
    rule.setQps(5000);                   // 入口 QPS 超过 5000 触发
    rule.setHighestCpuUsage(0.8);        // CPU 使用率超过 80% 触发

    SystemRuleManager.loadRules(Collections.singletonList(rule));
}
```

## 4. 分布式链路追踪

### 4.1 为什么需要链路追踪

一个用户请求在微服务架构中可能经过 5~10 个服务，当请求变慢或出错时，如何快速定位问题发生在哪个环节？

```text
[用户] → Gateway → OrderService → UserService
                       │                │
                       ▼                ▼
                 PaymentService    AddressService
                       │
                       ▼
                 AccountService     ← 问题出在这里！
```

没有链路追踪时，排查方式是逐个查看每个服务的日志，用时间戳和关键词去关联——在几十个服务、数百个实例中，这几乎是不可能完成的任务。

### 4.2 TraceID 与 Span 模型

分布式链路追踪的核心数据模型由 Google Dapper 论文提出：

| 概念 | 含义 | 类比 |
|------|------|------|
| **Trace** | 一个完整请求的全链路调用记录 | 一次快递的完整物流轨迹 |
| **TraceID** | 全局唯一标识，贯穿整条调用链 | 快递单号 |
| **Span** | 一次 RPC 调用或方法执行的记录 | 快递经过每一个中转站的记录 |
| **SpanID** | 当前 Span 的唯一标识 | 中转站编号 |
| **ParentSpanID** | 父 Span 的标识，构成调用树 | 上一个中转站编号 |
| **采样率** | 决定哪些请求需要记录链路信息 | 抽检比例 |

一次请求的 Span 关系如下：

```text
TraceID: abc-123-def

Span A (Gateway)              SpanID=1, Parent=null
    │
    ├── Span B (OrderService)  SpanID=2, Parent=1
    │       │
    │       ├── Span C (PaymentService)  SpanID=3, Parent=2
    │       │       │
    │       │       └── Span D (AccountService)  SpanID=4, Parent=3
    │       │
    │       └── Span E (InventoryService)  SpanID=5, Parent=2
    │
    └── Span F (UserService)   SpanID=6, Parent=1
```

每个 Span 记录的信息：

```java
public class Span {
    private String traceId;       // 全局追踪 ID
    private String spanId;        // 当前 Span ID
    private String parentSpanId;  // 父 Span ID
    private String serviceName;   // 服务名
    private String operationName; // 操作名（如 HTTP GET /api/order）
    private long startTime;       // 开始时间
    private long duration;        // 耗时（毫秒）
    private int statusCode;       // 状态码
    private Map<String, String> tags; // 附加标签
}
```

### 4.3 SkyWalking Java Agent 无侵入追踪

SkyWalking 是 Apache 基金会的顶级项目，其最大优势是**无侵入**——不需要在业务代码中添加任何追踪代码，通过 Java Agent 在字节码层面自动埋点。

**部署架构**：

```text
┌─────────────────────────────────────────────────────────┐
│                     应用服务器集群                         │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Java 应用 A   │  │ Java 应用 B   │  │ Java 应用 C   │  │
│  │ + SkyWalking  │  │ + SkyWalking  │  │ + SkyWalking  │  │
│  │   Java Agent  │  │   Java Agent  │  │   Java Agent  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │ gRPC             │ gRPC             │ gRPC     │
└─────────┼─────────────────┼─────────────────┼──────────┘
          ▼                 ▼                 ▼
   ┌─────────────────────────────────────────────┐
   │           SkyWalking OAP Server              │
   │   (数据接收、分析、存储)                       │
   └──────────────────────┬──────────────────────┘
                          │
               ┌──────────┴──────────┐
               ▼                     ▼
        ┌────────────┐       ┌────────────┐
        │ SkyWalking  │       │  Storage   │
        │     UI      │       │ (ES/MySQL) │
        └────────────┘       └────────────┘
```

**使用方式极其简单**——只需在 JVM 启动参数中加入一行：

```bash
java -javaagent:/path/skywalking-agent.jar \
     -Dskywalking.agent.service_name=order-service \
     -Dskywalking.collector.backend_service=127.0.0.1:11800 \
     -jar order-service.jar
```

**SkyWalking 自动追踪的组件**：

| 类型 | 支持的框架/组件 |
|------|----------------|
| HTTP 客户端 | HttpClient、OkHttp、Feign、RestTemplate |
| Web 框架 | Spring MVC、Servlet、Dubbo |
| 数据库 | JDBC、MyBatis、Hibernate |
| 缓存 | Redis（Jedis、Lettuce） |
| 消息队列 | RocketMQ、Kafka、RabbitMQ |
| 定时任务 | Spring @Scheduled、Quartz |

### 4.4 TraceID 传递与日志关联

为了让链路追踪真正发挥作用，需要将 TraceID 注入日志，这样在排查问题时可以：

1. 通过 SkyWalking UI 找到慢请求的 TraceID
2. 用 TraceID 在日志系统中检索所有相关日志
3. 快速定位问题根因

在 `logback-spring.xml` 中配置 TraceID 输出：

```xml
<property name="CONSOLE_LOG_PATTERN"
    value="%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] [%X{tid}] %-5level %logger{36} - %msg%n" />
```

SkyWalking Agent 会自动将 TraceID 注入 MDC（Mapped Diagnostic Context），key 为 `tid`。日志输出效果：

```text
2024-01-15 14:23:45.123 [http-nio-8080-exec-1] [TID:abc-123-def] INFO  o.s.OrderService - Creating order for user 10086
2024-01-15 14:23:45.156 [http-nio-8080-exec-1] [TID:abc-123-def] INFO  o.s.PaymentService - Processing payment 200.00
2024-01-15 14:23:45.890 [http-nio-8080-exec-1] [TID:abc-123-def] ERROR o.s.AccountService - Account balance insufficient
```

三条日志通过 `TID:abc-123-def` 关联起来，即使它们分散在不同服务器上，也能通过 TraceID 一键检索。

## 5. 本章小结

| 治理手段 | 核心目标 | 代表技术 |
|---------|---------|---------|
| 配置中心 | 集中管理，动态生效 | Nacos Config |
| 服务容错 | 阻止故障扩散 | 超时/重试/熔断 |
| 限流降级 | 保护系统不被打垮 | Sentinel |
| 链路追踪 | 让请求链路可见 | SkyWalking |

这四大手段共同构成了分布式系统的治理底座。配置中心解决"管理"问题，容错和限流解决"稳定性"问题，链路追踪解决"可观测"问题。

> 治理解决了稳定性和可观测性，但企业应用还差两块：安全和部署。身份认证怎么选型？密码怎么存储才不会被拖库？应用怎么打包才能在任何环境一致运行？下一章覆盖认证授权、数据安全和容器化部署。
