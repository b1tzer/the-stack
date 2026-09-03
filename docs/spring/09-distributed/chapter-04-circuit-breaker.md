# 服务容错

> 一个依赖服务挂了，如果不做保护，请求会持续超时堆积，最终拖垮整个系统——这就是级联故障。熔断器的作用就像电路中的保险丝：检测到异常达到阈值后，快速失败而不是继续等待。

## 1. Resilience4j 熔断器

### 1.1 三状态模型

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
| :-- | :-- | :-- |
| **CLOSED** | 正常放行所有请求 | 失败率/慢调用率超过阈值 → OPEN |
| **OPEN** | 直接拒绝请求，快速失败 | 等待时间结束 → HALF_OPEN |
| **HALF_OPEN** | 允许有限次探测请求 | 探测成功 → CLOSED；探测失败 → OPEN |

### 1.2 依赖与配置

```xml
<dependency>
    <groupId>io.github.resilience4j</groupId>
    <artifactId>resilience4j-spring-boot3</artifactId>
    <version>2.2.0</version>
</dependency>
```

```yaml
resilience4j:
  circuitbreaker:
    instances:
      paymentService:
        register-health-indicator: true
        failure-rate-threshold: 50
        slow-call-rate-threshold: 80
        slow-call-duration-threshold: 2s
        sliding-window-size: 10
        sliding-window-type: COUNT_BASED
        minimum-number-of-calls: 5
        wait-duration-in-open-state: 10s
        permitted-number-of-calls-in-half-open-state: 3
        automatic-transition-from-open-to-half-open-enabled: true

  ratelimiter:
    instances:
      apiLimiter:
        limit-for-period: 100
        limit-refresh-period: 1s
        timeout-duration: 500ms

  bulkhead:
    instances:
      orderBulkhead:
        max-concurrent-calls: 25
        max-wait-duration: 500ms

  retry:
    instances:
      remoteCall:
        max-attempts: 3
        wait-duration: 500ms
        exponential-backoff-multiplier: 2
        enable-exponential-backoff: true
        retry-exceptions:
          - java.io.IOException
          - java.net.SocketTimeoutException
        ignore-exceptions:
          - com.example.BusinessException

  timelimiter:
    instances:
      remoteCall:
        timeout-duration: 5s
        cancel-running-future: true
```

### 1.3 使用示例

```java
@Service
@Slf4j
public class PaymentService {

    private final PaymentFeignClient paymentClient;

    public PaymentService(PaymentFeignClient paymentClient) {
        this.paymentClient = paymentClient;
    }

    /**
     * 熔断 + 限流 + 隔离 + 超时
     */
    @CircuitBreaker(name = "paymentService", fallbackMethod = "paymentFallback")
    @RateLimiter(name = "apiLimiter")
    @Bulkhead(name = "orderBulkhead")
    @TimeLimiter(name = "remoteCall")
    public CompletableFuture<PayResult> pay(PayRequest request) {
        return CompletableFuture.supplyAsync(() -> paymentClient.pay(request));
    }

    /**
     * 降级方法：参数必须与原方法一致，最后加 Throwable
     */
    private CompletableFuture<PayResult> paymentFallback(PayRequest request, Throwable t) {
        if (t instanceof CallNotPermittedException) {
            log.warn("支付服务已熔断，订单{}进入待支付队列", request.getOrderId());
            pendingPayQueue.add(request);
            return CompletableFuture.completedFuture(PayResult.pending("系统繁忙，已加入待支付队列"));
        } else if (t instanceof BulkheadFullException) {
            return CompletableFuture.completedFuture(PayResult.fail("服务繁忙"));
        }
        return CompletableFuture.completedFuture(PayResult.fail("支付暂时不可用，请稍后重试"));
    }
}
```

> **踩坑提醒**：
> - `minimum-number-of-calls` 设置太小会导致熔断器过于敏感
> - 熔断器实例是 **按名称隔离** 的，不同服务应使用不同的实例名
> - 降级方法的参数列表必须与原方法完全一致，外加一个 `Throwable` 参数

## 2. 限流与降级

```java
@Service
@Slf4j
public class ApiService {

    @RateLimiter(name = "apiLimiter", fallbackMethod = "rateLimitFallback")
    public String queryData(String param) {
        return "查询结果: " + param;
    }

    private String rateLimitFallback(String param, Throwable throwable) {
        log.warn("接口限流触发, param={}", param);
        return "系统繁忙，请稍后重试";
    }

    @Bulkhead(name = "orderBulkhead", fallbackMethod = "bulkheadFallback")
    public OrderVO getOrder(Long orderId) {
        return orderQueryService.getDetail(orderId);
    }

    private OrderVO bulkheadFallback(Long orderId, Throwable throwable) {
        log.warn("舱壁隔离触发, orderId={}", orderId);
        return orderCacheService.getCachedOrder(orderId);
    }
}
```

限流算法对比：

| 算法 | 原理 | 优点 | 缺点 |
| :-- | :-- | :-- | :-- |
| 固定窗口 | 固定时间段内计数 | 实现简单 | 窗口边界突发流量 |
| 滑动窗口 | 滑动时间窗口计数 | 平滑 | 实现复杂 |
| 令牌桶 | 固定速率放入令牌 | 允许一定突发 | 需要定时器 |
| 漏桶 | 固定速率处理请求 | 流量完全平滑 | 无法应对突发 |

## 3. 重试与超时

