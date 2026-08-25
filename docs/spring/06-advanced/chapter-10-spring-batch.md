# Spring Batch 批处理

> 对账、报表、数据同步这类任务，一次要处理几十万甚至上百万条数据。直接写个 `for` 循环遍历所有数据，内存扛不住、中途失败要重头再来。Spring Batch 用「分块 + 可重启」解决这两件事。这一章讲清楚它的核心模型和最小可用写法。

## 1. 什么时候需要它

普通业务请求是「一条数据进出」，批处理是「一批数据进出」。判断要不要上 Spring Batch，看两条：

| 场景 | 用不用 Spring Batch |
| :-- | :-- |
| 单次处理几百条，失败重跑也无所谓 | ❌ 一个循环 + 事务就够了 |
| 一次几十万条、中途失败要续跑、要监控进度 | ✅ 用 Spring Batch |

它的两个核心价值：**分块处理**（不会把全部数据一次装进内存）和**可重启**（失败后从上次断点继续，不重头再来）。

---

## 2. 核心模型：Job 与 Step

一个批处理任务是一个 `Job`，`Job` 由若干 `Step` 串起来。每个 `Step` 是「读 → 处理 → 写」三段式：

```text
Job
└── Step 1（数据同步）
│     ├── ItemReader    读一条
│     ├── ItemProcessor 处理一条（可选）
│     └── ItemWriter    写一批
└── Step 2（报表生成）
```

几个接口的职责：

| 接口 | 职责 | 典型实现 |
| :-- | :-- | :-- |
| `ItemReader` | 一条条读数据 | `JdbcCursorItemReader`、`FlatFileItemReader` |
| `ItemProcessor` | 单条转换、过滤 | 自定义，返回 `null` 表示跳过该条 |
| `ItemWriter` | 批量写 | `JdbcBatchItemWriter`、自定义 |
| `JobRepository` | 持久化 Job/Step 执行状态 | 默认存数据库，重启的基础 |
| `JobLauncher` | 启动 Job | 手动或由 `@Scheduled` 触发 |

---

## 3. Chunk 分块模型

Spring Batch 不是读一条写一条，而是攒够一个 chunk（比如 100 条）再批量写。关键在**事务边界落在 chunk 上**：

```text
读 100 条 → 处理 100 条 → 批量写 100 条 → 提交事务 → 下一个 chunk
```

一个 chunk 内任何一条失败，整个 chunk 回滚。好处有两个：内存里始终只有 chunk 大小的数据；每个 chunk 是独立的提交点，配合 `JobRepository` 就能实现断点续跑。

---

## 4. 最小可运行示例

Spring Boot 3.x 里 `JobBuilderFactory` / `StepBuilderFactory` 已被 `JobBuilder` / `StepBuilder` 取代，直接注入 `JobRepository`：

```java
@Configuration
public class BatchConfig {

    @Bean
    public Job importUserJob(JobRepository jobRepository, Step step) {
        return new JobBuilder("importUserJob", jobRepository)
            .start(step)
            .build();
    }

    @Bean
    public Step step(JobRepository jobRepository, PlatformTransactionManager tx,
                     DataSource dataSource) {
        return new StepBuilder("step", jobRepository)
            .<User, User>chunk(100, tx)          // 每 100 条一个 chunk
            .reader(reader(dataSource))
            .processor(processor())
            .writer(writer(dataSource))
            .build();
    }

    @Bean
    public ItemReader<User> reader(DataSource dataSource) {
        return new JdbcCursorItemReaderBuilder<User>()
            .name("userReader")
            .dataSource(dataSource)
            .sql("SELECT id, name, status FROM user WHERE status = 'PENDING'")
            .rowMapper(new BeanPropertyRowMapper<>(User.class))
            .build();
    }

    @Bean
    public ItemProcessor<User, User> processor() {
        return user -> {
            user.setStatus("PROCESSED");
            return user;
        };
    }

    @Bean
    public ItemWriter<User> writer(DataSource dataSource) {
        return new JdbcBatchItemWriterBuilder<User>()
            .dataSource(dataSource)
            .sql("UPDATE user SET status = :status WHERE id = :id")
            .beanMapped()
            .build();
    }
}
```

