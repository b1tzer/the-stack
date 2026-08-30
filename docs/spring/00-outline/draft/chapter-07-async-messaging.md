# 第 07 章：异步与消息

> 当你的接口需要发邮件、写日志、推消息，却不想让用户等——异步就是你的第一把钥匙。

---

## 7.1 Spring 事件机制

Spring 内置了一套基于 `ApplicationEvent` 的发布-订阅模型，是解耦业务逻辑最轻量的方式。

### 7.1.1 自定义事件与监听

**痛点**：用户注册后要发邮件、初始化积分、写日志，全塞在 Service 里，代码又长又难测。

Spring 事件让你把"注册"和"注册后要做的事"彻底分开：

```java
// 1. 定义事件
public class UserRegisteredEvent extends ApplicationEvent {
    private final String username;
    private final String email;

    public UserRegisteredEvent(Object source, String username, String email) {
        super(source);
        this.username = username;
        this.email = email;
    }

    public String getUsername() { return username; }
    public String getEmail() { return email; }
}

// 2. 发布事件
@Service
public class UserService {
    private final ApplicationEventPublisher publisher;

    public UserService(ApplicationEventPublisher publisher) {
        this.publisher = publisher;
    }

    @Transactional
    public void register(String username, String email) {
        // 保存用户到数据库...
        publisher.publishEvent(new UserRegisteredEvent(this, username, email));
    }
}

// 3. 监听事件
@Component
public class UserEventListener {

    @EventListener
    public void sendWelcomeEmail(UserRegisteredEvent event) {
        System.out.println("发送欢迎邮件给: " + event.getEmail());
    }

    @EventListener
    public void initBonusPoints(UserRegisteredEvent event) {
        System.out.println("为用户 " + event.getUsername() + " 初始化积分");
    }
}
```

**同步 vs 异步事件**：默认情况下 `@EventListener` 是同步执行的，监听器在发布者线程中运行。要异步执行，加 `@Async`：

```java
@Component
public class UserEventListener {

    @Async
    @EventListener
    public void sendWelcomeEmail(UserRegisteredEvent event) {
        // 会在独立线程池中执行，不阻塞发布者
    }
}
```

> **踩坑提醒**：异步事件监听器抛出异常不会传播回调用方。如果需要感知异常，要自行处理或使用 `CompletableFuture`。

**同步 vs 异步对比**：

| 特性 | 同步事件 | 异步事件（@Async） |
|------|---------|-------------------|
| 执行线程 | 发布者线程 | 线程池线程 |
| 异常传播 | 会抛给调用方 | 静默吞掉（需配置 Handler） |
| 事务参与 | 同一事务 | 不在同一事务 |
| 适用场景 | 需要事务一致性的轻量操作 | 耗时操作（发邮件、推送） |

### 7.1.2 事件的事务边界

**痛点**：事件发布在事务内，但监听器想在事务提交后再执行（比如发邮件），结果事务回滚了邮件却已经发出去了。

`@TransactionalEventListener` 让你精确控制事件监听器在哪个事务阶段执行：

```java
@Component
public class UserEventListener {

    // 事务提交后才执行 —— 最常用
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void sendWelcomeEmail(UserRegisteredEvent event) {
        System.out.println("事务已提交，安全发送邮件: " + event.getEmail());
    }

    // 事务提交前执行（适合注册到事务性资源）
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    public void beforeCommit(UserRegisteredEvent event) {
        System.out.println("事务即将提交...");
    }

    // 事务回滚后执行（适合补偿操作）
    @TransactionalEventListener(phase = TransactionPhase.AFTER_ROLLBACK)
    public void onRollback(UserRegisteredEvent event) {
        System.out.println("事务已回滚，执行补偿逻辑");
    }
}
```

事务阶段对比：

| TransactionPhase | 触发时机 | 典型场景 |
|------------------|---------|---------|
| `BEFORE_COMMIT` | 事务提交前 | 注册到事务性资源 |
| `AFTER_COMMIT` | 事务提交后（默认） | 发邮件、推送通知 |
| `AFTER_ROLLBACK` | 事务回滚后 | 补偿操作、清理资源 |
| `AFTER_COMPLETION` | 无论提交/回滚 | 通用清理 |

> **踩坑提醒**：如果用 `@TransactionalEventListener` 但发布事件的方法没有 `@Transactional`，监听器默认会立即执行（等同于无事务）。确保事件发布在事务上下文中。

### 7.1.3 事件 vs 消息队列选型

什么时候用 Spring Event，什么时候该上消息队列？核心区别在于**边界**。

