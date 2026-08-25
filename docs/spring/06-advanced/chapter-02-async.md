# 异步处理

## 1. @Async

```java
@Configuration
@EnableAsync
public class AsyncConfig {
    @Bean("taskExecutor")
    public Executor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(10);
        executor.setMaxPoolSize(50);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("async-");
        return executor;
    }
}

@Service
public class NotificationService {
    @Async("taskExecutor")
    public CompletableFuture<String> sendEmail(String to) {
        // 异步发送邮件
        return CompletableFuture.completedFuture("sent");
    }
}
```

## 2. CompletableFuture

```java
public CompletableFuture<User> getUserAsync(Long id) {
    return CompletableFuture.supplyAsync(() -> userRepository.findById(id))
        .thenApply(user -> enrichUser(user))
        .exceptionally(ex -> getDefaultUser());
}
```

## 3. 异步处理高级用法

### 3.1 异步异常处理

```java
@Configuration
@EnableAsync
public class AsyncConfig implements AsyncConfigurer {

    @Override
    public Executor getAsyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(10);
        executor.setMaxPoolSize(50);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("async-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.initialize();
        return executor;
    }

    // 全局异步异常处理器
    @Override
    public AsyncUncaughtExceptionHandler getAsyncUncaughtExceptionHandler() {
        return (ex, method, params) -> {
            log.error("异步方法 {} 执行异常, 参数: {}", method.getName(), params, ex);
            // 发送告警
            alertService.sendAlert("异步任务失败: " + method.getName(), ex.getMessage());
        };
    }
}
```

### 3.2 CompletableFuture 组合异步操作

```java
@Service
public class AsyncOrderService {

    @Autowired
    private UserClient userClient;
    @Autowired
    private ProductClient productClient;
    @Autowired
    private InventoryClient inventoryClient;

    // 并发调用多个服务，合并结果
    public CompletableFuture<OrderDetail> getOrderDetail(Long orderId) {
        CompletableFuture<User> userFuture = CompletableFuture.supplyAsync(
            () -> userClient.getUser(orderId));

        CompletableFuture<Product> productFuture = CompletableFuture.supplyAsync(
            () -> productClient.getProduct(orderId));

        CompletableFuture<Inventory> inventoryFuture = CompletableFuture.supplyAsync(
            () -> inventoryClient.getInventory(orderId));

        // 等待所有结果
        return CompletableFuture.allOf(userFuture, productFuture, inventoryFuture)
            .thenApply(v -> new OrderDetail(
                userFuture.join(),
                productFuture.join(),
                inventoryFuture.join()
            ));
    }

    // 超时控制
    public CompletableFuture<String> callWithTimeout(Long id) {
        return CompletableFuture.supplyAsync(() -> externalService.call(id))
            .orTimeout(3, TimeUnit.SECONDS)  // Java 9+
            .exceptionally(ex -> "降级结果");
    }
}
```

### 3.3 异步方法的事务问题

```java
@Service
public class OrderService {

    // ❌ 错误：@Async 和 @Transactional 不能在同一方法上使用
    // @Async 方法在独立线程执行，无法加入调用方的事务
    @Async
    @Transactional  // 事务不生效！
    public void processAsync(Long orderId) { /* ... */ }

    // ✅ 正确：拆分为两个方法
    @Transactional
    public void createOrder(OrderRequest request) {
        Order order = orderRepository.save(new Order(request));
        // 事务提交后再异步处理
    }

    @Async
    public void postProcess(Long orderId) {
        // 这里是独立的事务
        Order order = orderRepository.findById(orderId).orElseThrow();
        // 处理后续逻辑
    }
}
```

### 3.4 响应式异步（WebClient）

```java
@Service
public class ReactiveUserService {

    private final WebClient webClient;

    public ReactiveUserService(WebClient.Builder builder) {
        this.webClient = builder.baseUrl("http://user-service").build();
    }

    public Mono<User> getUser(Long id) {
        return webClient.get()
            .uri("/api/users/{id}", id)
            .retrieve()
            .bodyToMono(User.class)
            .timeout(Duration.ofSeconds(3))
            .retryWhen(Retry.backoff(2, Duration.ofMillis(500)))
            .onErrorResume(ex -> Mono.just(User.anonymous()));
    }
}
```

