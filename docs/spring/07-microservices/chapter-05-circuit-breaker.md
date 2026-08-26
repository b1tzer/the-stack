# 熔断降级

## 1. Resilience4j

```java
@Service
public class UserService {
    @CircuitBreaker(name = "userService", fallbackMethod = "fallback")
    @RateLimiter(name = "userService")
    @Bulkhead(name = "userService")
    public User getUser(Long id) {
        return userClient.getUser(id);
    }
    
    public User fallback(Long id, Throwable t) {
        return new User(0L, "降级用户");
    }
}
```

## 2. 配置

```yaml
resilience4j:
  circuitbreaker:
    instances:
      userService:
        failure-rate-threshold: 50
        wait-duration-in-open-state: 5000
        sliding-window-size: 10
  ratelimiter:
    instances:
      userService:
        limit-for-period: 10
        limit-refresh-period: 1s
```

## 3. Resilience4j 高级配置

### 3.1 熔断器详解

```java
@Service
public class UserService {

    // 熔断 + 限流 + 隔离
    @CircuitBreaker(name = "userService", fallbackMethod = "getUserFallback")
    @RateLimiter(name = "userService")
    @Bulkhead(name = "userService")
    @TimeLimiter(name = "userService")
    public CompletableFuture<User> getUser(Long id) {
        return CompletableFuture.supplyAsync(() -> userClient.getUser(id));
    }

    // 降级方法：参数必须与原方法一致，最后加 Throwable
    private CompletableFuture<User> getUserFallback(Long id, Throwable t) {
        if (t instanceof CallNotPermittedException) {
            return CompletableFuture.completedFuture(new User(id, "服务熔断中", ""));
        } else if (t instanceof BulkheadFullException) {
            return CompletableFuture.completedFuture(new User(id, "服务繁忙", ""));
        }
        return CompletableFuture.completedFuture(new User(id, "降级用户", ""));
    }
}
```

```yaml
resilience4j:
  circuitbreaker:
    instances:
      userService:
        register-health-indicator: true
        failure-rate-threshold: 50           # 失败率 50% 触发熔断
        slow-call-rate-threshold: 80         # 慢调用率 80% 触发熔断
        slow-call-duration-threshold: 2s     # 超过 2s 算慢调用
        sliding-window-size: 10              # 统计窗口大小
        sliding-window-type: COUNT_BASED     # 基于调用次数
        minimum-number-of-calls: 5           # 最少 5 次调用才统计
        wait-duration-in-open-state: 10s     # 熔断持续 10 秒
        permitted-number-of-calls-in-half-open-state: 3  # 半开状态允许 3 次探测
        automatic-transition-from-open-to-half-open-enabled: true

  ratelimiter:
    instances:
      userService:
        limit-for-period: 10           # 每秒 10 个请求
        limit-refresh-period: 1s
        timeout-duration: 500ms        # 等待超时时间

  bulkhead:
    instances:
      userService:
        max-concurrent-calls: 25       # 最大并发数
        max-wait-duration: 500ms       # 等待超时

  timelimiter:
    instances:
      userService:
        timeout-duration: 3s           # 超时时间
        cancel-running-future: true    # 超时后取消正在执行的任务
```

### 3.2 重试配置

```java
@Service
public class ProductService {

    @Retry(name = "productService", fallbackMethod = "getProductFallback")
    public Product getProduct(Long id) {
        return productClient.getProduct(id);
    }

    private Product getProductFallback(Long id, Throwable t) {
        log.warn("商品服务降级, id={}", id, t);
        return new Product(id, "商品信息暂不可用", BigDecimal.ZERO);
    }
}
```

```yaml
resilience4j:
  retry:
    instances:
      productService:
        max-attempts: 3
        wait-duration: 500ms
        exponential-backoff-multiplier: 2
        retry-exceptions:
          - java.io.IOException
          - java.net.SocketTimeoutException
        ignore-exceptions:
          - com.example.BusinessException  # 业务异常不重试
```