```java
@Service
@Slf4j
public class RetryService {

    /**
     * 组合使用重试 + 超时 + 熔断
     * 执行顺序：Retry → CircuitBreaker → TimeLimiter（从外到内）
     */
    @Retry(name = "remoteCall")
    @CircuitBreaker(name = "remoteCall")
    @TimeLimiter(name = "remoteCall")
    public CompletableFuture<String> callRemote(String param) {
        return CompletableFuture.supplyAsync(() -> {
            log.info("调用远程服务: {}", param);
            return remoteClient.process(param);
        });
    }

    /**
     * 手动实现带指数退避的重试
     */
    public <T> T retryWithBackoff(Callable<T> task, int maxRetries, long initialDelay) {
        Exception lastException = null;
        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return task.call();
            } catch (Exception e) {
                lastException = e;
                if (attempt < maxRetries) {
                    long delay = initialDelay * (1L << attempt);
                    log.warn("第 {} 次重试失败, {}ms 后重试: {}", attempt + 1, delay, e.getMessage());
                    try {
                        Thread.sleep(delay);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw new RuntimeException("重试被中断", ie);
                    }
                }
            }
        }
        throw new RuntimeException("重试 " + maxRetries + " 次后仍然失败", lastException);
    }
}
```

重试风暴风险与应对：

| 风险 | 描述 | 应对 |
| :-- | :-- | :-- |
| 放大故障 | A 重试 B，B 重试 C，指数级增长 | 设置重试预算 |
| 惊群效应 | 所有客户端同时重试 | 加随机抖动（jitter） |
| 幂等破坏 | 非幂等操作被重复执行 | 确保重试接口幂等 |
| 资源耗尽 | 重试占用线程/连接池 | 结合熔断器使用 |

> **踩坑提醒**：`@Retry` + `@CircuitBreaker` + `@TimeLimiter` 组合使用时，**顺序很重要**。正确的注解顺序是 Retry 在最外层，CircuitBreaker 在中间，TimeLimiter 在最内层。

## 4. 熔断与降级的区别

| 维度 | 熔断（Circuit Breaker） | 降级（Fallback） |
| :-- | :-- | :-- |
| **本质** | 保护机制，自动切断故障链路 | 兜底策略，返回备选结果 |
| **触发方式** | 自动（基于失败率/慢调用率） | 手动或被动（异常/超时） |
| **作用范围** | 针对某个依赖服务 | 针对整个业务功能 |
| **表现形式** | 直接拒绝请求 | 返回兜底数据 |
| **恢复方式** | 自动恢复（半开→关闭） | 需要人工或定时恢复 |

**核心关系**：熔断是触发条件，降级是执行动作。熔断器打开后，执行降级逻辑返回兜底数据。

## 5. 熔断阈值调优

| 参数 | 默认值 | 调优建议 | 说明 |
| :-- | :-- | :-- | :-- |
| `failure-rate-threshold` | 50% | 核心链路 30-40%，非核心 50-60% | 核心链路应更敏感 |
| `slow-call-rate-threshold` | 100% | 60-80% | 慢调用往往是故障前兆 |
| `slow-call-duration-threshold` | 60s | 根据 P99 延迟设置 | 一般设为 P99 的 1.5-2 倍 |
| `sliding-window-size` | 100 | QPS 高时用 COUNT，低时用 TIME | 确保窗口内有足够样本 |
| `minimum-number-of-calls` | 10 | 不低于窗口大小的 50% | 避免少量调用误触发 |
| `wait-duration-in-open-state` | 60s | 核心 5-10s，非核心 30-60s | 核心链路需要快速恢复探测 |

**调优方法论**：

```
1. 基线采集 → 正常负载下收集 1-2 周的调用数据
2. 阈值初设 → 失败率阈值 = 正常错误率 × 3~5 倍
3. 压测验证 → 使用 Chaos Engineering 注入故障
4. 线上观察 → 灰度上线，观察误熔断情况
5. 持续迭代 → 每次大促后复盘阈值设置
```

## 6. Prometheus 监控集成

```xml
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
</dependency>
```

核心监控指标：

| 指标名 | 类型 | 说明 |
| :-- | :-- | :-- |
| `resilience4j_circuitbreaker_state` | Gauge | 熔断器状态（0=CLOSED, 1=OPEN, 2=HALF_OPEN） |
| `resilience4j_circuitbreaker_failure_rate` | Gauge | 当前失败率 |
| `resilience4j_circuitbreaker_slow_call_rate` | Gauge | 当前慢调用率 |
| `resilience4j_circuitbreaker_calls_seconds` | Timer | 调用耗时分布 |
| `resilience4j_circuitbreaker_not_permitted_calls` | Counter | 被拒绝的调用次数 |

## 7. Resilience4j vs Sentinel 对比

| 特性 | Resilience4j | Sentinel |
| :-- | :-- | :-- |
| 实现方式 | 装饰器模式，函数式 | 滑动窗口统计 |
| 隔离 | 信号量 + 线程池 | 信号量 |
| 流控效果 | 简单限流 | 预热、排队、关联 |
| 热点参数 | ❌ | ✅ |
| 管控台 | 无独立控制台 | ✅ Dashboard |
| 适用场景 | 函数式、轻量级 | 大规模流控治理 |

## 8. 生产环境检查清单

- [ ] **降级兜底**——每个熔断器都有 fallback，不抛裸异常
- [ ] **阈值分层**——核心链路敏感阈值，非核心链路宽松阈值
- [ ] **窗口合理**——窗口内有足够统计样本（建议 ≥20 次调用）
- [ ] **恢复探测**——半开状态探测次数 ≥3
- [ ] **监控告警**——Prometheus + Grafana 全链路可观测
- [ ] **日志完整**——熔断状态变更、降级触发都有日志
- [ ] **超时联动**——服务超时 < 网关超时 < 客户端超时
- [ ] **定期复盘**——大促后复盘阈值，根据业务变化调整