```
┌─────────────────────────────────────────────────────┐
│                   进程内 (JVM)                       │
│                                                     │
│  Service A ──publish──► Spring Event ──► Listener   │
│                                                     │
│  ✅ 快速  ✅ 简单  ❌ 无持久化  ❌ 无法跨进程       │
└─────────────────────────────────────────────────────┘

┌──────────────┐    ┌──────────┐    ┌──────────────┐
│  Service A   │───►│  MQ      │───►│  Service B   │
│  (Producer)  │    │ (持久化)  │    │  (Consumer)  │
└──────────────┘    └──────────┘    └──────────────┘
  ✅ 跨进程  ✅ 持久化  ✅ 削峰填谷  ❌ 复杂度高
```

| 维度 | Spring Event | 消息队列（Kafka/RabbitMQ） |
|------|-------------|--------------------------|
| 边界 | 进程内 | 跨进程、跨服务 |
| 持久化 | 无 | 有（可配置） |
| 可靠性 | JVM 存活就可靠 | 支持确认机制 |
| 延迟 | 微秒级 | 毫秒~秒级 |
| 复杂度 | 极低 | 中高（需运维 MQ） |
| 典型场景 | 解耦模块、审计日志、缓存刷新 | 异步通信、削峰填谷、最终一致性 |

> **经验法则**：如果发完事件后"做不做都行"（best-effort），用 Spring Event。如果"必须做到"（at-least-once），用消息队列。

---

## 7.2 异步处理

### 7.2.1 @Async 基础

**痛点**：一个请求里要调三个远程服务，串行要 3 秒，并行只要 1 秒，但手动创建线程太麻烦。

`@Async` 是 Spring 最简单的异步方案，但**默认的线程池是个坑**：

```java
@SpringBootApplication
@EnableAsync  // 必须开启！
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}

@Service
public class NotificationService {

    // ❌ 不推荐：使用默认的 SimpleAsyncTaskExecutor
    // 每次调用都创建新线程，生产环境会 OOM
    @Async
    public void sendEmail(String to, String content) {
        // 耗时操作...
    }
}

// ✅ 推荐：自定义线程池
@Configuration
public class AsyncConfig {

    @Bean("taskExecutor")
    public Executor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(5);
        executor.setMaxPoolSize(10);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("async-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.initialize();
        return executor;
    }
}

@Service
public class NotificationService {

    @Async("taskExecutor")  // 指定线程池
    public CompletableFuture<String> sendEmail(String to, String content) {
        // 耗时操作...
        return CompletableFuture.completedFuture("sent");
    }
}
```

**为什么不能用默认 SimpleAsyncTaskExecutor？**

| 特性 | SimpleAsyncTaskExecutor（默认） | ThreadPoolTaskExecutor（推荐） |
|------|-------------------------------|-------------------------------|
| 线程复用 | ❌ 每次新建 | ✅ 线程池复用 |
| 资源控制 | ❌ 无上限 | ✅ 可控 |
| 生产可用 | ❌ 会 OOM | ✅ 安全 |
| 性能 | 差（频繁创建销毁） | 好（复用） |

> **踩坑提醒**：不指定 Bean 名称时，`@Async` 使用默认的 `SimpleAsyncTaskExecutor`。生产环境一定要自定义线程池。

### 7.2.2 线程池调优

**痛点**：线程池参数设多少？设错了要么浪费资源，要么任务堆积。

```java
@Bean("taskExecutor")
public ThreadPoolTaskExecutor taskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    // CPU 密集型：corePoolSize = CPU 核心数
    // IO 密集型：corePoolSize = CPU 核心数 * 2
    executor.setCorePoolSize(Runtime.getRuntime().availableProcessors() * 2);
    executor.setMaxPoolSize(Runtime.getRuntime().availableProcessors() * 4);
    executor.setQueueCapacity(200);
    executor.setKeepAliveSeconds(60);
    executor.setThreadName-prefix("biz-");
    executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
    executor.initialize();
    return executor;
}
```

核心参数对吞吐量的影响：

| 参数 | 过小 | 过大 | 调优建议 |
|------|------|------|---------|
| `corePoolSize` | 频繁创建/销毁线程 | 内存浪费 | CPU密集: N, IO密集: 2N |
| `maxPoolSize` | 高并发时任务被拒 | 线程切换开销大 | 核心数的 2-4 倍 |
| `queueCapacity` | 频繁触发拒绝策略 | 任务延迟增大 | 根据业务容忍延迟设定 |
| `rejectedHandler` | — | — | 见下表 |