### 3.5 异步上下文传递

`@Async` 方法在独立线程中执行，`ThreadLocal` 中的上下文（如 `SecurityContext`、`TraceId`、用户信息）会丢失。Spring 提供 `TaskDecorator` 接口解决此问题。

```java
/**
 * 将主线程的上下文传递到异步线程
 */
public class ContextPropagationDecorator implements TaskDecorator {

    @Override
    public Runnable decorate(Runnable runnable) {
        // 在主线程中捕获上下文
        RequestAttributes requestAttributes = RequestContextHolder.getRequestAttributes();
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        String traceId = MDC.get("traceId");

        return () -> {
            try {
                // 在异步线程中恢复上下文
                RequestContextHolder.setRequestAttributes(requestAttributes);
                SecurityContextHolder.getContext().setAuthentication(authentication);
                MDC.put("traceId", traceId);
                runnable.run();
            } finally {
                // 清理，防止线程复用导致上下文泄漏
                RequestContextHolder.resetRequestAttributes();
                SecurityContextHolder.clearContext();
                MDC.clear();
            }
        };
    }
}
```

配置线程池时注入 `TaskDecorator`：

```java
@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean("taskExecutor")
    public Executor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(10);
        executor.setMaxPoolSize(50);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("async-");
        // 注入上下文传递装饰器
        executor.setTaskDecorator(new ContextPropagationDecorator());
        executor.initialize();
        return executor;
    }
}
```

> **注意**：如果使用 Sleuth / Micrometer Tracing，框架会自动注入 `TaskDecorator` 实现 TraceId 传递，无需手动编写。

### 3.6 异步超时控制

异步任务可能因下游服务卡死而无限等待，必须设置超时。

```java
@Service
public class AsyncTimeoutService {

    // 方式一：CompletableFuture.orTimeout（Java 9+）
    public CompletableFuture<String> callWithOrTimeout(Long id) {
        return CompletableFuture.supplyAsync(() -> externalService.call(id), taskExecutor)
            .orTimeout(3, TimeUnit.SECONDS)  // 超时抛 TimeoutException
            .exceptionally(ex -> {
                if (ex instanceof TimeoutException) {
                    log.warn("调用超时: id={}", id);
                    return "降级结果";
                }
                throw new CompletionException(ex);
            });
    }

    // 方式二：completeOnTimeout（超时返回默认值，不抛异常）
    public CompletableFuture<String> callWithDefault(Long id) {
        return CompletableFuture.supplyAsync(() -> externalService.call(id), taskExecutor)
            .completeOnTimeout("默认值", 3, TimeUnit.SECONDS);
    }

    // 方式三：自定义超时控制（Java 8 兼容）
    public <T> CompletableFuture<T> withTimeout(CompletableFuture<T> future, long timeout, TimeUnit unit) {
        CompletableFuture<T> timeoutFuture = new CompletableFuture<>();
        ScheduledFuture<?> scheduled = scheduler.schedule(
            () -> timeoutFuture.completeExceptionally(new TimeoutException()),
            timeout, unit);
        // 任一完成则取消另一个
        future.whenComplete((v, ex) -> {
            scheduled.cancel(false);
            if (ex != null) timeoutFuture.completeExceptionally(ex);
            else timeoutFuture.complete(v);
        });
        return timeoutFuture;
    }
}
```

| 方式 | 超时行为 | Java 版本 | 适用场景 |
|------|---------|-----------|----------|
| `orTimeout` | 抛 `TimeoutException` | 9+ | 需要感知超时并做特殊处理 |
| `completeOnTimeout` | 返回默认值 | 9+ | 超时后有合理的降级值 |
| 自定义封装 | 可自定义 | 8+ | 需要兼容 Java 8 或更细粒度控制 |
| WebClient `.timeout()` | 抛 `TimeoutException` | 响应式 | 基于 WebClient 的 HTTP 调用 |

