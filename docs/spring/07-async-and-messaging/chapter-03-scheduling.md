# 定时任务

> 每天凌晨要跑批、每 5 分钟检查订单状态——定时任务是后端开发的日常。Spring 提供了从轻量级 `@Scheduled` 到重量级 Quartz 的完整方案。

## 1. @Scheduled 基础

### 1.1 三种调度方式

```java
@Component
public class ScheduledTasks {

    // fixedRate：上一次开始执行后 5 秒再执行（不管上一次有没有执行完）
    @Scheduled(fixedRate = 5000)
    public void fixedRateTask() {
        System.out.println("fixedRate: " + LocalDateTime.now());
    }

    // fixedDelay：上一次执行完成后 5 秒再执行（等上一次完成）
    @Scheduled(fixedDelay = 5000)
    public void fixedDelayTask() {
        System.out.println("fixedDelay: " + LocalDateTime.now());
    }

    // cron 表达式：每天凌晨 2 点执行
    @Scheduled(cron = "0 0 2 * * ?")
    public void cronTask() {
        System.out.println("凌晨批处理: " + LocalDateTime.now());
    }

    // initialDelay：首次延迟执行（可与 fixedRate / fixedDelay 组合）
    @Scheduled(fixedRate = 10000, initialDelay = 60000)
    public void delayedStart() {
        // 应用启动 60 秒后才首次执行，之后每 10 秒一次
    }
}
```

**fixedRate vs fixedDelay 核心区别**：

```
fixedRate = 5000ms（频率固定）
|--任务1--|    |--任务2--|    |--任务3--|
0        3    5        8   10       13

fixedDelay = 5000ms（间隔固定）
|--任务1--|         |--任务2--|         |--任务3--|
0        3    5        8         13        16
         ↑───────5s───────↑         ↑───────5s───────↑
         (从完成开始计时)           (从完成开始计时)
```

| 属性 | 含义 | 适用场景 | 是否等待上一次完成 |
| :-- | :-- | :-- | :-- |
| `fixedRate` | 固定频率执行 | 心跳上报、监控采集 | ❌ 不等待 |
| `fixedDelay` | 上次完成后固定间隔 | 轮询、消费队列 | ✅ 等待完成 |
| `cron` | Cron 表达式 | 定时批处理、报表 | 按表达式触发 |

> **踩坑提醒**：`fixedRate` 任务如果执行时间超过间隔，会导致任务堆积。默认单线程池下，后续任务会排队等待。

### 1.2 线程池配置

Spring 6.1 之前，`@Scheduled` 默认使用单线程调度器，所有任务串行执行；Spring 6.1+ 默认改用 `SimpleAsyncTaskScheduler`，每个任务用独立线程。无论哪个版本，生产环境都**必须自定义线程池**：

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

或者使用 `ThreadPoolTaskScheduler`：

```java
@Configuration
@EnableScheduling
public class ScheduleConfig {

    @Bean
    public TaskScheduler taskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(10);
        scheduler.setThreadNamePrefix("scheduled-");
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        scheduler.setAwaitTermination(30);
        scheduler.setErrorHandler(t ->
            log.error("定时任务执行异常", t));
        scheduler.setRejectedExecutionHandler(
            new ThreadPoolExecutor.CallerRunsPolicy());
        return scheduler;
    }
}
```

> **踩坑提示**：如果同时存在多个 `TaskScheduler` Bean，Spring 可能选择错误的那个。建议用 `@Primary` 标记主调度器。

## 2. Cron 表达式详解

### 2.1 格式说明

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

### 2.2 特殊字符

| 字符 | 含义 | 示例 | 说明 |
| :-- | :-- | :-- | :-- |
| `*` | 任意值 | `* * * * * *` | 每秒 |
| `?` | 不指定 | `0 0 8 * * ?` | 用于日和周互斥 |
| `-` | 范围 | `0 0 9-18 * * ?` | 9 点到 18 点 |
| `,` | 列举 | `0 0 8,12,18 * * ?` | 8 点、12 点、18 点 |
| `/` | 步长 | `0 0/15 * * * ?` | 每 15 分钟 |
| `L` | 最后 | `0 0 0 L * ?` | 每月最后一天 |
| `W` | 最近工作日 | `0 0 0 15W * ?` | 离 15 号最近的工作日 |
| `#` | 第 N 个星期几 | `0 0 0 ? * 5#3` | 每月第 3 个周四 |