四种拒绝策略：

| 策略 | 行为 | 适用场景 |
|------|------|---------|
| `AbortPolicy` | 抛 RejectedExecutionException | 需要感知过载 |
| `CallerRunsPolicy` | 调用方线程执行 | 不想丢任务，可接受降速 |
| `DiscardPolicy` | 静默丢弃 | 允许丢失（如日志） |
| `DiscardOldestPolicy` | 丢弃队列最老的任务 | 只关心最新数据 |

> **经验法则**：IO 密集型业务（HTTP 调用、数据库查询）设 `corePoolSize = 2 × CPU核心数`；CPU 密集型（计算、加密）设 `corePoolSize = CPU核心数`。

### 7.2.3 异步异常处理

**痛点**：`@Async` 方法抛异常，默认只打日志不报警，出了问题都不知道。

三种异常处理方式：

```java
// 方式一：全局 AsyncUncaughtExceptionHandler
@Configuration
@EnableAsync
public class AsyncConfig implements AsyncConfigurer {

    @Override
    public Executor getAsyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(5);
        executor.setMaxPoolSize(10);
        executor.setQueueCapacity(100);
        executor.initialize();
        return executor;
    }

    @Override
    public AsyncUncaughtExceptionHandler getAsyncUncaughtExceptionHandler() {
        return (ex, method, params) -> {
            System.err.println("异步方法 " + method.getName() + " 异常: " + ex.getMessage());
            // 发送告警、记录监控指标...
        };
    }
}

// 方式二：返回 CompletableFuture，用 exceptionally 处理
@Service
public class OrderService {

    @Async("taskExecutor")
    public CompletableFuture<String> processOrder(Long orderId) {
        try {
            // 业务逻辑...
            return CompletableFuture.completedFuture("success");
        } catch (Exception e) {
            return CompletableFuture.failedFuture(e);
        }
    }
}

// 调用方
orderService.processOrder(123L)
    .thenAccept(result -> System.out.println("处理成功: " + result))
    .exceptionally(ex -> {
        System.err.println("处理失败: " + ex.getMessage());
        return null;
    });

// 方式三：AsyncResult 包装（Spring 5 之前的方式，现在推荐 CompletableFuture）
@Async
public AsyncResult<String> legacyAsync() {
    return new AsyncResult<>("done");
}
```

| 方式 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| `AsyncUncaughtExceptionHandler` | void 返回值方法 | 全局统一处理 | 只能处理 void 方法 |
| `CompletableFuture` | 需要感知结果 | 调用方灵活处理 | 代码稍复杂 |
| `AsyncResult` | 老项目兼容 | 兼容性好 | 已过时 |

> **踩坑提醒**：`AsyncUncaughtExceptionHandler` 只对返回 `void` 的异步方法生效。返回 `CompletableFuture` 的方法异常会封装在 Future 中，需要调用方自行处理。

### 7.2.4 @Async 失效场景

**痛点**：明明加了 `@Async`，方法却还是同步执行，排查半天找不到原因。

**最常见的 4 个失效场景**：

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

四种失效场景速查：

| 场景 | 原因 | 修复方式 |
|------|------|---------|
| 自调用 | Spring AOP 代理不生效 | 注入自身代理 / 拆分 Bean |
| 非 public | CGLIB/JDK 代理限制 | 改为 public |
| 未开启 | 缺 `@EnableAsync` | 加注解 |
| 异常被吞 | 默认只打日志 | 配置 ExceptionHandler |

> **经验法则**：自调用是 @Async（以及 @Transactional、@Cacheable）失效的头号杀手。记住——凡是走 AOP 代理的注解，自调用都会失效。

---

## 7.3 定时任务

### 7.3.1 @Scheduled 基础

**痛点**：每天凌晨要跑批、每 5 分钟检查订单状态，这种定时逻辑最轻量的方案就是 `@Scheduled`。

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

| 属性 | 含义 | 适用场景 |
|------|------|---------|
| `fixedRate` | 固定频率执行 | 心跳上报、监控采集 |
| `fixedDelay` | 上次完成后固定间隔 | 轮询、消费队列 |
| `cron` | Cron 表达式 | 定时批处理、报表 |

> **踩坑提醒**：`fixedRate` 任务如果执行时间超过间隔，会导致任务堆积。默认单线程池下，后续任务会排队等待。

### 7.3.2 Cron 表达式

**痛点**：Spring Cron 表达式和 Linux Crontab 不一样，照搬 Linux 写法会出错。

Spring Cron 格式：`秒 分 时 日 月 星期`

