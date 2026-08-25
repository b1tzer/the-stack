# 定时任务

## 1. @Scheduled

```java
@Configuration
@EnableScheduling
public class ScheduleConfig {
    // 固定频率
    @Scheduled(fixedRate = 5000)
    public void reportCurrentTime() { /* ... */ }
    
    // 固定延迟
    @Scheduled(fixedDelay = 5000)
    public void processTask() { /* ... */ }
    
    // Cron 表达式
    @Scheduled(cron = "0 0 2 * * ?")
    public void dailyCleanup() { /* ... */ }
}
```

### 1.1 fixedRate vs fixedDelay vs cron

三者的核心区别在于**计时起点**不同：

| 属性 | 计时起点 | 适用场景 | 是否等待上一次完成 |
|------|---------|---------|------------------|
| `fixedRate` | 上一次**开始**执行时间 | 固定频率采集、心跳上报 | ❌ 不等待 |
| `fixedDelay` | 上一次**结束**执行时间 | 轮询处理、队列消费 | ✅ 等待完成 |
| `cron` | Cron 表达式定义的时间点 | 定时报表、每日清理 | 按表达式触发 |

```java
@Service
public class TaskDemo {

    // fixedRate：每 5 秒执行一次（从上次开始时间算起）
    // 如果任务执行了 8 秒，则下一次在上次开始后 5 秒就触发（不会等 8 秒）
    // ⚠️ 任务堆积风险：执行时间 > 间隔时，任务会并发执行
    @Scheduled(fixedRate = 5000)
    public void fixedRateTask() {
        log.info("fixedRate - {}", LocalDateTime.now());
        // 模拟耗时操作
    }

    // fixedDelay：上次执行结束后等 5 秒再执行
    // 保证串行执行，永远不会并发
    @Scheduled(fixedDelay = 5000)
    public void fixedDelayTask() {
        log.info("fixedDelay - {}", LocalDateTime.now());
    }

    // initialDelay：首次延迟执行（可与 fixedRate / fixedDelay 组合）
    @Scheduled(fixedRate = 10000, initialDelay = 60000)
    public void delayedStart() {
        // 应用启动 60 秒后才首次执行，之后每 10 秒一次
    }
}
```

**执行时序对比：**

```
时间轴:  0s    2s    4s    5s    6s    8s    10s   11s
         |     |     |     |     |     |     |     |
fixedRate(5s): [任务1====]         [任务2====]         [任务3====]
               ↑ 开始              ↑ 5s后触发          ↑ 10s后触发

fixedDelay(5s):[任务1====]                   [任务2====]
               ↑ 结束于2s         +5s=7s触发  ↑ 结束于9s   +5s=14s触发
```

### 1.2 线程池配置

默认情况下，`@Scheduled` 使用单线程的 `SimpleAsyncTaskScheduler`，所有任务串行执行。生产环境**必须自定义线程池**：

```java
@Configuration
@EnableScheduling
public class ScheduleConfig {

    @Bean
    public TaskScheduler taskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(10);                              // 线程数
        scheduler.setThreadNamePrefix("scheduled-");           // 线程名前缀
        scheduler.setWaitForTasksToCompleteOnShutdown(true);    // 关闭时等待任务完成
        scheduler.setAwaitTermination(30);                      // 等待超时（秒）
        scheduler.setErrorHandler(t ->
            log.error("定时任务执行异常", t));                  // 全局异常处理
        scheduler.setRejectedExecutionHandler(
            new ThreadPoolExecutor.CallerRunsPolicy());        // 拒绝策略
        return scheduler;
    }
}
```

> **踩坑提示：** 如果同时存在多个 `TaskScheduler` Bean，Spring 可能选择错误的那个。建议用 `@Primary` 标记主调度器，或通过 `SchedulingConfigurer` 统一配置。

```java
@Configuration
@EnableScheduling
public class ScheduleConfig implements SchedulingConfigurer {

    @Override
    public void configureTasks(ScheduledTaskRegistrar registrar) {
        registrar.setScheduler(taskScheduler());
    }

    @Bean(destroyMethod = "shutdown")
    public ExecutorService taskScheduler() {
        return Executors.newScheduledThreadPool(10,
            new ThreadFactoryBuilder().setNameFormat("scheduled-%d").build());
    }
}
```

## 2. 动态定时任务

```java
@Service
public class DynamicScheduler {
    @Autowired
    private TaskScheduler taskScheduler;
    
    public void addTask(String taskId, Runnable task, String cron) {
        taskScheduler.schedule(task, new CronTrigger(cron));
    }
}
```

## 3. 定时任务高级用法

### 3.1 多实例环境下的任务去重