> **日和周互斥规则：** 日（第 4 位）和周（第 6 位）不能同时为 `*`，其中一个必须为 `?`。

### 2.3 常用表达式速查

| 表达式 | 含义 |
| :-- | :-- |
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

### 2.4 Spring Cron vs Unix Cron

| 特性 | Spring Cron | Unix Cron |
| :-- | :-- | :-- |
| 字段数 | 6 位（含秒） | 5 位（无秒） |
| 日/周互斥 | 用 `?` | 用 `*` |
| 特殊字符 | `L`、`W`、`#` | `L`（部分实现） |
| 年份字段 | ❌ 不支持 | ❌ 不支持 |
| 执行精度 | 秒级 | 分钟级 |

## 3. 多实例环境下的任务去重

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

更标准的做法是用 ShedLock：

```java
@Scheduled(fixedRate = 60000)
@SchedulerLock(name = "dailyReport", lockAtMostFor = "4m", lockAtLeastFor = "1m")
public void scheduledTask() {
    doDailyReport();
}
```

ShedLock 用 `@SchedulerLock` 声明锁：`lockAtMostFor` 是锁的最长持有时间（防止实例崩溃后锁永远不释放），`lockAtLeastFor` 是最短持有时间（防止时钟漂移导致锁提前释放）。

```java
@Configuration
@EnableScheduling
@EnableSchedulerLock(defaultLockAtMostFor = "5m")
public class ScheduleConfig {
}
```

## 4. 动态定时任务（数据库驱动）

```java
@Service
public class DynamicScheduleService {

    @Autowired
    private TaskScheduler taskScheduler;

    private final Map<String, ScheduledFuture<?>> scheduledTasks = new ConcurrentHashMap<>();

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
        ScheduleLog log = new ScheduleLog(config.getTaskId(), LocalDateTime.now());
        try {
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

## 5. 任务编排——依赖关系与串并行执行

```java
@Service
public class TaskOrchestration {

    // 方式一：串行链式执行
    @Scheduled(cron = "0 0 1 * * ?")
    public void executePipeline() {
        log.info("[Pipeline] 开始执行");
        dataSyncTask.sync();      // Step 1
        dataCleanTask.clean();    // Step 2（依赖 Step 1）
        reportTask.generate();    // Step 3（依赖 Step 2）
        log.info("[Pipeline] 执行完成");
    }

    // 方式二：并行执行 + 汇总
    @Scheduled(cron = "0 30 1 * * ?")
    public void executeParallel() throws InterruptedException {
        ExecutorService executor = Executors.newFixedThreadPool(3);
        CountDownLatch latch = new CountDownLatch(3);

        executor.submit(() -> { try { taskA(); } finally { latch.countDown(); } });
        executor.submit(() -> { try { taskB(); } finally { latch.countDown(); } });
        executor.submit(() -> { try { taskC(); } finally { latch.countDown(); } });

        latch.await(10, TimeUnit.MINUTES);
        log.info("所有并行任务完成");
        executor.shutdown();
    }
}
```

**使用 `CompletableFuture` 编排 DAG 式依赖**：

```java
@Service
public class TaskDagOrchestrator {

    //     TaskA ──→ TaskC
    //     TaskB ──→ TaskD ──→ TaskE
    public void executeDag() {
        CompletableFuture<Void> taskA = CompletableFuture.runAsync(this::taskA, executor);
        CompletableFuture<Void> taskB = CompletableFuture.runAsync(this::taskB, executor);

        CompletableFuture<Void> taskC = taskA.thenRunAsync(this::taskC, executor);
        CompletableFuture<Void> taskD = CompletableFuture
            .allOf(taskA, taskB)
            .thenRunAsync(this::taskD, executor);

        CompletableFuture<Void> taskE = taskD.thenRunAsync(this::taskE, executor);

        CompletableFuture.allOf(taskC, taskE).join();
        log.info("DAG 编排执行完成");
    }
}
```

## 6. 任务监控——执行日志、超时告警、失败重试

### 6.1 AOP 统一监控切面

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

### 6.2 失败重试（结合 Spring Retry）

```java
@Configuration
@EnableRetry
public class RetryConfig {
}

