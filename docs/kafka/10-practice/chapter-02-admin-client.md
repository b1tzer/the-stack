# AdminClient：用代码管理 Kafka

集群管理的运维命令（Topic、配置、分区重分配、扩缩容）见 [集群管理](../06-operations/chapter-02-cluster-management.md)；本篇讲代码化管理：业务或平台代码里如何用 Java API 完成同样的事。

`kafka-topics.sh`、`kafka-configs.sh`、`kafka-consumer-groups.sh` 这些 shell 脚本适合运维手动操作，但**业务代码里需要动态管理 Kafka**时它们就成了瓶颈。Java 应用虽然也能通过子进程调用脚本，但会带来进程管理、输出解析和错误处理的额外成本；需要把管理操作集成进应用或平台时，直接调用 Admin API 更合适。

AdminClient 是 Kafka 从 [KIP-4](https://cwiki.apache.org/confluence/x/kJi8Aw) 起规划、[KIP-117](https://cwiki-test.apache.org/confluence/x/qx4IB) 在 0.11.0 引入的编程式管理 API。它通过 wire protocol 直接和 broker 说话，不再依赖 ZooKeeper，把 Topic 创建删除、配置修改、消费组查询与 Offset 管理这些操作都暴露成了 Java 方法。Admin API 与命令行工具并非严格一一对应，人工运维和一次性操作仍以命令行工具更直接。

## 1. 什么时候需要 AdminClient

三类典型场景：

**1. 应用启动时按需建 topic**。IoT / SaaS 平台每接入一个新租户就要一个专属 topic。让应用直接建，不用等运维处理工单。

**2. 消费组治理与监控**。列出所有消费组、看每个组的 lag、给某组重置 offset——比每次跑 `kafka-consumer-groups.sh` 快得多。

**3. 灾备切换 / 数据迁移**。切换脚本要动态改 `min.insync.replicas`、执行分区重分配、批量修改 topic 配置。手工执行既慢又易错。

## 2. 依赖与创建

Maven 坐标（本文示例以 3.7.0 为基线）：

```xml
<dependency>
    <groupId>org.apache.kafka</groupId>
    <artifactId>kafka-clients</artifactId>
    <version>3.7.0</version>
</dependency>
```

创建实例：

```java
Properties props = new Properties();
props.put(AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG, "kafka:9092");
props.put(AdminClientConfig.REQUEST_TIMEOUT_MS_CONFIG, 30_000);
props.put(AdminClientConfig.CLIENT_ID_CONFIG, "order-service-admin");

// 下面以 SASL/SCRAM over TLS 为例，实际应与集群启用的认证机制和监听器协议一致
props.put("security.protocol", "SASL_SSL");
props.put("sasl.mechanism", "SCRAM-SHA-512");
props.put("sasl.jaas.config",
    "org.apache.kafka.common.security.scram.ScramLoginModule required " +
    "username=\"admin\" password=\"...\";");

try (Admin admin = Admin.create(props)) {
    // ... 所有操作在这里
}
```

::: tip Admin 与 AdminClient 的关系
`Admin` 是接口（Kafka 2.7 引入），`AdminClient` 是它的抽象基类，`KafkaAdminClient` 是默认实现。**新代码优先使用 `Admin` 接口**，通过 `Admin.create(props)` 获取实例，避免依赖具体实现类。旧代码里的 `AdminClient.create(props)` 也可以用，返回同一个实现。
:::

AdminClient 是**线程安全的**，一个应用共享一个实例即可，不需要为每个操作创建。

## 3. 常用操作速查

所有 AdminClient 方法都是**异步**的，返回一个 `*Result` 对象。取值通过 `.all().get()`（阻塞）或 `.all().whenComplete(...)`（回调链）。每个操作对应的运维命令见 [集群管理](../06-operations/chapter-02-cluster-management.md)，这里只讲代码视角的调用方式与注意点。

### 3.1 创建 Topic

```java
NewTopic ordersTopic = new NewTopic("orders", 12, (short) 3)
    .configs(Map.of(
        "retention.ms",         "604800000",   // 7 天
        "min.insync.replicas",  "2",
        "compression.type",     "lz4"
    ));

try {
    admin.createTopics(List.of(ordersTopic)).all().get();
} catch (ExecutionException e) {
    if (e.getCause() instanceof TopicExistsException) {
        // 幂等：已存在就跳过
    } else {
        throw e;
    }
}
```

**幂等模式**：Topic 创建应按幂等操作设计，直接调用 `createTopics()` 并把 `TopicExistsException` 当作可预期的结果处理。不要依赖「先 `listTopics()` 再创建」来避免重复创建，因为查询与创建之间可能发生并发变化，两个实例可能同时查到不存在、又同时创建。若 Topic 已存在，还应确认现有分区数和配置是否符合预期，仅仅不报错不代表现有 Topic 满足要求。

### 3.2 增加分区

**只能增加，不能减少**。减少分区需要重建 topic。

```java
Map<String, NewPartitions> updates = Map.of(
    "orders", NewPartitions.increaseTo(24)  // 从 12 增到 24
);
admin.createPartitions(updates).all().get();
```

::: warning 分区增加可能破坏 key 顺序
Kafka 默认分区器对有 key 的记录按 key 哈希选分区，分区数增加后，默认分区映射可能变化，同一 key 的新记录可能进入与旧记录不同的分区。Kafka 只保证单个分区内的顺序，不保证跨分区记录在消费端仍按原先后顺序处理。因此依赖 key 顺序的业务不能把增加分区当成无风险的扩容操作。
:::

分区模型与 key 分配机制见 [分区与 Offset](../02-core/chapter-01-partition-and-offset.md)；分区数怎么规划见 [分区数选择](../04-performance/chapter-03-partition-sizing.md)。

### 3.3 修改配置（`incrementalAlterConfigs`）

Kafka 2.3 起将整体覆盖式的 `alterConfigs` 标记为废弃（当前仍可用），推荐改用 `incrementalAlterConfigs`——支持 SET / APPEND / SUBTRACT / DELETE 四种操作。

```java
ConfigResource resource = new ConfigResource(ConfigResource.Type.TOPIC, "orders");

Collection<AlterConfigOp> ops = List.of(
    new AlterConfigOp(new ConfigEntry("retention.ms", "1209600000"), // SET 覆盖为 14 天
                      AlterConfigOp.OpType.SET),
    new AlterConfigOp(new ConfigEntry("cleanup.policy", "compact"),  // APPEND 追加列表值
                      AlterConfigOp.OpType.APPEND)
);

admin.incrementalAlterConfigs(Map.of(resource, ops)).all().get();
```

四种 `OpType` 的语义：

- `SET`：把配置设为指定值，覆盖旧值。
- `APPEND`：向支持列表操作的配置追加值，不是整体覆盖。例如 `cleanup.policy` 追加 `compact` 后，最终取值还取决于修改前的配置（`delete`、`compact` 或两者组合）。
- `SUBTRACT`：从支持列表操作的配置中移除指定值。
- `DELETE`：删除该配置的显式覆盖值，回退到默认值或其他配置来源。

数据来源：[Admin Javadoc](https://kafka.apache.org/34/javadoc/org/apache/kafka/clients/admin/package-summary.html)。

### 3.4 列出 / 描述 Topic

```java
// 列出全部
Set<String> allTopics = admin.listTopics().names().get();

// 描述指定 topic
Map<String, TopicDescription> desc = admin.describeTopics(List.of("orders"))
    .allTopicNames().get();

TopicDescription orders = desc.get("orders");
orders.partitions().forEach(p -> {
    System.out.printf("partition=%d leader=%s isr=%s%n",
        p.partition(), p.leader(), p.isr());
});
```

`listTopics` + `describeTopics` + `describeConfigs` 三个方法组合，可以覆盖 `kafka-topics.sh --describe` 的日常查询需求。

### 3.5 消费组：列出与 Lag 计算

**列出所有消费组**：

```java
Collection<ConsumerGroupListing> groups = admin.listConsumerGroups().all().get();
groups.forEach(g -> System.out.println(g.groupId() + " state=" + g.state()));
```

**计算某个组的 Lag**：需要三步取值——组当前 committed offset、topic 的 log-end offset、相减。

```java
String group = "order-service";

// 1. 组的已提交 offset
Map<TopicPartition, OffsetAndMetadata> committed =
    admin.listConsumerGroupOffsets(group).partitionsToOffsetAndMetadata().get();

// 2. 每个 partition 的 log-end offset
Map<TopicPartition, OffsetSpec> query = committed.keySet().stream()
    .collect(Collectors.toMap(tp -> tp, tp -> OffsetSpec.latest()));
Map<TopicPartition, ListOffsetsResult.ListOffsetsResultInfo> latest =
    admin.listOffsets(query).all().get();

// 3. 相减
committed.forEach((tp, off) -> {
    long lag = latest.get(tp).offset() - off.offset();
    System.out.printf("%s-%d lag=%d%n", tp.topic(), tp.partition(), lag);
});
```

这个示例演示了常见的 Lag 计算方式：用分区 log-end offset 减去消费组已提交的 offset。它只统计已提交过 offset 的分区，且两次查询不是原子快照，适合用来理解计算过程，不应直接当作完整的消费组监控实现。做成定时任务上报到 Prometheus 就是自建 lag 监控；Lag 持续增长时的定位方法见 [消费者 Lag 过大](../05-troubleshooting/chapter-01-consumer-lag.md)。

### 3.6 重置消费组 Offset

灾备切换、消息重放场景需要。**重置前应先停止该消费组的所有消费者**。消费者仍在运行时可能继续提交原 offset、或在重置后继续消费，使重置结果与预期不一致。先停消费者、执行重置并核对结果，再恢复消费，可以减少这类竞态；具体失败原因应以 API 返回的异常为准。

```java
Map<TopicPartition, OffsetAndMetadata> resetTo = Map.of(
    new TopicPartition("orders", 0), new OffsetAndMetadata(1000L),
    new TopicPartition("orders", 1), new OffsetAndMetadata(500L)
);
admin.alterConsumerGroupOffsets("order-service", resetTo).all().get();
```

若要重置到某时间点，先用 `listOffsets` + `OffsetSpec.forTimestamp(...)` 拿到目标时间对应的 offset，再走这个 API。

### 3.7 集群信息

```java
DescribeClusterResult cluster = admin.describeCluster();
System.out.println("cluster id: " + cluster.clusterId().get());
System.out.println("controller: " + cluster.controller().get());
System.out.println("nodes:      " + cluster.nodes().get());
```

`clusterId` 常用于跨集群识别；`controller()` 拿到当前 Controller 节点（KRaft 模式下也可用）。

## 4. 异步与超时

AdminClient 的所有 `.get()` 都会阻塞直至完成或超时。生产代码建议**显式设超时**：

```java
admin.createTopics(topics).all().get(30, TimeUnit.SECONDS);
```

这个 30 秒是调用线程等待结果的上限，不代表服务端一定在 30 秒内完成或回滚操作；超时也不能直接等同于操作失败，应查询集群状态再决定是否重试。

不显式设超时时，等待时间与单次请求超时是两回事。Kafka 3.7 中 `request.timeout.ms` 默认 30 秒，限制单次请求等待响应的时间；`default.api.timeout.ms` 默认 60 秒，为未单独指定超时的 Admin API 操作提供默认上限。控制器选举、请求重试或网络故障都可能影响操作完成时间。

回调链式风格避免阻塞主线程：

```java
admin.createTopics(topics).all().whenComplete((v, err) -> {
    if (err != null) log.error("create failed", err);
    else            log.info("created");
});
```

## 5. 权限模型

AdminClient 与普通客户端一样受 Kafka ACL 约束。常见的最小权限：

| 操作 | 所需 ACL | 授予对象 |
| :-- | :-- | :-- |
| `createTopics` | `Create` on Cluster **或** `Create` on Topic | Cluster / Topic 名 |
| `deleteTopics` | `Delete` on Topic | Topic 名 |
| `createPartitions` | `Alter` on Topic | Topic 名 |
| `alterConfigs` / `incrementalAlterConfigs` | `AlterConfigs` on Topic / Cluster | Topic 名 / Cluster |
| `describeTopics` / `describeCluster` | `Describe` on Topic / Cluster | Topic 名 / Cluster |
| `listConsumerGroups` | `Describe` on Group，列出全部还需 Cluster 级 `Describe` | Group ID / Cluster |
| `alterConsumerGroupOffsets` | `Read` on Group | Group ID |

`alterConsumerGroupOffsets` 只需 Group 的 `Read` 权限，与消费者提交 Offset 时的 `OFFSET_COMMIT` 需要同时检查 Group 与 Topic 两类资源不同，两者不要混淆。

实际授权还受 Kafka 版本、授权器实现与资源匹配规则影响，上表按 3.7 基线整理，不作为无适用条件的「最小权限」模板。

生产环境**不要**用 broker super user 跑 AdminClient——为运维应用单独建 SASL 账号、给最小权限。

## 6. 常见坑

**坑一：`createTopics` 返回成功 ≠ 立即可用**。API 返回时 Controller 已经写入元数据，但**其他 broker 可能需要数秒才能感知新 Topic**。若创建后马上发送消息，Producer 可能暂时遇到 `UNKNOWN_TOPIC_OR_PARTITION`。若业务流程必须在建 Topic 后立即使用，应为后续操作设计有界重试并在重试期间重新获取元数据，不要只调用一次 `describeTopics` 就认定 Topic 已完全可用。

**坑二：自动建 topic 由 Producer / Consumer 触发，而非 AdminClient**。当 `auto.create.topics.enable=true` 时，Producer 或 Consumer 首次访问不存在的 Topic 会触发 broker 自动建 topic，但 AdminClient 的 `describeTopics` 从 0.11.0 起（[KAFKA-5291](https://issues.apache.org/jira/browse/KAFKA-5291)）就在元数据请求中禁用了自动创建，不会顺手建 topic。生产集群仍应关闭自动建 topic（`auto.create.topics.enable=false`），避免拼写错误静默建出分区数不符预期的 topic。

**坑三：`deleteTopics` 成功 ≠ 立即消失**。API 返回成功后，所有 broker 可能需要数秒才能感知 topic 已删除，这段时间内 `listTopics()` 和 `describeTopics()` 可能仍会返回该 topic 的信息；磁盘文件的清理则可能持续更久。此外，若 broker 配置了 `delete.topic.enable=false`，`deleteTopics` 只会标记删除而不会真正删除，此时 future 依然返回成功。若需确认完全删除，应轮询 `describeTopics` 直到抛出 `UnknownTopicOrPartitionException`。

**坑四：忘记 close**。AdminClient 内部有 socket 连接、后台线程。忘记 `close()` 会造成资源泄露。始终用 try-with-resources。

## 7. 与 Spring Kafka 的关系

Spring Kafka 提供 `KafkaAdmin` 是 AdminClient 的封装。用法：

```java
@Configuration
public class KafkaTopicConfig {

    @Bean
    public KafkaAdmin kafkaAdmin() {
        return new KafkaAdmin(Map.of(
            AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG, "kafka:9092"
        ));
    }

    // 声明式创建 topic：应用启动时自动执行
    @Bean
    public NewTopic ordersTopic() {
        return TopicBuilder.name("orders")
            .partitions(12)
            .replicas(3)
            .config("min.insync.replicas", "2")
            .build();
    }
}
```

Spring 应用里，`KafkaAdmin` 适合由容器托管的 Topic 声明与启动时检查；需要显式控制操作时机、参数和结果处理，或需要按业务事件运行时动态管理时，推荐直接注入 `AdminClient`。Spring Kafka 也能通过其封装完成部分运行时管理，取舍在于是否需要容器托管与声明式配置。另外，示例中的 `KafkaAdmin` 只配了 Bootstrap Servers，若目标集群启用了认证，Spring 配置同样要提供对应的安全参数，不能直接照搬前面 SASL_SSL 集群的连接。