### 3.7 异步方法的异常处理详解

异步方法的异常处理取决于返回类型，两者机制完全不同。

#### 返回 `void` 的异常处理

`void` 返回值的异步方法，异常不会抛回调用方，必须通过 `AsyncUncaughtExceptionHandler` 捕获：

```java
@Configuration
@EnableAsync
public class AsyncConfig implements AsyncConfigurer {

    @Override
    public Executor getAsyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(10);
        executor.setMaxPoolSize(50);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("async-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.initialize();
        return executor;
    }

    @Override
    public AsyncUncaughtExceptionHandler getAsyncUncaughtExceptionHandler() {
        return new SimpleAsyncUncaughtExceptionHandler() {
            @Override
            public void handleUncaughtException(Throwable ex, Method method, Object... params) {
                log.error("异步方法异常: {}.{}(), params={}",
                    method.getDeclaringClass().getSimpleName(),
                    method.getName(), Arrays.toString(params), ex);

                // 按异常类型分级处理
                if (ex instanceof BusinessRuleException) {
                    // 业务异常：记录日志即可
                    log.warn("业务规则异常: {}", ex.getMessage());
                } else if (ex instanceof TransientDataAccessException) {
                    // 瞬时故障：触发重试
                    retryService.retry(method, params);
                } else {
                    // 未知异常：发送告警
                    alertService.sendAlert("异步任务异常", ex);
                }
            }
        };
    }
}
```

#### 返回 `CompletableFuture` 的异常处理

`CompletableFuture` 返回值的异常会封装在 Future 中，由调用方处理：

```java
@Service
public class AsyncFutureService {

    // 异常链：exceptionally → 处理异常并提供降级值
    public CompletableFuture<Order> getOrder(Long id) {
        return CompletableFuture.supplyAsync(() -> orderClient.fetch(id), taskExecutor)
            .thenApply(this::enrichOrder)
            .exceptionally(ex -> {
                log.error("获取订单失败: id={}", id, ex);
                return Order.fallback(id);  // 降级
            });
    }

    // handle：同时处理正常结果和异常
    public CompletableFuture<Result> processWithHandle(Long id) {
        return CompletableFuture.supplyAsync(() -> doProcess(id), taskExecutor)
            .handle((result, ex) -> {
                if (ex != null) {
                    log.error("处理失败", ex);
                    return Result.fail(ex.getMessage());
                }
                return result;
            });
    }

    // whenComplete：执行副作用但不改变结果
    public CompletableFuture<Data> getData(Long id) {
        return CompletableFuture.supplyAsync(() -> dataClient.fetch(id), taskExecutor)
            .whenComplete((data, ex) -> {
                if (ex != null) {
                    log.error("获取数据失败: id={}", id, ex);
                    metrics.increment("data.fetch.error");
                } else {
                    metrics.increment("data.fetch.success");
                }
            });
    }
}
```

| 方法 | 作用 | 是否改变结果 |
|------|------|-------------|
| `exceptionally` | 捕获异常，返回降级值 | ✅ 替换为降级值 |
| `handle` | 同时处理正常和异常 | ✅ 可返回新值 |
| `whenComplete` | 执行副作用（日志、监控） | ❌ 保持原结果 |

### 3.8 线程池调优

#### 核心参数

```java
ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
executor.setCorePoolSize(10);      // 核心线程数：即使空闲也不回收
executor.setMaxPoolSize(50);       // 最大线程数：队列满时扩容至此
executor.setQueueCapacity(100);    // 队列容量：核心线程满后，任务排队
executor.setKeepAliveSeconds(60);  // 非核心线程空闲存活时间
executor.setThreadNamePrefix("async-");  // 线程名前缀，便于排查
executor.setWaitForTasksToCompleteOnShutdown(true);  // 关闭时等待任务完成
executor.setAwaitTerminationSeconds(30);             // 关闭等待超时
```

**线程数计算公式**：