### 3.3 熔断器状态监控

```java
@Component
public class CircuitBreakerMonitor {

    @Autowired
    private CircuitBreakerRegistry circuitBreakerRegistry;

    @Scheduled(fixedRate = 30000)
    public void monitor() {
        circuitBreakerRegistry.getAllCircuitBreakers().forEach(cb -> {
            CircuitBreaker.Metrics metrics = cb.getMetrics();
            log.info("熔断器 [{}] 状态={}, 失败率={}%, 慢调用率={}%, " +
                "调用次数={}, 失败次数={}, 不允许调用次数={}",
                cb.getName(), cb.getState(),
                metrics.getFailureRate(),
                metrics.getSlowCallRate(),
                metrics.getNumberOfTotalCalls(),
                metrics.getNumberOfFailedCalls(),
                metrics.getNumberOfNotPermittedCalls());
        });
    }
}
```

### 3.4 Resilience4j vs Sentinel 对比

| 特性 | Resilience4j | Sentinel |
|------|-------------|----------|
| 实现方式 | 装饰器模式，函数式 | 滑动窗口统计 |
| 隔离 | 信号量 + 线程池 | 信号量 |
| 流控效果 | 简单限流 | 预热、排队、关联 |
| 热点参数 | ❌ | ✅ |
| 管控台 | 无独立控制台 | ✅ Dashboard |
| 适用场景 | 函数式、轻量级 | 大规模流控治理 |

**最佳实践：**

1. **熔断器必须有降级**——熔断后返回兜底数据，而不是抛异常
2. **重试只对幂等操作**——创建订单等非幂等操作不能重试
3. **隔离策略选择**——CPU 密集用信号量隔离，IO 密集用线程池隔离
4. **熔断阈值要根据业务调整**——不能所有服务用同一个阈值
5. **监控是必须的**——熔断器状态、调用次数、失败率都要有监控

## 4. 熔断器状态机原理

### 4.1 三状态模型

熔断器模式借鉴了电路中的保险丝思想，通过**有限状态机**控制请求流向：

```
                    失败率 ≥ 阈值
   ┌──────────┐  ──────────────→  ┌──────────┐
   │  CLOSED  │                   │   OPEN   │
   │ (正常放行) │  ←──────────────  │ (快速失败) │
   └──────────┘    探测成功        └──────────┘
        ↑                              │
        │         等待时间结束           │
        │         ┌──────────┐         │
        └────────  │ HALF_OPEN│  ───────┘
          探测成功  │ (探测放行) │  探测失败
                   └──────────┘
```

| 状态 | 行为 | 转换条件 |
|------|------|----------|
| **CLOSED** | 正常放行所有请求 | 失败率/慢调用率超过阈值 → OPEN |
| **OPEN** | 直接拒绝请求，快速失败 | 等待时间结束 → HALF_OPEN |
| **HALF_OPEN** | 允许有限次探测请求 | 探测成功 → CLOSED；探测失败 → OPEN |

### 4.2 状态转换触发条件

```java
/**
 * 状态转换示意（以 Resilience4j 为例）
 *
 * CLOSED → OPEN:
 *   - 滑动窗口内失败率 ≥ failure-rate-threshold (默认50%)
 *   - 或慢调用率 ≥ slow-call-rate-threshold (默认100%)
 *   - 且总调用次数 ≥ minimum-number-of-calls
 *
 * OPEN → HALF_OPEN:
 *   - wait-duration-in-open-state 超时后自动转换
 *   - 或手动调用 circuitBreaker.transitionToHalfOpenState()
 *
 * HALF_OPEN → CLOSED:
 *   - 探测请求全部成功（或成功率满足阈值）
 *
 * HALF_OPEN → OPEN:
 *   - 任一探测请求失败
 */
```

### 4.3 滑动窗口机制

