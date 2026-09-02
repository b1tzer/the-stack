# 异步处理

> `@Async` 是 Spring 最简单的异步方案，但默认的线程池是个坑——每次调用都创建新线程，生产环境会 OOM。本章从基础用法到线程池调优、异常处理、上下文传递，覆盖异步编程的全部核心知识。

## 1. @Async 基础

### 1.1 基本用法

```java
@SpringBootApplication
@EnableAsync  // 必须开启！
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}

@Configuration
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

### 1.2 为什么不能用默认 SimpleAsyncTaskExecutor

| 特性 | SimpleAsyncTaskExecutor（默认） | ThreadPoolTaskExecutor（推荐） |
|------|-------------------------------|-------------------------------|
| 线程复用 | ❌ 每次新建 | ✅ 线程池复用 |
| 资源控制 | ❌ 无上限 | ✅ 可控 |
| 生产可用 | ❌ 会 OOM | ✅ 安全 |
| 性能 | 差（频繁创建销毁） | 好（复用） |

> **踩坑提醒**：不指定 Bean 名称时，`@Async` 使用默认的 `SimpleAsyncTaskExecutor`。生产环境一定要自定义线程池。

## 2. @Async 失效场景

**最常见的 5 个失效场景**：

```java
@Service
public class UserService {

    @Async
    public void asyncMethod() { /* ... */ }

    // ❌ 场景一：自调用（最常见！）
    public void doSomething() {
        // this.asyncMethod() —— 不走代理，@Async 失效！
        asyncMethod(); // 同一个对象内部调用，AOP 代理不生效
    }

    // ✅ 修复：注入自身（或拆分到另一个 Bean）
    @Autowired
    private ApplicationContext context;

    public void doSomethingFixed() {
        context.getBean(UserService.class).asyncMethod();
    }
}

// ❌ 场景二：方法不是 public
@Service
public class BadService {

    @Async
    void packagePrivateMethod() { /* 失效 */ }  // 非 public

    @Async
    private void privateMethod() { /* 失效 */ }  // private
}

// ❌ 场景三：没加 @EnableAsync
// @EnableAsync 忘了加，所有 @Async 都不生效

// ❌ 场景四：异常被吞掉
@Async
public void riskyMethod() {
    throw new RuntimeException("出错了");
    // 默认只打 warn 日志，不抛出！
}
```

| 场景 | 原因 | 修复方式 |
|------|------|---------|
| 自调用 | Spring AOP 代理不生效 | 注入自身代理 / 拆分 Bean |
| 非 public | CGLIB/JDK 代理限制 | 改为 public |
| 未开启 | 缺 `@EnableAsync` | 加注解 |
| 异常被吞 | 默认只打日志 | 配置 ExceptionHandler |
| 循环依赖 | `AsyncAnnotationBeanPostProcessor` 未提前代理 | 消除循环依赖 / 加 `@Lazy` |

第五个场景单独说：`@Async` 与循环依赖叠加时，`OrderService` 和 `NotificationService` 互相注入，Spring Boot 2.6 之前（或显式开启 `allow-circular-references`）启动不报错，但 `@Async` 静默失效、异步变同步——因为 `AsyncAnnotationBeanPostProcessor` 没有重写 `getEarlyBeanReference`，提前暴露的是裸对象。三级缓存的原理与这个坑的完整链路见 [循环依赖与三级缓存](../01-core/chapter-06-circular-dependency.md) §5。

> **经验法则**：自调用是 @Async（以及 @Transactional、@Cacheable）失效的头号杀手。记住——凡是走 AOP 代理的注解，自调用都会失效。

## 3. CompletableFuture 组合异步操作

```java
public CompletableFuture<User> getUserAsync(Long id) {
    return CompletableFuture.supplyAsync(() -> userRepository.findById(id))
        .thenApply(user -> enrichUser(user))
        .exceptionally(ex -> getDefaultUser());
}

