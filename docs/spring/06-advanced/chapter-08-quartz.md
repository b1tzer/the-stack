# 动态定时任务 (Quartz)

> `@Scheduled` 在编译时就固定了 cron 表达式，运行时改不了。需要动态创建、修改、暂停、恢复定时任务——比如用户在后台配置报表生成时间——要用 Quartz。Spring Boot 提供了 `spring-boot-starter-quartz`，支持集群模式、持久化、错过策略。

## 1. @Scheduled vs Quartz

| 维度 | @Scheduled | Quartz |
| :-- | :-- | :-- |
| 调度时间 | 编译时固定 | 运行时动态配置 |
| 持久化 | 不支持 | 支持（数据库存储） |
| 集群 | 不支持 | 支持（分布式锁） |
| 错过策略 | 无 | 立即补执行 / 忽略 / 下次执行 |
| 任务管理 | 无 | 创建/暂停/恢复/删除 |
| 适用场景 | 固定周期任务 | 动态任务、需管理的任务 |

## 2. 依赖与配置

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-quartz</artifactId>
</dependency>
```

```yaml
spring:
  quartz:
    job-store-type: jdbc          # 内存(memory) 或 数据库(jdbc)
    jdbc:
      initialize-schema: always   # 自动建表
    properties:
      org.quartz:
        scheduler:
          instanceName: myScheduler
          instanceId: AUTO
        jobStore:
          class: org.springframework.scheduling.quartz.LocalDataSourceJobStore
          driverDelegateClass: org.quartz.impl.jdbcjobstore.StdJDBCDelegate
          isClustered: true       # 集群模式
          clusterCheckinInterval: 15000
        threadPool:
          class: org.quartz.simpl.SimpleThreadPool
          threadCount: 10
    # 关闭时等待任务完成
    wait-for-jobs-to-complete-on-shutdown: true
    # 覆盖已有任务定义
    overwrite-existing-jobs: true
```

Quartz 需要 11 张数据库表（`QRTZ_` 前缀），Spring Boot 自动建表。

## 3. Job 定义

```java
// Job 实现
public class ReportGenerateJob extends QuartzJobBean {

    @Override
    protected void executeInternal(JobExecutionContext context) {
        JobDataMap dataMap = context.getMergedJobDataMap();
        String reportType = dataMap.getString("reportType");
        Long userId = dataMap.getLong("userId");

        // 执行业务逻辑
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
                .storeDurably()  // 即使没有 Trigger 也保留
                .usingJobData("reportType", "daily")
                .build();
    }

    @Bean
    public Trigger reportTrigger(JobDetail reportJobDetail) {
        return TriggerBuilder.newTrigger()
                .forJob(reportJobDetail)
                .withIdentity("reportTrigger")
                .withSchedule(CronScheduleBuilder
                        .cronSchedule("0 0 2 * * ?")  // 每天凌晨 2 点
                        .withMisfireHandlingInstructionDoNothing())  // 错过不补
                .build();
    }
}
```

## 4. 动态管理任务

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

    // 修改任务调度时间
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

    // 暂停任务
    public void pauseJob(String jobName) {
        try {
            scheduler.pauseJob(JobKey.jobKey(jobName));
        } catch (SchedulerException e) {
            throw new JobException("暂停任务失败", e);
        }
    }

    // 恢复任务
    public void resumeJob(String jobName) {
        try {
            scheduler.resumeJob(JobKey.jobKey(jobName));
        } catch (SchedulerException e) {
            throw new JobException("恢复任务失败", e);
        }
    }

    // 删除任务
    public void deleteJob(String jobName) {
        try {
            scheduler.deleteJob(JobKey.jobKey(jobName));
        } catch (SchedulerException e) {
            throw new JobException("删除任务失败", e);
        }
    }

    // 立即执行一次
    public void triggerJob(String jobName) {
        try {
            scheduler.triggerJob(JobKey.jobKey(jobName));
        } catch (SchedulerException e) {
            throw new JobException("触发任务失败", e);
        }
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

## 5. REST API 控制台

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
    public void pause(@PathVariable String name) {
        jobService.pauseJob(name);
    }

    @PutMapping("/{name}/resume")
    public void resume(@PathVariable String name) {
        jobService.resumeJob(name);
    }

    @DeleteMapping("/{name}")
    public void delete(@PathVariable String name) {
        jobService.deleteJob(name);
    }

    @PostMapping("/{name}/trigger")
    public void trigger(@PathVariable String name) {
        jobService.triggerJob(name);
    }

    @GetMapping
    public List<JobInfo> list() {
        return jobService.listJobs();
    }
}
```

## 6. 集群与持久化

Quartz 集群通过数据库行锁保证同一任务同一时刻只在一个节点执行：

```text
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

**最佳实践：**

1. **集群环境必须用 jdbc**——memory 模式各实例任务独立，会重复执行
2. **设置合理的错过策略**——`withMisfireHandlingInstructionDoNothing` 通常最安全
3. **Job 要无状态**——JobDataMap 是序列化存储的，不要放大量数据
4. **Job 要幂等**——集群切换时可能重复触发
5. **线程池大小合理**——`threadCount` 根据任务类型调整，IO 密集型可大些
6. **监控任务执行**——记录执行日志、失败告警