启动 Job 只需注入 `JobLauncher`：

```java
@Component
public class BatchRunner {
    private final JobLauncher jobLauncher;
    private final Job job;

    public BatchRunner(JobLauncher jobLauncher, Job job) {
        this.jobLauncher = jobLauncher;
        this.job = job;
    }

    public void run() throws Exception {
        jobLauncher.run(job, new JobParameters());
    }
}
```

---

## 5. 失败重启与跳过

**重启**：`JobRepository` 把每个 Step、每个 chunk 的执行状态持久化到数据库。任务中途挂了，用**相同的 `JobParameters`** 再次启动，它会从上次失败的 chunk 继续，而不是从头读。前提是 `JobParameters` 相同——所以每次运行要么用固定参数，要么用带时间戳的参数并接受「新参数 = 新 Job 实例」。

**跳过与重试**：对「个别脏数据导致失败」的场景，与其整个 Job 失败，不如跳过坏数据：

```java
return new StepBuilder("step", jobRepository)
    .<User, User>chunk(100, tx)
    .reader(reader(dataSource))
    .writer(writer(dataSource))
    .faultTolerant()
    .skip(DataIntegrityViolationException.class)  // 跳过这类异常
    .skipLimit(100)                               // 最多跳过 100 条
    .retry(TransientException.class)              // 瞬时异常重试
    .build();
```

`skip` 是「这条数据不要了，继续下一条」，`retry` 是「这条数据再试一次」。两者针对不同问题：前者是数据本身有问题，后者是临时故障。

---

## 6. CSV 文件导入示例

除了数据库读取，CSV 文件导入也是常见场景：

```java
@Bean
public ItemReader<User> csvReader() {
    return new FlatFileItemReaderBuilder<User>()
        .name("userCsvReader")
        .resource(new ClassPathResource("users.csv"))
        .delimited()                          // 分隔符模式
        .names("id", "name", "email")         // 列名映射
        .fieldSetMapper(new BeanPropertyRowMapper<>(User.class))
        .linesToSkip(1)                       // 跳过表头
        .build();
}
```

`users.csv` 格式：
```csv
id,name,email
1,张三,zhangsan@example.com
2,李四,lisi@example.com
```

---

## 7. Job 参数传递

Job 参数让同一个 Job 可以处理不同数据：

```java
// 传递参数启动 Job
public void runJob(String fileName) throws Exception {
    JobParameters params = new JobParametersBuilder()
        .addLong("timestamp", System.currentTimeMillis())  // 每次运行不同，保证是新 Job 实例
        .addString("fileName", fileName)                    // 业务参数
        .toJobParameters();
    jobLauncher.run(job, params);
}

// 在 Step 中读取参数
// Spring Batch 5 中，要用 #{jobParameters[...]} 读取参数，Bean 必须加 @StepScope
@Bean
@StepScope
public ItemReader<User> reader(DataSource dataSource, @Value("#{jobParameters['fileName']}") String fileName) {
    // 使用 fileName 参数...
}
```

参数用途：

| 参数类型 | 用途 | 示例 |
| :-- | :-- | :-- |
| `Long` 时间戳 | 保证每次运行是新 Job 实例 | `addLong("timestamp", System.currentTimeMillis())` |
| `String` 业务参数 | 控制处理范围 | `addString("fileName", "users.csv")` |
| `Date` 时间范围 | 按日期处理数据 | `addDate("startDate", start)` |

---

## 8. 小结

Spring Batch 的价值在「分块」和「可重启」：chunk 控制内存占用并划定事务边界，`JobRepository` 记录执行状态支撑断点续跑。Job 由 Step 组成，Step 是「读 → 处理 → 写」三段式。用它的判断标准很简单——单次数据量大到「重跑一次代价不可接受」时，才值得引入这套模型，否则一个循环加事务更省事。