```java
@Scheduled(cron = "0 0/30 9-17 * * MON-FRI")  // 工作日 9-17 点每 30 分钟
@Scheduled(cron = "0 0 0 1 * ?")               // 每月 1 号零点
@Scheduled(cron = "0 15 10 15 * ?")            // 每月 15 号 10:15
@Scheduled(cron = "0 0 */2 * * ?")             // 每 2 小时
@Scheduled(cron = "0 0 8 ? * MON")             // 每周一 8 点
```

Spring Cron vs Linux Crontab 差异：

| 维度 | Spring Cron | Linux Crontab |
|------|------------|---------------|
| 字段数 | 6 个（含"秒"） | 5 个 |
| 秒 | ✅ 有（第 1 位） | ❌ 无 |
| 星期 | 1-7（1=周一，7=周日） | 0-6（0=周日） |
| 年 | 可选第 7 位 | 无 |
| 特殊字符 | `?`（日/星期互斥） | 无 `?` |

常用 Cron 速查：

| 表达式 | 含义 |
|--------|------|
| `0 0/5 * * * ?` | 每 5 分钟 |
| `0 0 9 * * ?` | 每天 9 点 |
| `0 0 0 * * ?` | 每天零点 |
| `0 0 9 ? * MON-FRI` | 工作日 9 点 |
| `0 0 0 1 1 ?` | 每年 1 月 1 日零点 |

> **踩坑提醒**：`?` 只能用在"日"和"星期"字段，表示"不指定"。当同时指定了日期和星期时会产生歧义，Spring 要求其中一个必须是 `?`。

### 7.3.3 线程池与并发控制

**痛点**：`@Scheduled` 默认用单线程执行所有定时任务，一个任务卡住，全部排队。

```java
@Configuration
public class SchedulingConfig implements SchedulingConfigurer {

    @Override
    public void configureTasks(ScheduledTaskRegistrar taskRegistrar) {
        taskRegistrar.setScheduler(taskExecutor());
    }

    @Bean(destroyMethod = "shutdown")
    public ScheduledExecutorService taskExecutor() {
        return Executors.newScheduledThreadPool(10);
    }
}
```

默认 vs 自定义线程池：

| 场景 | 默认（单线程） | 自定义（多线程） |
|------|--------------|----------------|
| 任务 A 耗时 10s | 任务 B/C/D 排队等 10s | 并发执行 |
| 任务异常 | 其他任务不受影响 | 其他任务不受影响 |
| 适用 | 开发环境 | 生产环境 |

> **踩坑提醒**：生产环境一定要自定义线程池。单线程池下，一个慢任务会阻塞所有其他定时任务。

### 7.3.4 Quartz 动态定时任务

**痛点**：`@Scheduled` 的 cron 写死在代码里，产品说"让用户自己配置定时发送时间"，怎么办？

Quartz 支持运行时动态创建、暂停、恢复任务：

```java
// 1. 添加依赖
// spring-boot-starter-quartz

// 2. 定义 Job
public class ReportJob extends QuartzJobBean {
    @Override
    protected void executeInternal(JobExecutionContext context) {
        String reportType = context.getMergedJobDataMap().getString("type");
        System.out.println("生成报表: " + reportType);
    }
}

// 3. 动态管理任务
@Component
public class QuartzSchedulerManager {

    private final Scheduler scheduler;

    public QuartzSchedulerManager(Scheduler scheduler) {
        this.scheduler = scheduler;
    }

    // 创建任务
    public void addJob(String jobName, String cron, String reportType) throws SchedulerException {
        JobDetail jobDetail = JobBuilder.newJob(ReportJob.class)
                .withIdentity(jobName)
                .usingJobData("type", reportType)
                .build();

        CronTrigger trigger = TriggerBuilder.newTrigger()
                .withIdentity(jobName + "-trigger")
                .withSchedule(CronScheduleBuilder.cronSchedule(cron))
                .build();

        scheduler.scheduleJob(jobDetail, trigger);
    }

    // 暂停任务
    public void pauseJob(String jobName) throws SchedulerException {
        scheduler.pauseJob(JobKey.jobKey(jobName));
    }

    // 恢复任务
    public void resumeJob(String jobName) throws SchedulerException {
        scheduler.resumeJob(JobKey.jobKey(jobName));
    }

    // 删除任务
    public void deleteJob(String jobName) throws SchedulerException {
        scheduler.deleteJob(JobKey.jobKey(jobName));
    }

    // 修改 cron
    public void updateCron(String jobName, String newCron) throws SchedulerException {
        TriggerKey triggerKey = TriggerKey.triggerKey(jobName + "-trigger");
        CronTrigger newTrigger = TriggerBuilder.newTrigger()
                .withIdentity(triggerKey)
                .withSchedule(CronScheduleBuilder.cronSchedule(newCron))
                .build();
        scheduler.rescheduleJob(triggerKey, newTrigger);
    }
}
```