Resilience4j 提供两种滑动窗口统计方式：

| 类型 | 配置 | 说明 | 适用场景 |
|------|------|------|----------|
| **COUNT_BASED** | `sliding-window-type: COUNT_BASED` | 基于最近 N 次调用统计 | 调用量稳定的场景 |
| **TIME_BASED** | `sliding-window-type: TIME_BASED` | 基于最近 N 秒内调用统计 | 调用量波动大的场景 |

```yaml
# 时间窗口示例：统计最近 60 秒的调用
resilience4j:
  circuitbreaker:
    instances:
      orderService:
        sliding-window-type: TIME_BASED
        sliding-window-size: 60           # 60 秒窗口
        minimum-number-of-calls: 20       # 最少 20 次才统计
        failure-rate-threshold: 50
```

## 5. 熔断与降级的区别

### 5.1 概念辨析

| 维度 | 熔断（Circuit Breaker） | 降级（Fallback / Degradation） |
|------|------------------------|-------------------------------|
| **本质** | 一种保护机制，自动切断故障链路 | 一种兜底策略，返回备选结果 |
| **触发方式** | 自动触发（基于失败率/慢调用率） | 手动触发或被动触发（异常/超时） |
| **作用范围** | 针对某个依赖服务 | 针对整个业务功能 |
| **表现形式** | 直接拒绝请求，快速失败 | 返回兜底数据或走备用逻辑 |
| **恢复方式** | 自动恢复（半开→关闭） | 需要人工或定时恢复 |

**核心关系：** 熔断是触发条件，降级是执行动作。熔断器打开后，执行降级逻辑返回兜底数据。

### 5.2 适用场景

```
场景 1：下游服务超时严重
  → 熔断器检测到慢调用率过高 → 自动熔断 → 返回降级数据

场景 2：非核心功能不可用（如推荐服务）
  → 直接降级，返回默认推荐列表，不需要熔断器

场景 3：大促期间主动降级
  → 人工关闭评论、推荐等功能，释放资源给核心交易链路

场景 4：依赖服务偶发异常
  → 重试 + 降级，不需要熔断（异常率未达阈值）
```

### 5.3 代码中的体现

```java
@Service
public class OrderService {

    // 熔断 + 降级：熔断器触发后走 fallback
    @CircuitBreaker(name = "paymentService", fallbackMethod = "paymentFallback")
    public PayResult pay(Order order) {
        return paymentClient.process(order);
    }

    // 降级方法：熔断、异常、超时都会走这里
    private PayResult paymentFallback(Order order, Throwable t) {
        if (t instanceof CallNotPermittedException) {
            log.warn("支付服务已熔断，订单{}进入待支付队列", order.getId());
            pendingPayQueue.add(order);
            return PayResult.pending("系统繁忙，已加入待支付队列");
        }
        return PayResult.fail("支付暂时不可用，请稍后重试");
    }

    // 纯降级：非核心功能，不需要熔断器
    public List<RecommendItem> getRecommendations(Long userId) {
        try {
            return recommendClient.getRecommendations(userId);
        } catch (Exception e) {
            log.warn("推荐服务不可用，返回默认推荐", e);
            return getDefaultRecommendations();
        }
    }
}
```

## 6. Sentinel 集成

### 6.1 Spring Cloud 集成

```xml
<!-- pom.xml -->
<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-sentinel</artifactId>
</dependency>
<dependency>
    <groupId>com.alibaba.csp</groupId>
    <artifactId>sentinel-datasource-nacos</artifactId>    <!-- 规则持久化 -->
</dependency>
```