@Service
public class AsyncOrderService {

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

## 4. 异步异常处理

### 4.1 返回 void 的异常处理

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

### 4.2 返回 CompletableFuture 的异常处理

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

> **踩坑提醒**：`AsyncUncaughtExceptionHandler` 只对返回 `void` 的异步方法生效。返回 `CompletableFuture` 的方法异常会封装在 Future 中，需要调用方自行处理。

## 5. 异步方法的事务问题

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

## 6. 异步上下文传递

`@Async` 方法在独立线程中执行，`ThreadLocal` 中的上下文（如 `SecurityContext`、`TraceId`、用户信息）会丢失。Spring 提供 `TaskDecorator` 接口解决此问题：

```java
public class ContextPropagationDecorator implements TaskDecorator {

    @Override
    public Runnable decorate(Runnable runnable) {
        RequestAttributes requestAttributes = RequestContextHolder.getRequestAttributes();
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        String traceId = MDC.get("traceId");

        return () -> {
            try {
                RequestContextHolder.setRequestAttributes(requestAttributes);
                SecurityContextHolder.getContext().setAuthentication(authentication);
                MDC.put("traceId", traceId);
                runnable.run();
            } finally {
                RequestContextHolder.resetRequestAttributes();
                SecurityContextHolder.clearContext();
                MDC.clear();
            }
        };
    }
}

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
        executor.setTaskDecorator(new ContextPropagationDecorator());
        executor.initialize();
        return executor;
    }
}
```

> **注意**：如果使用 Sleuth / Micrometer Tracing，框架会自动注入 `TaskDecorator` 实现 TraceId 传递，无需手动编写。

## 7. 异步超时控制

```java
@Service
public class AsyncTimeoutService {

    // 方式一：CompletableFuture.orTimeout（Java 9+）
    public CompletableFuture<String> callWithOrTimeout(Long id) {
        return CompletableFuture.supplyAsync(() -> externalService.call(id), taskExecutor)
            .orTimeout(3, TimeUnit.SECONDS)
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
}
```

| 方式 | 超时行为 | Java 版本 | 适用场景 |
|------|---------|-----------|----------|
| `orTimeout` | 抛 `TimeoutException` | 9+ | 需要感知超时并做特殊处理 |
| `completeOnTimeout` | 返回默认值 | 9+ | 超时后有合理的降级值 |
| 自定义封装 | 可自定义 | 8+ | 需要兼容 Java 8 或更细粒度控制 |

## 8. 线程池调优

### 8.1 核心参数

```java
ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
executor.setCorePoolSize(10);      // 核心线程数：即使空闲也不回收
executor.setMaxPoolSize(50);       // 最大线程数：队列满时扩容至此
executor.setQueueCapacity(100);    // 队列容量：核心线程满后，任务排队
executor.setKeepAliveSeconds(60);  // 非核心线程空闲存活时间
executor.setThreadNamePrefix("async-");
executor.setWaitForTasksToCompleteOnShutdown(true);
executor.setAwaitTerminationSeconds(30);
```

**线程数计算公式**：

| 任务类型 | 公式 | 示例 |
|---------|------|------|
| CPU 密集型 | 线程数 = CPU 核心数 + 1 | 8 核 → 9 线程 |
| IO 密集型 | 线程数 = CPU 核心数 × 2 × (1 + IO 等待时间/CPU 时间) | 8 核、IO 占比 80% → 80 线程 |
| 混合型 | 按实际压测调整，从 IO 密集型公式开始 | 先设 40，压测后微调 |

### 8.2 拒绝策略

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

### 8.3 线程池监控

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

        double usage = (double) executor.getQueue().size() / taskExecutor.getQueueCapacity();
        if (usage > 0.8) {
            log.warn("线程池队列使用率过高: {}%", String.format("%.1f", usage * 100));
            alertService.sendAlert("线程池队列告警",
                String.format("使用率: %.1f%%", usage * 100));
        }
    }
}
```

> **Tip**：Spring Boot Actuator 的 `/actuator/metrics/executor.pool.size` 等端点可直接暴露线程池指标，配合 Prometheus + Grafana 实现可视化监控。

## 9. 最佳实践

1. **自定义线程池**——不要用默认的 `SimpleAsyncTaskExecutor`
2. **异步方法返回 `CompletableFuture` 或 `void`**——Spring 会自动适配
3. **`@Async` 不要自调用**——和 `@Transactional` 一样，需要通过代理对象调用
4. **异常处理**——`void` 返回值用 `AsyncUncaughtExceptionHandler`，`CompletableFuture` 用 `exceptionally`
5. **传递上下文**——使用 `TaskDecorator` 传递 `SecurityContext`、`TraceId` 等
6. **必须设置超时**——异步任务必须有超时兜底，防止线程被永久占用
7. **线程池按业务隔离**——不同业务（邮件、推送、数据同步）使用独立线程池
8. **监控线程池指标**——队列积压、活跃线程数、拒绝任务数是核心告警指标
9. **拒绝策略按业务选择**——核心业务用 `CallerRunsPolicy` 保底，非关键任务可丢弃
10. **线程池参数压测确定**——不要拍脑袋设置，通过压测找到最优参数