Quartz 集群模式配置（`application.yml`）：

```yaml
spring:
  quartz:
    job-store-type: jdbc          # 使用 JDBC 持久化
    jdbc:
      initialize-schema: always   # 自动建表
    properties:
      org.quartz.scheduler.instanceId: AUTO
      org.quartz.jobStore.isClustered: true
      org.quartz.jobStore.clusterCheckinInterval: 15000
```

`@Scheduled` vs Quartz 对比：

| 维度 | @Scheduled | Quartz |
|------|-----------|--------|
| 动态配置 | ❌ 编译时固定 | ✅ 运行时动态 |
| 持久化 | ❌ | ✅ JDBC JobStore |
| 集群 | ❌ | ✅ |
| 复杂度 | 极低 | 中等 |
| 适用场景 | 简单固定周期 | 用户可配置、集群部署 |

> **经验法则**：90% 的场景用 `@Scheduled` 足够。只有需要"运行时动态增删改"或"集群部署"时才引入 Quartz。

---

## 7.4 缓存抽象

### 7.4.1 @Cacheable/@CacheEvict/@CachePut

**痛点**：查询数据库的方法被频繁调用，每次都要走数据库，性能扛不住。

Spring Cache 用注解就能给方法加缓存，不侵入业务代码：

```java
@Service
public class ProductService {

    private final ProductRepository repository;

    public ProductService(ProductRepository repository) {
        this.repository = repository;
    }

    // @Cacheable：查缓存，有就返回，没有就执行方法并缓存结果
    @Cacheable(value = "products", key = "#id")
    public Product findById(Long id) {
        System.out.println("查询数据库: " + id);
        return repository.findById(id).orElse(null);
    }

    // @CachePut：每次都执行方法，并更新缓存
    @CachePut(value = "products", key = "#product.id")
    public Product update(Product product) {
        return repository.save(product);
    }

    // @CacheEvict：删除缓存
    @CacheEvict(value = "products", key = "#id")
    public void delete(Long id) {
        repository.deleteById(id);
    }

    // 清空整个 products 缓存
    @CacheEvict(value = "products", allEntries = true)
    public void clearCache() {
        System.out.println("缓存已清空");
    }
}
```

三个注解触发时机对比：

| 注解 | 执行方法？ | 读缓存？ | 写缓存？ | 典型场景 |
|------|-----------|---------|---------|---------|
| `@Cacheable` | 缓存未命中时才执行 | ✅ | 缓存未命中时写入 | 查询 |
| `@CachePut` | 每次都执行 | ❌ | ✅ 每次都更新 | 更新 |
| `@CacheEvict` | 每次都执行 | ❌ | ✅ 删除缓存 | 删除/失效 |

> **踩坑提醒**：`@Cacheable` 默认用方法参数做 Key。如果参数是复杂对象，会用对象的 `toString()` 做 Key，可能导致缓存命中失败。

### 7.4.2 缓存管理器与 Redis 集成

**痛点**：本地缓存（如 ConcurrentHashMap）在集群部署时每个节点各存一份，数据不一致。

```java
@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory factory) {
        // 默认配置：600 秒过期
        RedisCacheConfiguration defaultConfig = RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(Duration.ofSeconds(600))
                .serializeKeysWith(RedisSerializationContext.SerializationPair
                        .fromSerializer(new StringRedisSerializer()))
                .serializeValuesWith(RedisSerializationContext.SerializationPair
                        .fromSerializer(new GenericJackson2JsonRedisSerializer()))
                .disableCachingNullValues();

        // 针对不同缓存名配置不同的过期时间
        Map<String, RedisCacheConfiguration> configMap = new HashMap<>();
        configMap.put("products", defaultConfig.entryTtl(Duration.ofMinutes(30)));
        configMap.put("users", defaultConfig.entryTtl(Duration.ofHours(1)));
        configMap.put("hotData", defaultConfig.entryTtl(Duration.ofSeconds(60)));

        return RedisCacheManager.builder(factory)
                .cacheDefaults(defaultConfig)
                .withInitialCacheConfigurations(configMap)
                .transactionAware()  // 支持事务
                .build();
    }
}
```

序列化方式对比：