```java
// 使用分布式锁保证同一任务只在一个实例上执行
@Scheduled(fixedRate = 60000)
public void scheduledTask() {
    String lockKey = "task:daily-report";
    boolean locked = distributedLock.tryLock(lockKey, 5, TimeUnit.MINUTES);
    if (!locked) {
        log.debug("任务已被其他实例执行，跳过");
        return;
    }
    try {
        doDailyReport();
    } finally {
        distributedLock.unlock(lockKey);
    }
}
```

手写分布式锁能解决问题，但锁的获取、续期、释放都要自己处理。一旦任务执行时间超过锁的过期时间，锁会提前释放，另一个实例就会重复执行。更标准的做法是用 ShedLock：

```java
// ShedLock：声明式分布式锁，锁的续期由框架自动处理
@Scheduled(fixedRate = 60000)
@SchedulerLock(name = "dailyReport", lockAtMostFor = "4m", lockAtLeastFor = "1m")
public void scheduledTask() {
    doDailyReport();
}
```

ShedLock 用一个 `@SchedulerLock` 注解声明锁：`name` 是锁的唯一标识，`lockAtMostFor` 是锁的最长持有时间（防止实例崩溃后锁永远不释放），`lockAtLeastFor` 是最短持有时间（防止时钟漂移导致锁提前释放）。锁存在数据库或 Redis 里，由 `LockProvider` 管理：

```java
@Configuration
@EnableScheduling
@EnableSchedulerLock(defaultLockAtMostFor = "5m")  // 全局默认锁时长
public class ScheduleConfig {
}
```

对比手写锁，ShedLock 的优势是：锁的续期和释放由框架处理，`lockAtMostFor` 兜底了实例崩溃场景，`lockAtLeastFor` 兜底了时钟漂移场景。多实例下 `@Scheduled` 去重，首选 ShedLock 而不是手写分布式锁；需要 misfire 策略、任务持久化、集群调度时再上 [Quartz](./chapter-08-quartz.md)。

### 3.2 动态定时任务（数据库驱动）

```java
@Service
public class DynamicScheduleService {

    @Autowired
    private TaskScheduler taskScheduler;

    // 存储已注册的定时任务
    private final Map<String, ScheduledFuture<?>> scheduledTasks = new ConcurrentHashMap<>();

    // 从数据库加载并注册定时任务
    @PostConstruct
    public void initTasks() {
        List<ScheduleConfig> configs = scheduleConfigRepository.findAllEnabled();
        for (ScheduleConfig config : configs) {
            addTask(config);
        }
    }

    public void addTask(ScheduleConfig config) {
        ScheduledFuture<?> future = taskScheduler.schedule(
            () -> executeTask(config),
            new CronTrigger(config.getCron())
        );
        scheduledTasks.put(config.getTaskId(), future);
    }

    public void removeTask(String taskId) {
        ScheduledFuture<?> future = scheduledTasks.remove(taskId);
        if (future != null) {
            future.cancel(false);
        }
    }

    // 运行时修改 cron 表达式
    public void updateCron(String taskId, String newCron) {
        removeTask(taskId);
        ScheduleConfig config = scheduleConfigRepository.findByTaskId(taskId);
        config.setCron(newCron);
        scheduleConfigRepository.save(config);
        addTask(config);
    }

    private void executeTask(ScheduleConfig config) {
        log.info("执行定时任务: {}", config.getTaskName());
        // 记录执行日志
        ScheduleLog log = new ScheduleLog(config.getTaskId(), LocalDateTime.now());
        try {
            // 动态执行（根据任务类型调用不同的处理器）
            TaskHandler handler = taskHandlerMap.get(config.getHandlerType());
            handler.handle(config.getParams());
            log.setStatus("SUCCESS");
        } catch (Exception e) {
            log.setStatus("FAILED");
            log.setError(e.getMessage());
        } finally {
            log.setFinishedAt(LocalDateTime.now());
            scheduleLogRepository.save(log);
        }
    }
}
```

### 3.3 异步定时任务

```java
@Configuration
@EnableScheduling
public class ScheduleConfig {

    // 自定义定时任务线程池
    @Bean
    public TaskScheduler taskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(10);
        scheduler.setThreadNamePrefix("scheduled-");
        scheduler.setErrorHandler(t ->
            log.error("定时任务异常", t));
        return scheduler;
    }
}
```

### 3.4 Spring Task vs Quartz 对比

| 特性 | @Scheduled | Quartz |
|------|-----------|--------|
| 配置方式 | 注解 | 编程 + 数据库 |
| 动态调度 | 需自行实现 | ✅ 内置 |
| 集群支持 | 需自行实现分布式锁 | ✅ 内置集群模式 |
| 任务持久化 | ❌ | ✅ 存储到数据库 |
| 错过执行策略 | 不支持 | misfire 指令 |
| 适用场景 | 简单定时任务 | 复杂调度需求 |