```yaml
spring:
  cloud:
    sentinel:
      transport:
        dashboard: localhost:8080       # Sentinel Dashboard 地址
        port: 8719                      # 与 Dashboard 通信端口
      eager: true                       # 立即初始化，而非首次请求时
      datasource:
        flow:                           # 流控规则数据源
          nacos:
            server-addr: ${spring.cloud.nacos.server-addr}
            dataId: sentinel-flow-rules
            groupId: SENTINEL_GROUP
            rule-type: flow
        degrade:                        # 降级规则数据源
          nacos:
            server-addr: ${spring.cloud.nacos.server-addr}
            dataId: sentinel-degrade-rules
            groupId: SENTINEL_GROUP
            rule-type: degrade
```

### 6.2 流控规则

```java
@Configuration
public class SentinelConfig {

    @PostConstruct
    public void initFlowRules() {
        List<FlowRule> rules = new ArrayList<>();

        // 规则 1：QPS 限流
        FlowRule qpsRule = new FlowRule();
        qpsRule.setResource("getUser");
        qpsRule.setGrade(RuleConstant.FLOW_GRADE_QPS);   // QPS 维度
        qpsRule.setCount(100);                             // 阈值 100 QPS
        qpsRule.setControlBehavior(
            RuleConstant.CONTROL_BEHAVIOR_WARM_UP);       // 预热模式
        qpsRule.setWarmUpPeriodSec(10);                   // 预热 10 秒
        rules.add(qpsRule);

        // 规则 2：并发线程数限流
        FlowRule threadRule = new FlowRule();
        threadRule.setResource("createOrder");
        threadRule.setGrade(RuleConstant.FLOW_GRADE_THREAD); // 线程数维度
        threadRule.setCount(50);                              // 最大 50 并发
        threadRule.setControlBehavior(
            RuleConstant.CONTROL_BEHAVIOR_RATE_LIMITER);     // 排队等待
        threadRule.setMaxQueueingTimeMs(500);                 // 排队超时 500ms
        rules.add(threadRule);

        FlowRuleManager.loadRules(rules);
    }
}
```

| 流控效果 | 说明 | 适用场景 |
|----------|------|----------|
| **快速失败** | 超出阈值立即拒绝 | 大多数场景 |
| **Warm Up** | 预热期逐步提升阈值 | 启动阶段、冷启动 |
| **排队等待** | 匀速排队，超时拒绝 | 削峰填谷 |
| **Warm Up + 排队** | 预热后匀速排队 | 复杂场景 |

### 6.3 热点参数限流

热点参数限流是 Sentinel 的独特能力，可以对**特定参数值**单独设置限流阈值：

```java
@Service
public class ProductService {

    @SentinelResource(value = "getProduct",
        blockHandler = "getProductBlockHandler")
    public Product getProduct(@RequestParam Long id,
                               @RequestParam String category) {
        return productMapper.selectById(id);
    }

    public Product getProductBlockHandler(Long id, String category,
                                           BlockException ex) {
        log.warn("商品{}被限流", id);
        return Product.defaultProduct();
    }
}
```

```java
@PostConstruct
public void initParamFlowRules() {
    ParamFlowRule rule = new ParamFlowRule("getProduct")
        .setParamIdx(0)                          // 对第 0 个参数(id)限流
        .setGrade(RuleConstant.FLOW_GRADE_QPS)
        .setCount(200);                          // 默认 QPS 阈值 200

    // 特殊值：热门商品 id=1 单独限流
    ParamFlowItem item = new ParamFlowItem()
        .setObject(String.valueOf(1))            // 参数值
        .setClassType(long.class.getName())
        .setCount(50);                           // 热门商品限 50 QPS
    rule.setParamFlowItemList(Collections.singletonList(item));

    ParamFlowRuleManager.loadRules(Collections.singletonList(rule));
}
```

### 6.4 Sentinel 降级规则