| 序列化方式 | 可读性 | 体积 | 跨语言 | 推荐度 |
|-----------|--------|------|--------|-------|
| `JdkSerializationRedisSerializer` | ❌ 二进制 | 大 | ❌ | 不推荐 |
| `StringRedisSerializer` | ✅ | 小 | ✅ | Key 推荐 |
| `GenericJackson2JsonRedisSerializer` | ✅ JSON | 中 | ✅ | Value 推荐 |
| `Jackson2JsonRedisSerializer` | ✅ JSON | 中 | ✅ | 需指定类型 |

> **踩坑提醒**：用 `JdkSerializationRedisSerializer`（默认）存的缓存，用 Redis CLI 看到的是乱码。生产环境务必配置 JSON 序列化。

### 7.4.3 缓存穿透/击穿/雪崩

**痛点**：缓存用不好，比不用还糟糕——大量请求直接打到数据库。

三种问题的原理和防护：

**缓存穿透**：查询的数据数据库中也没有，缓存永远不命中。

```java
// 防护方案一：缓存空值
@Cacheable(value = "products", key = "#id", unless = "#result == null ? false : true")
// 或者手动缓存空值
public Product findById(Long id) {
    Product product = repository.findById(id).orElse(null);
    if (product == null) {
        // 缓存空值，设置较短过期时间
        redisTemplate.opsForValue().set("products:" + id, "NULL", 5, TimeUnit.MINUTES);
    }
    return product;
}

// 防护方案二：布隆过滤器（适合数据量大的场景）
// 使用 Redisson 的 RBloomFilter
```

**缓存击穿**：热点 Key 过期的瞬间，大量请求同时打到数据库。

```java
// 防护：分布式锁
public Product findByIdWithLock(Long id) {
    String key = "products:" + id;
    Product product = redisTemplate.opsForValue().get(key);
    if (product != null) return product;

    String lockKey = "lock:product:" + id;
    boolean locked = redisTemplate.opsForValue()
            .setIfAbsent(lockKey, "1", 10, TimeUnit.SECONDS);
    if (locked) {
        try {
            product = repository.findById(id).orElse(null);
            if (product != null) {
                redisTemplate.opsForValue().set(key, product, 30, TimeUnit.MINUTES);
            }
        } finally {
            redisTemplate.delete(lockKey);
        }
    }
    return product;
}
```

**缓存雪崩**：大量 Key 同时过期，请求全部打到数据库。

```java
// 防护：过期时间加随机值
public Product findByIdWithJitter(Long id) {
    String key = "products:" + id;
    Product product = redisTemplate.opsForValue().get(key);
    if (product == null) {
        product = repository.findById(id).orElse(null);
        if (product != null) {
            // 基础过期 30 分钟 + 随机 0-5 分钟
            long ttl = 30 * 60 + ThreadLocalRandom.current().nextInt(300);
            redisTemplate.opsForValue().set(key, product, ttl, TimeUnit.SECONDS);
        }
    }
    return product;
}
```

三种问题速查表：

| 问题 | 原因 | 现象 | 防护方案 |
|------|------|------|---------|
| 穿透 | 查询不存在的数据 | 缓存永远 miss | 缓存空值 / 布隆过滤器 |
| 击穿 | 热点 Key 过期 | 瞬时高并发打 DB | 互斥锁 / 逻辑过期 |
| 雪崩 | 大量 Key 同时过期 | DB 瞬间压力暴涨 | 过期时间加随机值 |

> **经验法则**：缓存穿透是代码问题（没处理 null），缓存击穿是热点问题（没加锁），缓存雪崩是配置问题（过期时间太统一）。

### 7.4.4 自定义缓存 Key 生成策略

**痛点**：默认 Key 生成器用所有参数，一个参数是复杂对象就生成出奇怪的 Key。

```java
// SpEL 表达式自定义 Key
@Cacheable(value = "users", key = "#username + ':' + #region")
public User findByUsernameAndRegion(String username, String region) {
    return repository.findByUsernameAndRegion(username, region);
}

// 使用方法名 + 参数组合
@Cacheable(value = "orders", key = "T(String).valueOf(#userId).concat(':').concat(#status)")
public List<Order> findOrders(Long userId, String status) {
    return repository.findByUserIdAndStatus(userId, status);
}

// 方式二：自定义 KeyGenerator
@Configuration
public class CacheKeyConfig {

    @Bean
    public KeyGenerator customKeyGenerator() {
        return (target, method, params) -> {
            // 用类名 + 方法名 + 参数生成 Key
            return target.getClass().getSimpleName()
                    + ":" + method.getName()
                    + ":" + Arrays.deepHashCode(params);
        };
    }
}

// 使用自定义 KeyGenerator
@Cacheable(value = "products", keyGenerator = "customKeyGenerator")
public List<Product> search(String keyword, int page, int size) {
    return repository.search(keyword, PageRequest.of(page, size));
}
```