@Service
public class ReliableTaskService {

    @Retryable(
        value = {TransientException.class},
        maxAttempts = 3,
        backoff = @Backoff(delay = 1000, multiplier = 2)
    )
    public void executeWithRetry() {
        externalService.call();
    }

    @Recover
    public void recover(TransientException ex) {
        log.error("任务重试耗尽，执行降级逻辑", ex);
        alertService.sendAlert("任务最终失败", ex.getMessage());
    }
}
```

## 7. Quartz 动态定时任务

### 7.1 @Scheduled vs Quartz

| 维度 | @Scheduled | Quartz |
| :-- | :-- | :-- |
| 动态配置 | ❌ 编译时固定 | ✅ 运行时动态 |
| 持久化 | ❌ | ✅ JDBC JobStore |
| 集群 | ❌ | ✅ |
| 错过策略 | 无 | 立即补执行 / 忽略 / 下次执行 |
| 任务管理 | 无 | 创建/暂停/恢复/删除 |
| 复杂度 | 极低 | 中等 |
| 适用场景 | 简单固定周期 | 用户可配置、集群部署 |

> **经验法则**：90% 的场景用 `@Scheduled` 足够。只有需要"运行时动态增删改"或"集群部署"时才引入 Quartz。

### 7.2 依赖与配置

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-quartz</artifactId>
</dependency>
```

```yaml
spring:
  quartz:
    job-store-type: jdbc
    jdbc:
      initialize-schema: always
    properties:
      org.quartz:
        scheduler:
          instanceName: myScheduler
          instanceId: AUTO
        jobStore:
          class: org.springframework.scheduling.quartz.LocalDataSourceJobStore
          driverDelegateClass: org.quartz.impl.jdbcjobstore.StdJDBCDelegate
          isClustered: true
          clusterCheckinInterval: 15000
        threadPool:
          class: org.quartz.simpl.SimpleThreadPool
          threadCount: 10
    wait-for-jobs-to-complete-on-shutdown: true
    overwrite-existing-jobs: true
```

Quartz 需要 11 张数据库表（`QRTZ_` 前缀），Spring Boot 自动建表。

### 7.3 Job 定义与配置

```java
// Job 实现
public class ReportGenerateJob extends QuartzJobBean {

    @Override
    protected void executeInternal(JobExecutionContext context) {
        JobDataMap dataMap = context.getMergedJobDataMap();
        String reportType = dataMap.getString("reportType");
        Long userId = dataMap.getLong("userId");
        reportService.generate(reportType, userId);
    }
}

// 配置 JobDetail Bean
@Configuration
public class QuartzConfig {

    @Bean
    public JobDetail reportJobDetail() {
        return JobBuilder.newJob(ReportGenerateJob.class)
                .withIdentity("reportGenerate")
                .withDescription("报表生成任务")
                .storeDurably()
                .usingJobData("reportType", "daily")
                .build();
    }

    @Bean
    public Trigger reportTrigger(JobDetail reportJobDetail) {
        return TriggerBuilder.newTrigger()
                .forJob(reportJobDetail)
                .withIdentity("reportTrigger")
                .withSchedule(CronScheduleBuilder
                        .cronSchedule("0 0 2 * * ?")
                        .withMisfireHandlingInstructionDoNothing())
                .build();
    }
}
```

### 7.4 动态管理任务