```java
@PostConstruct
public void initDegradeRules() {
    List<DegradeRule> rules = new ArrayList<>();

    // 慢调用比例熔断
    DegradeRule slowRule = new DegradeRule();
    slowRule.setResource("getUser");
    slowRule.setGrade(CircuitBreakerStrategy.SLOW_REQUEST_RATIO.getType());
    slowRule.setCount(0.5);                   // 慢调用比例 50%
    slowRule.setSlowRatioThresholdMs(2000);   // 超过 2s 算慢调用
    slowRule.setTimeWindow(10);               // 熔断持续 10 秒
    slowRule.setMinRequestAmount(10);         // 最少 10 次请求
    slowRule.setStatIntervalMs(10000);        // 统计窗口 10 秒
    rules.add(slowRule);

    // 异常比例熔断
    DegradeRule errorRule = new DegradeRule();
    errorRule.setResource("createOrder");
    errorRule.setGrade(CircuitBreakerStrategy.ERROR_RATIO.getType());
    errorRule.setCount(0.3);                  // 异常比例 30%
    errorRule.setTimeWindow(30);              // 熔断持续 30 秒
    errorRule.setMinRequestAmount(20);
    rules.add(errorRule);

    DegradeRuleManager.loadRules(rules);
}
```

## 7. 生产环境实战

### 7.1 熔断阈值调优策略

阈值设置没有银弹，需要根据业务特点和历史数据调整：

| 参数 | 默认值 | 调优建议 | 说明 |
|------|--------|----------|------|
| `failure-rate-threshold` | 50% | 核心链路 30-40%，非核心 50-60% | 核心链路应更敏感 |
| `slow-call-rate-threshold` | 100% | 60-80% | 慢调用往往是故障前兆 |
| `slow-call-duration-threshold` | 60s | 根据 P99 延迟设置 | 一般设为 P99 的 1.5-2 倍 |
| `sliding-window-size` | 100 | QPS 高时用 COUNT，低时用 TIME | 确保窗口内有足够样本 |
| `minimum-number-of-calls` | 10 | 不低于窗口大小的 50% | 避免少量调用误触发 |
| `wait-duration-in-open-state` | 60s | 核心 5-10s，非核心 30-60s | 核心链路需要快速恢复探测 |

```yaml
# 生产环境推荐配置示例
resilience4j:
  circuitbreaker:
    instances:
      # 核心链路：敏感、快速恢复
      paymentService:
        failure-rate-threshold: 30
        slow-call-rate-threshold: 60
        slow-call-duration-threshold: 1500ms
        sliding-window-type: TIME_BASED
        sliding-window-size: 30
        minimum-number-of-calls: 10
        wait-duration-in-open-state: 5s
        permitted-number-of-calls-in-half-open-state: 5

      # 非核心链路：宽松、快速失败
      recommendService:
        failure-rate-threshold: 60
        slow-call-rate-threshold: 80
        slow-call-duration-threshold: 3s
        sliding-window-type: COUNT_BASED
        sliding-window-size: 20
        minimum-number-of-calls: 10
        wait-duration-in-open-state: 30s
        permitted-number-of-calls-in-half-open-state: 3
```

### 7.2 调优方法论

```
1. 基线采集
   → 正常负载下收集 1-2 周的调用数据
   → 关注 P50/P95/P99 延迟、错误率分布

2. 阈值初设
   → 失败率阈值 = 正常错误率 × 3~5 倍
   → 慢调用阈值 = P99 延迟 × 1.5~2 倍

3. 压测验证
   → 使用 Chaos Engineering 注入故障
   → 验证熔断是否及时触发
   → 验证恢复是否平滑

4. 线上观察
   → 灰度上线，观察误熔断情况
   → 根据实际调用量调整窗口大小

5. 持续迭代
   → 每次大促后复盘阈值设置
   → 根据业务变化动态调整
```

### 7.3 Prometheus 监控集成

Resilience4j 原生支持 Micrometer 指标导出，可直接对接 Prometheus：

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
        include: health,prometheus,metrics
  metrics:
    tags:
      application: ${spring.application.name}