SpEL 常用变量：

| 变量 | 含义 | 示例 |
|------|------|------|
| `#参数名` | 方法参数 | `#id`, `#username` |
| `#result` | 方法返回值（unless 中可用） | `#result.size() > 0` |
| `#root.method` | 当前方法 | `#root.method.name` |
| `#root.target` | 目标对象 | `#root.target.class.simpleName` |
| `T(类名)` | 调用静态方法 | `T(System).currentTimeMillis()` |

> **踩坑提醒**：`#result` 只能在 `unless` 和 `condition` 中使用，不能在 `key` 中使用（因为 Key 在方法执行前就要确定）。

---

## 7.5 消息集成

### 7.5.1 Kafka 集成

**痛点**：微服务之间需要异步通信，Kafka 是首选，但配置和使用有很多细节。

```java
// 1. 依赖
// spring-kafka

// 2. 配置
// application.yml
spring:
  kafka:
    bootstrap-servers: localhost:9092
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
      acks: all
      retries: 3
    consumer:
      group-id: order-service
      auto-offset-reset: earliest
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.springframework.kafka.support.serializer.JsonDeserializer
      properties:
        spring.json.trusted.packages: "com.example.dto"

// 3. 生产者
@Service
public class OrderProducer {

    private final KafkaTemplate<String, OrderEvent> kafkaTemplate;

    public OrderProducer(KafkaTemplate<String, OrderEvent> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    public void sendOrderCreated(OrderEvent event) {
        kafkaTemplate.send("order-events", event.getOrderId().toString(), event)
                .addCallback(
                    result -> System.out.println("发送成功: " + result.getRecordMetadata()),
                    ex -> System.err.println("发送失败: " + ex.getMessage())
                );
    }
}

// 4. 消费者
@Component
public class OrderConsumer {

    @KafkaListener(topics = "order-events", groupId = "payment-service")
    public void handleOrderCreated(
            @Payload OrderEvent event,
            @Header(KafkaHeaders.RECEIVED_PARTITION) int partition,
            @Header(KafkaHeaders.OFFSET) long offset,
            Acknowledgment acknowledgment) {
        try {
            System.out.println("收到消息: partition=" + partition + ", offset=" + offset);
            // 处理业务...
            acknowledgment.acknowledge();  // 手动确认
        } catch (Exception e) {
            // 处理失败，稍后重试
            throw e;
        }
    }
}
```

消费者组与分区策略：

| 概念 | 说明 |
|------|------|
| 消费者组（Group） | 同组内的消费者分摊消费，不同组各自消费全量 |
| 分区分配 | 一个分区只能被同组内的一个消费者消费 |
| 分区数 ≥ 消费者数 | 多余的消费者会空闲 |
| Rebalance | 消费者加入/退出时自动重新分配分区 |

> **踩坑提醒**：`spring.kafka.consumer.auto-commit-enable=true`（默认）在消息处理失败时会丢失消息。生产环境务必设置 `enable-auto-commit: false`，手动 `acknowledge()`。

### 7.5.2 RabbitMQ 集成

**痛点**：需要延迟消息（如订单 30 分钟未支付自动关闭）、死信队列处理失败消息。

```java
// 1. 配置
@Configuration
public class RabbitConfig {

    // 死信交换机
    @Bean
    public DirectExchange deadLetterExchange() {
        return new DirectExchange("dlx.exchange");
    }

    // 死信队列
    @Bean
    public Queue deadLetterQueue() {
        return QueueBuilder.durable("dlx.queue").build();
    }

    @Bean
    public Binding deadLetterBinding() {
        return BindingBuilder.bind(deadLetterQueue())
                .to(deadLetterExchange())
                .with("dlx.routing-key");
    }

    // 业务队列（绑定死信交换机）
    @Bean
    public Queue orderQueue() {
        return QueueBuilder.durable("order.queue")
                .withArgument("x-dead-letter-exchange", "dlx.exchange")
                .withArgument("x-dead-letter-routing-key", "dlx.routing-key")
                .withArgument("x-message-ttl", 30000)  // 30 秒 TTL
                .build();
    }
}

// 2. 发送延迟消息
@Service
public class OrderProducer {

    private final RabbitTemplate rabbitTemplate;

    public OrderProducer(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    // 发送延迟消息（利用 TTL + 死信队列实现延迟）
    public void sendDelayedCloseOrder(Long orderId, long delayMs) {
        rabbitTemplate.convertAndSend("order.delay.exchange", "order.delay.routing-key",
                orderId, message -> {
                    message.getMessageProperties().setExpiration(String.valueOf(delayMs));
                    return message;
                });
    }
}

// 3. 消费者
@Component
public class OrderConsumer {

    @RabbitListener(queues = "order.queue")
    public void handleOrderMessage(Long orderId, Channel channel,
                                    @Header(AmqpHeaders.DELIVERY_TAG) long tag) {
        try {
            System.out.println("处理订单: " + orderId);
            channel.basicAck(tag, false);
        } catch (Exception e) {
            try {
                channel.basicNack(tag, false, false);  // 拒绝，进入死信队列
            } catch (IOException ex) {
                ex.printStackTrace();
            }
        }
    }
}
```