```java
@Service
public class QuartzJobService {

    @Autowired
    private Scheduler scheduler;

    // 创建任务
    public void createJob(String jobName, String cron, JobDataMap data) {
        JobDetail job = JobBuilder.newJob(ReportGenerateJob.class)
                .withIdentity(jobName)
                .setJobData(data)
                .storeDurably()
                .build();

        Trigger trigger = TriggerBuilder.newTrigger()
                .forJob(job)
                .withIdentity(jobName + "_trigger")
                .withSchedule(CronScheduleBuilder.cronSchedule(cron))
                .build();

        try {
            scheduler.scheduleJob(job, trigger);
        } catch (SchedulerException e) {
            throw new JobException("创建任务失败", e);
        }
    }

    // 修改 cron
    public void rescheduleJob(String jobName, String newCron) {
        try {
            TriggerKey triggerKey = TriggerKey.triggerKey(jobName + "_trigger");
            CronTrigger newTrigger = TriggerBuilder.newTrigger()
                    .forJob(jobName)
                    .withIdentity(triggerKey)
                    .withSchedule(CronScheduleBuilder.cronSchedule(newCron))
                    .build();
            scheduler.rescheduleJob(triggerKey, newTrigger);
        } catch (SchedulerException e) {
            throw new JobException("修改调度失败", e);
        }
    }

    // 暂停 / 恢复 / 删除 / 立即触发
    public void pauseJob(String jobName) throws SchedulerException {
        scheduler.pauseJob(JobKey.jobKey(jobName));
    }

    public void resumeJob(String jobName) throws SchedulerException {
        scheduler.resumeJob(JobKey.jobKey(jobName));
    }

    public void deleteJob(String jobName) throws SchedulerException {
        scheduler.deleteJob(JobKey.jobKey(jobName));
    }

    public void triggerJob(String jobName) throws SchedulerException {
        scheduler.triggerJob(JobKey.jobKey(jobName));
    }

    // 查询所有任务
    public List<JobInfo> listJobs() {
        try {
            List<JobInfo> jobs = new ArrayList<>();
            for (String groupName : scheduler.getJobGroupNames()) {
                for (JobKey jobKey : scheduler.getJobKeys(GroupMatcher.jobGroupEquals(groupName))) {
                    List<? extends Trigger> triggers = scheduler.getTriggersOfJob(jobKey);
                    String cron = triggers.isEmpty() ? "N/A" :
                            ((CronTrigger) triggers.get(0)).getCronExpression();
                    TriggerState state = scheduler.getTriggerState(triggers.get(0).getKey());
                    jobs.add(new JobInfo(jobKey.getName(), cron, state.name()));
                }
            }
            return jobs;
        } catch (SchedulerException e) {
            throw new JobException("查询任务失败", e);
        }
    }
}
```

### 7.5 REST API 控制台

```java
@RestController
@RequestMapping("/api/jobs")
public class JobController {

    @Autowired
    private QuartzJobService jobService;

    @PostMapping
    public void createJob(@RequestBody CreateJobRequest request) {
        JobDataMap data = new JobDataMap(request.getParams());
        jobService.createJob(request.getJobName(), request.getCron(), data);
    }

    @PutMapping("/{name}/cron")
    public void reschedule(@PathVariable String name, @RequestParam String cron) {
        jobService.rescheduleJob(name, cron);
    }

    @PutMapping("/{name}/pause")
    public void pause(@PathVariable String name) { jobService.pauseJob(name); }

    @PutMapping("/{name}/resume")
    public void resume(@PathVariable String name) { jobService.resumeJob(name); }

    @DeleteMapping("/{name}")
    public void delete(@PathVariable String name) { jobService.deleteJob(name); }

    @PostMapping("/{name}/trigger")
    public void trigger(@PathVariable String name) { jobService.triggerJob(name); }

    @GetMapping
    public List<JobInfo> list() { return jobService.listJobs(); }
}
```

### 7.6 集群与持久化

Quartz 集群通过数据库行锁保证同一任务同一时刻只在一个节点执行：

```txt
┌──────────┐     ┌──────────┐     ┌──────────┐
│  实例 A   │     │  实例 B   │     │  实例 C   │
└────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │
     └────────────────┼────────────────┘
                      │
              ┌───────┴───────┐
              │  数据库         │
              │  QRTZ_ 锁表    │
              └───────────────┘
```

## 8. 最佳实践

1. **分布式环境必须做任务去重**——Redis 分布式锁或 ShedLock
2. **定时任务线程池与业务线程池分离**——避免定时任务占满业务线程
3. **记录任务执行日志**——方便排查任务失败原因，建议持久化到数据库
4. **避免任务执行时间超过调度间隔**——否则会导致任务堆积
5. **复杂调度场景用 Quartz**——支持 cron、间隔、日历等多种触发器
6. **关键任务配置超时告警**——通过 AOP 切面统一监控
7. **外部调用加失败重试**——结合 Spring Retry，指数退避
8. **任务编排用 DAG**——有依赖关系的任务用 `CompletableFuture` 声明依赖
9. **集群环境必须用 jdbc**——memory 模式各实例任务独立，会重复执行
10. **设置合理的错过策略**——`withMisfireHandlingInstructionDoNothing` 通常最安全