```

**核心监控指标：**

| 指标名 | 类型 | 说明 |
|--------|------|------|
| `resilience4j_circuitbreaker_state` | Gauge | 熔断器状态（0=CLOSED, 1=OPEN, 2=HALF_OPEN） |
| `resilience4j_circuitbreaker_failure_rate` | Gauge | 当前失败率 |
| `resilience4j_circuitbreaker_slow_call_rate` | Gauge | 当前慢调用率 |
| `resilience4j_circuitbreaker_calls_seconds` | Timer | 调用耗时分布 |
| `resilience4j_circuitbreaker_not_permitted_calls` | Counter | 被拒绝的调用次数 |
| `resilience4j_ratelimiter_available_permissions` | Gauge | 限流器剩余许可数 |
| `resilience4j_bulkhead_available_concurrent_calls` | Gauge | 隔离器剩余并发数 |

**Prometheus 告警规则：**

```yaml
# prometheus-alert-rules.yml
groups:
  - name: circuit-breaker-alerts
    rules:
      # 熔断器打开告警
      - alert: CircuitBreakerOpen
        expr: resilience4j_circuitbreaker_state{state="open"} == 1
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "熔断器 {{ $labels.name }} 已打开"
          description: "服务 {{ $labels.name }} 熔断器处于 OPEN 状态超过 1 分钟"

      # 失败率突增告警
      - alert: HighFailureRate
        expr: resilience4j_circuitbreaker_failure_rate > 30
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "{{ $labels.name }} 失败率 {{ $value }}%"

      # 被拒绝调用突增
      - alert: CircuitBreakerRejections
        expr: rate(resilience4j_circuitbreaker_not_permitted_calls_total[5m]) > 10
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "{{ $labels.name }} 每秒拒绝超过 10 个请求"

      # 限流触发告警
      - alert: RateLimiterThrottling
        expr: resilience4j_ratelimiter_available_permissions == 0
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "限流器 {{ $labels.name }} 许可已耗尽"
```

### 7.4 Grafana Dashboard 配置

```json
{
  "panels": [
    {
      "title": "熔断器状态",
      "type": "stat",
      "targets": [
        {
          "expr": "resilience4j_circuitbreaker_state",
          "legendFormat": "{{ name }}"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "mappings": [
            { "type": "value", "options": { "0": { "text": "CLOSED", "color": "green" } } },
            { "type": "value", "options": { "1": { "text": "OPEN", "color": "red" } } },
            { "type": "value", "options": { "2": { "text": "HALF_OPEN", "color": "yellow" } } }
          ]
        }
      }
    },
    {
      "title": "失败率趋势",
      "type": "timeseries",
      "targets": [
        {
          "expr": "resilience4j_circuitbreaker_failure_rate",
          "legendFormat": "{{ name }}"
        }
      ]
    },
    {
      "title": "被拒绝调用速率",
      "type": "timeseries",
      "targets": [
        {
          "expr": "rate(resilience4j_circuitbreaker_not_permitted_calls_total[1m])",
          "legendFormat": "{{ name }}"
        }
      ]
    }
  ]
}
```

### 7.5 生产环境检查清单

- [ ] **降级兜底**——每个熔断器都有 fallback，不抛裸异常
- [ ] **阈值分层**——核心链路敏感阈值，非核心链路宽松阈值
- [ ] **窗口合理**——窗口内有足够统计样本（建议 ≥20 次调用）
- [ ] **恢复探测**——半开状态探测次数 ≥3，避免单次成功就关闭
- [ ] **监控告警**——Prometheus + Grafana 全链路可观测
- [ ] **日志完整**——熔断状态变更、降级触发都有日志
- [ ] **压测验证**——上线前 Chaos Engineering 验证熔断效果
- [ ] **规则持久化**——Sentinel 规则持久化到 Nacos，避免重启丢失
- [ ] **超时联动**——服务超时 < 网关超时 < 客户端超时
- [ ] **定期复盘**——大促后复盘阈值，根据业务变化调整