RabbitMQ 延迟消息方案对比：

| 方案 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| TTL + 死信队列 | 消息在队列中超时后转入死信 | 原生支持 | 每个延迟时间需建队列 |
| rabbitmq-delayed-message-exchange 插件 | 交换机级别延迟 | 灵活 | 需安装插件 |
| 延迟消息表 + 定时扫描 | 数据库存消息，定时捞 | 无额外依赖 | 实时性差 |

> **踩坑提醒**：TTL + 死信队列方案中，消息是在**队列头部**开始计算 TTL 的。如果队首消息 TTL=30s，第二条 TTL=5s，第二条也要等第一条过期才能被处理。插件方案没有这个问题。

### 7.5.3 消息可靠性保证

**痛点**：消息从生产到消费，任何一环都可能丢消息，怎么保证不丢？

全链路可靠性保证：

```
生产者 ──确认──► Broker ──持久化──► 存储 ──ACK──► 消费者 ──幂等──► 业务
  ①              ②                    ③              ④
```

```java
// ① 生产者确认（Kafka）
spring:
  kafka:
    producer:
      acks: all          # 所有副本确认
      retries: 3         # 重试次数

// ② Broker 持久化（Kafka）
// topic 配置: replication.factor=3, min.insync.replicas=2

// ③ 消费者手动 ACK（Kafka）
@KafkaListener(topics = "order-events")
public void consume(OrderEvent event, Acknowledgment ack) {
    try {
        processEvent(event);
        ack.acknowledge();  // 手动确认
    } catch (Exception e) {
        // 不 ack，消息会被重新投递
        throw e;
    }
}

// ④ 幂等消费（防止重复消费）
@Service
public class IdempotentConsumer {

    private final RedisTemplate<String, String> redisTemplate;

    public IdempotentConsumer(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public boolean processIfNotDuplicate(String messageId, Runnable action) {
        String key = "processed:" + messageId;
        // SETNX：设置成功说明是第一次处理
        Boolean isNew = redisTemplate.opsForValue()
                .setIfAbsent(key, "1", 24, TimeUnit.HOURS);
        if (Boolean.TRUE.equals(isNew)) {
            action.run();
            return true;
        }
        System.out.println("重复消息，跳过: " + messageId);
        return false;
    }
}
```

全链路可靠性检查清单：

| 环节 | 风险 | 保障措施 |
|------|------|---------|
| 生产者 | 网络抖动、Broker 宕机 | 开启 Producer ACK / Confirm |
| Broker | 机器宕机 | 多副本 + 持久化 |
| 消费者 | 处理失败 | 手动 ACK + 重试 |
| 业务 | 重复消费 | 幂等设计（唯一键/状态机） |

> **经验法则**：消息可靠性 = 生产者确认 + Broker 持久化 + 消费者手动 ACK + 业务幂等。四个环节缺一不可。

---

## 本章总结

| 场景 | 推荐方案 | 复杂度 |
|------|---------|--------|
| 进程内解耦 | Spring Event | ⭐ |
| 异步执行 | @Async + 自定义线程池 | ⭐⭐ |
| 固定周期任务 | @Scheduled | ⭐ |
| 动态定时任务 | Quartz | ⭐⭐⭐ |
| 方法级缓存 | @Cacheable + Redis | ⭐⭐ |
| 跨服务异步通信 | Kafka / RabbitMQ | ⭐⭐⭐ |

> **一句话总结**：Spring Event 解耦模块，@Async 异步提速，@Scheduled 定时执行，Cache 注解加速查询，MQ 实现跨服务通信——按需选型，不过度设计。