### 3.5 任务编排——依赖关系与串并行执行

当多个定时任务存在先后依赖时，需要编排执行顺序：

```java
@Service
public class TaskOrchestration {

    private final TaskScheduler taskScheduler;
    private final Map<String, ScheduledFuture<?>> taskRegistry = new ConcurrentHashMap<>();

    // 方式一：串行链式执行（前一个完成后再触发下一个）
    @Scheduled(cron = "0 0 1 * * ?")  // 每天凌晨 1 点触发
    public void executePipeline() {
        log.info("[Pipeline] 开始执行");
        long start = System.currentTimeMillis();

        // Step 1: 数据同步
        dataSyncTask.sync();

        // Step 2: 数据清洗（依赖 Step 1）
        dataCleanTask.clean();

        // Step 3: 报表生成（依赖 Step 2）
        reportTask.generate();

        log.info("[Pipeline] 执行完成，耗时: {}ms", System.currentTimeMillis() - start);
    }

    // 方式二：并行执行 + 汇总（适用于无依赖的独立任务）
    @Scheduled(cron = "0 30 1 * * ?")
    public void executeParallel() throws InterruptedException {
        ExecutorService executor = Executors.newFixedThreadPool(3);
        CountDownLatch latch = new CountDownLatch(3);

        executor.submit(() -> { try { taskA(); } finally { latch.countDown(); } });
        executor.submit(() -> { try { taskB(); } finally { latch.countDown(); } });
        executor.submit(() -> { try { taskC(); } finally { latch.countDown(); } });

        latch.await(10, TimeUnit.MINUTES);  // 等待全部完成（最多 10 分钟）
        log.info("所有并行任务完成");
        executor.shutdown();
    }
}
```

**使用 `CompletableFuture` 编排复杂依赖：**

```java
@Service
public class TaskDagOrchestrator {

    // 有向无环图（DAG）式任务编排
    //     TaskA ──→ TaskC
    //     TaskB ──→ TaskD ──→ TaskE
    public void executeDag() {
        CompletableFuture<Void> taskA = CompletableFuture.runAsync(this::taskA, executor);
        CompletableFuture<Void> taskB = CompletableFuture.runAsync(this::taskB, executor);

        // C 依赖 A，D 依赖 A + B
        CompletableFuture<Void> taskC = taskA.thenRunAsync(this::taskC, executor);
        CompletableFuture<Void> taskD = CompletableFuture
            .allOf(taskA, taskB)
            .thenRunAsync(this::taskD, executor);

        // E 依赖 D
        CompletableFuture<Void> taskE = taskD.thenRunAsync(this::taskE, executor);

        // 等待所有任务完成
        CompletableFuture.allOf(taskC, taskE).join();
        log.info("DAG 编排执行完成");
    }
}
```

### 3.6 任务监控——执行日志、超时告警、失败重试

生产环境的定时任务必须有完整的可观测性：

```java
// 任务执行日志实体
@Entity
@Table(name = "task_execution_log")
public class TaskExecutionLog {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String taskName;
    private String cron;
    private LocalDateTime startTime;
    private LocalDateTime endTime;
    private Long durationMs;
    private String status;       // SUCCESS / FAILED / TIMEOUT
    private String errorMessage;
    private Integer retryCount;
}
```

**AOP 统一监控切面：**

```java
@Aspect
@Component
@Slf4j
public class ScheduledTaskMonitor {

    @Autowired
    private TaskExecutionLogRepository logRepository;
    @Autowired
    private AlertService alertService;

    @Around("@annotation(org.springframework.scheduling.annotation.Scheduled)")
    public Object monitor(ProceedingJoinPoint pjp) throws Throwable {
        String taskName = pjp.getSignature().toShortString();
        LocalDateTime startTime = LocalDateTime.now();
        TaskExecutionLog execLog = new TaskExecutionLog();
        execLog.setTaskName(taskName);
        execLog.setStartTime(startTime);

        try {
            Object result = pjp.proceed();
            execLog.setStatus("SUCCESS");
            return result;
        } catch (Throwable ex) {
            execLog.setStatus("FAILED");
            execLog.setErrorMessage(ex.getMessage());
            throw ex;
        } finally {
            LocalDateTime endTime = LocalDateTime.now();
            execLog.setEndTime(endTime);
            execLog.setDurationMs(Duration.between(startTime, endTime).toMillis());
            logRepository.save(execLog);

            // 超时告警：执行时间超过 5 分钟
            if (execLog.getDurationMs() > 300_000) {
                alertService.sendWarning(String.format(
                    "任务 [%s] 执行超时，耗时 %dms", taskName, execLog.getDurationMs()));
            }
            log.info("任务 [{}] 执行完成: status={}, duration={}ms",
                taskName, execLog.getStatus(), execLog.getDurationMs());
        }
    }
}
```

