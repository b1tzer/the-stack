# AdminClient：用代码管理 Kafka

`kafka-topics.sh`、`kafka-configs.sh`、`kafka-consumer-groups.sh` 这些 shell 脚本适合运维手动操作，但**业务代码里需要动态管理 Kafka**时它们就成了瓶颈——你不能在 Java 应用里 shell out 去执行脚本。

AdminClient 是 Kafka 从 [KIP-4](https://cwiki.apache.org/confluence/x/kJi8Aw) 起规划、[KIP-117](https://cwiki-test.apache.org/confluence/x/qx4IB) 在 0.11.0 引入的编程式管理 API。它把命令行工具能做的事全部翻译成了 Java 方法，通过 wire protocol 直接和 broker 说话，不再依赖 ZooKeeper。

## 1. 什么时候需要 AdminClient

三类典型场景：

**1. 应用启动时按需建 topic**。IoT / SaaS 平台每接入一个新租户就要一个专属 topic。让应用直接建，不用等运维处理工单。

**2. 消费组治理与监控**。列出所有消费组、看每个组的 lag、给某组重置 offset——比每次跑 `kafka-consumer-groups.sh` 快得多。

**3. 灾备切换 / 数据迁移**。切换脚本要动态改 `min.insync.replicas`、执行分区重分配、批量修改 topic 配置。手工执行既慢又易错。

## 2. 依赖与创建

Maven 坐标（Kafka 3.x 起）：

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

// 生产环境几乎都有 SASL/SSL，一并配上
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
`Admin` 是接口（Kafka 2.7 起主推），`AdminClient` 是它的抽象基类，`KafkaAdminClient` 是内部实现。**业务代码只该用 `Admin` 接口**，通过 `Admin.create(props)` 获取实例。旧代码里的 `AdminClient.create(props)` 也可以用，返回同一个实现。
:::

AdminClient 是**线程安全的**，一个应用共享一个实例即可，不需要为每个操作创建。

## 3. 常用操作速查

所有 AdminClient 方法都是**异步**的，返回一个 `*Result` 对象。取值通过 `.all().get()`（阻塞）或 `.all().whenComplete(...)`（回调链）。

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

**幂等模式**：生产上建议先 `listTopics()` 判断是否存在，避免捕获 `TopicExistsException` 走异常分支。

### 3.2 增加分区

**只能增加，不能减少**。减少分区需要重建 topic。

```java
Map<String, NewPartitions> updates = Map.of(
    "orders", NewPartitions.increaseTo(24)  // 从 12 增到 24
);
admin.createPartitions(updates).all().get();
```

::: warning 分区增加会破坏 key 顺序
Producer 的 partitioner 计算 `hash(key) % numPartitions`，分区数变化后同一 key 会落到不同分区。业务上依赖 key 有序时，扩分区等于打乱这条 key 的顺序历史。
:::

### 3.3 修改配置（`incrementalAlterConfigs`）

Kafka 2.3 起废弃了整体覆盖式的 `alterConfigs`，改用 `incrementalAlterConfigs`——支持 SET / APPEND / SUBTRACT / DELETE 四种操作。

```java
ConfigResource resource = new ConfigResource(ConfigResource.Type.TOPIC, "orders");

Collection<AlterConfigOp> ops = List.of(
    new AlterConfigOp(new ConfigEntry("retention.ms", "1209600000"), // 改 14 天
                      AlterConfigOp.OpType.SET),
    new AlterConfigOp(new ConfigEntry("cleanup.policy", "compact"),  // 追加
                      AlterConfigOp.OpType.APPEND)
);

admin.incrementalAlterConfigs(Map.of(resource, ops)).all().get();
```

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

生产运维脚本里最常用的组合：`listTopics` + `describeTopics` + `describeConfigs`，可以完全替代 `kafka-topics.sh --describe`。

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

这就是 `kafka-consumer-groups.sh --describe` 内部做的事。做成定时任务上报到 Prometheus 就是自建 lag 监控。

### 3.6 重置消费组 Offset

灾备切换、消息重放场景需要。**前提是 group 处于 EMPTY 状态**——所有 consumer 必须先停掉，否则 `IllegalGenerationException`。

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

否则默认走 `request.timeout.ms`（30 秒）——但如果 broker 挂在 controller 选主中，客户端会一直等到底层 socket 超时。

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
| `createTopics` | `Create` on Cluster **或** `Create` on Topic | Topic 名 / Cluster |
| `deleteTopics` | `Delete` on Topic | Topic 名 |
| `alterConfigs` / `incrementalAlterConfigs` | `Alter` on Cluster / Topic | Topic 名 |
| `describeTopics` / `describeCluster` | `Describe` on Topic / Cluster | Topic 名 / Cluster |
| `listConsumerGroups` | `Describe` on Group | Group ID |
| `alterConsumerGroupOffsets` | `Read` + `Describe` on Group | Group ID |

生产环境**不要**用 broker super user 跑 AdminClient——为运维应用单独建 SASL 账号、给最小权限。

## 6. 常见坑

**坑一：`createTopics` 返回成功 ≠ 集群感知**。API 返回时 Controller 已经写入元数据，但**其他 broker 可能还没同步到**。紧接着的 `producer.send()` 有可能报 `UNKNOWN_TOPIC_OR_PARTITION`。解决方法：`createTopics` 后再调一次 `describeTopics` 确认可见，或在 producer 侧配置 `retries` 重试。

**坑二：`auto.create.topics.enable=true` 会让 `describeTopics` 触发自动建 topic**。如果 broker 开了自动建 topic，`describeTopics("nonexistent")` 会**顺手创建这个 topic**。生产集群应关闭自动建 topic（`auto.create.topics.enable=false`）。

**坑三：`deleteTopics` 只做标记**。API 成功返回后 topic 只是被标记为 pending deletion，实际磁盘文件删除要几秒到几分钟。这段时间内 `listTopics` 仍会看到它。等待完全删除需要轮询 `describeTopics` 直到抛 `UnknownTopicOrPartitionException`。

**坑四：忘记 close**。AdminClient 内部有 socket 连接、后台线程。忘记 `close()` 会造成资源泄露。始终用 try-with-resources。

## 7. 与 shell 脚本的对照

给运维熟悉的 shell 命令做映射：

| Shell 命令 | AdminClient 方法 |
| :-- | :-- |
| `kafka-topics.sh --create` | `createTopics` |
| `kafka-topics.sh --list` | `listTopics` |
| `kafka-topics.sh --describe` | `describeTopics` + `describeConfigs` |
| `kafka-topics.sh --alter --partitions` | `createPartitions` |
| `kafka-configs.sh --alter --add-config` | `incrementalAlterConfigs` |
| `kafka-consumer-groups.sh --list` | `listConsumerGroups` |
| `kafka-consumer-groups.sh --describe` | `listConsumerGroupOffsets` + `listOffsets` |
| `kafka-consumer-groups.sh --reset-offsets` | `alterConsumerGroupOffsets` |
| `kafka-reassign-partitions.sh` | `alterPartitionReassignments` |
| `kafka-acls.sh --add` | `createAcls` |

## 8. 与 Spring Kafka 的关系

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

Spring 应用里用 `KafkaAdmin` 做**启动时的声明式建 topic** 最合适；需要**运行时动态管理**（按业务事件建 topic、重置 offset）仍推荐直接注入 `AdminClient`。