| 任务类型 | 公式 | 示例 |
|---------|------|------|
| CPU 密集型 | 线程数 = CPU 核心数 + 1 | 8 核 → 9 线程 |
| IO 密集型 | 线程数 = CPU 核心数 × 2 × (1 + IO 等待时间/CPU 时间) | 8 核、IO 占比 80% → 80 线程 |
| 混合型 | 按实际压测调整，从 IO 密集型公式开始 | 先设 40，压测后微调 |

#### 拒绝策略

当线程池和队列都满时，触发拒绝策略：

| 策略 | 行为 | 适用场景 |
|------|------|----------|
| `AbortPolicy`（默认） | 抛出 `RejectedExecutionException` | 需要感知过载 |
| `CallerRunsPolicy` | 由调用线程执行任务 | 不想丢失任务，可接受降速 |
| `DiscardPolicy` | 静默丢弃 | 可容忍丢失（如监控上报） |
| `DiscardOldestPolicy` | 丢弃队列中最旧的任务 | 只关心最新数据 |
| 自定义 | 记录日志 + 持久化到 DB/MQ | 需要事后补偿 |

```java
// 自定义拒绝策略：记录日志并持久化
public class LoggingRejectedHandler implements RejectedExecutionHandler {

    @Override
    public void rejectedExecution(Runnable r, ThreadPoolExecutor executor) {
        String taskDesc = r.toString();
        log.warn("任务被拒绝: {}, 活跃线程: {}, 队列大小: {}, 已完成: {}",
            taskDesc,
            executor.getActiveCount(),
            executor.getQueue().size(),
            executor.getCompletedTaskCount());

        // 持久化到消息队列，后续补偿
        rejectedTaskQueue.offer(taskDesc);
        metrics.increment("async.task.rejected");
    }
}
```

#### 线程池监控

```java
@Component
public class ThreadPoolMonitor {

    @Autowired
    @Qualifier("taskExecutor")
    private ThreadPoolTaskExecutor taskExecutor;

    @Scheduled(fixedRate = 30000)
    public void monitor() {
        ThreadPoolExecutor executor = taskExecutor.getThreadPoolExecutor();
        log.info("线程池状态: 核心={}, 最大={}, 活跃={}, 队列={}, 已完成={}, 池大小={}",
            executor.getCorePoolSize(),
            executor.getMaximumPoolSize(),
            executor.getActiveCount(),
            executor.getQueue().size(),
            executor.getCompletedTaskCount(),
            executor.getPoolSize());

        // 队列使用率超过 80% 告警
        double usage = (double) executor.getQueue().size() / taskExecutor.getQueueCapacity();
        if (usage > 0.8) {
            log.warn("线程池队列使用率过高: {:.1f}%", usage * 100);
            alertService.sendAlert("线程池队列告警",
                String.format("使用率: %.1f%%", usage * 100));
        }
    }
}
```

> **Tip**：Spring Boot Actuator 的 `/actuator/metrics/executor.pool.size` 等端点可直接暴露线程池指标，配合 Prometheus + Grafana 实现可视化监控。

**最佳实践：**

1. **自定义线程池**——不要用默认的 `SimpleAsyncTaskExecutor`（每次创建新线程）
2. **异步方法返回 `CompletableFuture` 或 `void`**——Spring 会自动适配
3. **`@Async` 不要自调用**——和 `@Transactional` 一样，需要通过代理对象调用
4. **异常处理**——`void` 返回值用 `AsyncUncaughtExceptionHandler`，`CompletableFuture` 用 `exceptionally`
5. **传递上下文**——使用 `TaskDecorator` 传递 `SecurityContext`、`TraceId` 等 `ThreadLocal` 上下文
6. **必须设置超时**——异步任务必须有超时兜底，防止线程被永久占用
7. **线程池按业务隔离**——不同业务（邮件、推送、数据同步）使用独立线程池，避免相互影响
8. **监控线程池指标**——队列积压、活跃线程数、拒绝任务数是核心告警指标
9. **拒绝策略按业务选择**——核心业务用 `CallerRunsPolicy` 保底，非关键任务可丢弃
10. **线程池参数压测确定**——不要拍脑袋设置，通过压测找到最优 `corePoolSize` 和 `maxPoolSize`