**失败重试（结合 Spring Retry）：**

```java
@Configuration
@EnableRetry
public class RetryConfig {
}

@Service
public class ReliableTaskService {

    // 最多重试 3 次，每次间隔指数递增（1s, 2s, 4s）
    @Retryable(
        value = {TransientException.class},
        maxAttempts = 3,
        backoff = @Backoff(delay = 1000, multiplier = 2)
    )
    public void executeWithRetry() {
        // 可能失败的任务逻辑
        externalService.call();
    }

    @Recover
    public void recover(TransientException ex) {
        log.error("任务重试耗尽，执行降级逻辑", ex);
        alertService.sendAlert("任务最终失败", ex.getMessage());
    }
}
```

## 4. Cron 表达式详解

### 4.1 格式说明

Spring Cron 表达式为 **6 位**格式（比 Unix Cron 多一个「秒」字段）：

```
┌──────────── 秒（0-59）
│ ┌────────── 分（0-59）
│ │ ┌──────── 时（0-23）
│ │ │ ┌────── 日（1-31）
│ │ │ │ ┌──── 月（1-12）
│ │ │ │ │ ┌── 周（0-7，0 和 7 都是周日）
│ │ │ │ │ │
* * * * * *
```

### 4.2 特殊字符

| 字符 | 含义 | 示例 | 说明 |
|------|------|------|------|
| `*` | 任意值 | `* * * * * *` | 每秒 |
| `?` | 不指定 | `0 0 8 * * ?` | 用于日和周互斥 |
| `-` | 范围 | `0 0 9-18 * * ?` | 9 点到 18 点 |
| `,` | 列举 | `0 0 8,12,18 * * ?` | 8 点、12 点、18 点 |
| `/` | 步长 | `0 0/15 * * * ?` | 每 15 分钟 |
| `L` | 最后 | `0 0 0 L * ?` | 每月最后一天 |
| `W` | 最近工作日 | `0 0 0 15W * ?` | 离 15 号最近的工作日 |
| `#` | 第 N 个星期几 | `0 0 0 ? * 5#3` | 每月第 3 个周四 |

> **日和周互斥规则：** 日（第 4 位）和周（第 6 位）不能同时为 `*`，其中一个必须为 `?`。

### 4.3 常用表达式速查

| 表达式 | 含义 |
|--------|------|
| `0 0/1 * * * ?` | 每分钟执行 |
| `0 0/5 * * * ?` | 每 5 分钟执行 |
| `0 0/30 * * * ?` | 每 30 分钟执行 |
| `0 0 * * * ?` | 每小时整点 |
| `0 0 8 * * ?` | 每天 08:00 |
| `0 0 0 * * ?` | 每天午夜 |
| `0 0 8 * * 1-5` | 工作日 08:00 |
| `0 0 8 ? * MON-FRI` | 工作日 08:00（另一种写法） |
| `0 0 2 ? * SUN` | 每周日凌晨 2:00 |
| `0 0 0 1 * ?` | 每月 1 号 00:00 |
| `0 0 0 L * ?` | 每月最后一天 00:00 |
| `0 0 0 ? * 5L` | 每月最后一个周四 |
| `0 15 10 15 * ?` | 每月 15 日 10:15 |
| `0 0 0 1 1 ?` | 每年 1 月 1 日 |
| `0 0 9-18 * * ?` | 每天 9 点到 18 点整点 |
| `0 0 0 ? * 5#3` | 每月第 3 个周四 |

### 4.4 Spring Cron vs Unix Cron

| 特性 | Spring Cron | Unix Cron |
|------|------------|----------|
| 字段数 | 6 位（含秒） | 5 位（无秒） |
| 日/周互斥 | 用 `?` | 用 `*` |
| 特殊字符 | `L`、`W`、`#` | `L`（部分实现） |
| 年份字段 | ❌ 不支持 | ❌ 不支持 |
| 执行精度 | 秒级 | 分钟级 |

## 5. 最佳实践

1. **分布式环境必须做任务去重**——Redis 分布式锁或数据库乐观锁
2. **定时任务线程池与业务线程池分离**——避免定时任务占满业务线程
3. **记录任务执行日志**——方便排查任务失败原因，建议持久化到数据库
4. **避免任务执行时间超过调度间隔**——否则会导致任务堆积
5. **复杂调度场景用 Quartz**——支持 cron、间隔、日历等多种触发器
6. **关键任务配置超时告警**——通过 AOP 切面统一监控，超过阈值主动通知
7. **外部调用加失败重试**——结合 Spring Retry，指数退避 + 最大重试次数
8. **任务编排用 DAG**——有依赖关系的任务不要硬编码顺序，用 `CompletableFuture` 声明依赖
