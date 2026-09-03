# Kafka Streams 概览

> Kafka Streams 是一个把 Kafka 集群当运行时的流处理库。它不是独立的处理引擎（如 Flink、Spark Streaming），也不是普通的消费者——它把「计算」直接编成一个持续消费与生产的 Kafka 客户端，从而复用 Kafka 已有的分区、副本、位移、事务机制。本章讲清 Kafka Streams 的定位、DSL 与 Processor API 的区别，以及 KStream / KTable / GlobalKTable 三个核心抽象。

## 1. 它是什么，不是什么

Kafka Streams 是一个 **JVM 库**，不是集群、不是服务、不是常驻进程管理器。要用它，只需要在业务应用里引入 `org.apache.kafka:kafka-streams` 依赖，用一段 `Topology` 描述数据流转，然后启动 `KafkaStreams` 对象即可。

它与常见流处理选项的关键差别：

| 维度 | Kafka Streams | Flink / Spark Streaming | 普通 Consumer + Producer |
| :-- | :-- | :-- | :-- |
| 部署形态 | 与业务代码同进程的库 | 独立集群 | 与业务代码同进程 |
| 状态管理 | 内置 RocksDB + changelog topic | 内置分布式状态 | 需自建 |
| 容错 | 复用 Kafka 消费者组 + 事务 | 独立的 checkpoint 机制 | 需自建 |
| 端到端 exactly-once | 有（`processing.guarantee=exactly_once_v2`） | 有 | 需自建 |
| 水平扩容 | 加一个进程实例即可 | 提交更多资源到集群 | 增消费者 |
| 依赖 | 只依赖 Kafka | 依赖自己的集群 + Kafka | 只依赖 Kafka |

它的定位是「**把 Kafka 集群当作流处理引擎的运行时**」：状态存进 changelog topic，故障恢复靠 Kafka 消费者组重平衡，跨算子传输也走 Kafka topic。这让运维模型只剩下"一个 Kafka 集群"，代价是流处理框架的丰富度低于 Flink（例如更细致的 checkpoint、跨算子背压等）。

来源：[Kafka Streams 官方文档](https://kafka.apache.org/documentation/streams/)

## 2. DSL 与 Processor API

Kafka Streams 提供两层 API：

- **Streams DSL**：`StreamsBuilder` + `KStream` / `KTable` 的链式操作，接近 SQL 或函数式集合 API。适合大多数场景。
- **Processor API**：手写 `Processor<K, V, KOut, VOut>`，直接控制每条记录的处理与状态存取。用于 DSL 表达能力不足时（例如自定义定时器、直接访问状态 store）。

两者可以混用：`KStream#process` 把一个 `Processor` 嵌进 DSL 拓扑，`Topology` 也支持完全用 Processor API 手工搭建。

一个典型的 DSL 示例——按空格切词、按词统计出现次数，把结果写回 topic：

```java
StreamsBuilder builder = new StreamsBuilder();

KStream<String, String> lines = builder.stream("input-topic");

KTable<String, Long> counts = lines
    .flatMapValues(line -> Arrays.asList(line.split("\\s+")))  // 一条 → 多条
    .groupBy((key, word) -> word)                              // 按词 rekey
    .count(Materialized.as("word-counts"));                    // 聚合结果落入本地 store

counts.toStream().to(
    "output-topic",
    Produced.with(Serdes.String(), Serdes.Long()));
```

这段代码看似简单，实际展开为一个包含 5 个节点的 `Topology`：source（读 input-topic）→ flatMapValues → groupBy（触发 rekey，需要一次内部 repartition topic）→ count（写状态 store 与 changelog topic）→ sink（写 output-topic）。这里最容易踩坑的是 `groupBy` 换 key 会隐式生成一个 `<application-id>-<name>-repartition` 内部 topic——它是运维时看到的多出来的 topic 的来源，不是 bug。

## 3. 三个核心抽象：KStream / KTable / GlobalKTable

这三个类型的差异，根源在于它们对**"同 key 多条消息"的处理方式**不同：

| 类型 | 对同 key 多条消息的语义 | 数据分布 |
| :-- | :-- | :-- |
| `KStream` | 事件流：每条都独立保留 | 按 key 分区 |
| `KTable` | 变更日志：只保留每个 key 的最新值 | 按 key 分区 |
| `GlobalKTable` | 变更日志：只保留每个 key 的最新值 | 全量广播到每个实例 |

对应到业务：

```java
// KStream：每笔订单都是一个独立事件，全部保留处理
KStream<String, Order> orders = builder.stream("orders");

// KTable：用户资料是"当前状态"，同 key 的新事件覆盖旧值
KTable<String, UserProfile> profiles = builder.table("profiles");

// GlobalKTable：商品字典很小，每个实例都保留全量以避免跨分区查表
GlobalKTable<String, Product> products = builder.globalTable("products");
```

### 3.1 为什么 GlobalKTable 不需要 Co-partition

先看什么是 Co-partition：`KStream` 与 `KTable` 连接时，两个流的同一 key 必须路由到同一个分区，同一条 Stream Thread 才能在本地拿到对应的表记录——否则就要跨节点查表，Streams 不支持这一步。这要求两个 topic 的分区数相同、partitioner 一致。

`GlobalKTable` 让每个 Stream 实例都持有整张表，任何 key 都能在本地找到，因此**跳过了分区对齐**这个约束：

| 类型 | 同 key 多条消息 | 数据分布 | 与 `KStream` join |
| :-- | :-- | :-- | :-- |
| `KStream` | 全部保留 | 按 key 分区 | 直接连接 |
| `KTable` | 只保留最新 | 按 key 分区 | 需 Co-partition |
| `GlobalKTable` | 只保留最新 | 全量广播到每实例 | 无需 Co-partition |

代价：`GlobalKTable` 每个实例都存全量。适合小到中等规模的维度表 / 字典表，不适合按用户维度累计变更的大表。

## 4. 使用场景与不合用的场景

它擅长：

- 从 topic 消费 → 无状态转换（map / filter / branch）→ 写回 topic。
- 有状态计算：分组聚合、窗口统计、流表关联。
- 端到端 exactly-once：与 Kafka 事务生产者、事务性 consumer 深度集成，跨算子精确一次（`processing.guarantee=exactly_once_v2`）。
- 部署形态受限的场景（只允许运行 JAR 包，不允许接入 Flink 集群）。

不太合适的场景：

- 复杂的乱序 / 事件时间语义（Flink 的能力更完整）。
- 跨 Kafka 集群做联合计算（Streams 只面向一个 cluster）。
- 需要精细的资源隔离、多租户调度（Flink / Spark 有独立集群资源模型）。

## 5. Streams 架构

```
┌─────────────────────────────────────────────┐
│              Kafka Streams App              │
│                                             │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐ │
│  │ Stream  │───►│ Process │───►│ Stream  │ │
│  │ Thread  │    │ Topology│    │ Thread  │ │
│  └─────────┘    └─────────┘    └─────────┘ │
│       │              │              │       │
│       ▼              ▼              ▼       │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐ │
│  │ Source  │    │ State   │    │ Sink    │ │
│  │ Topic   │    │ Store   │    │ Topic   │ │
│  └─────────┘    └─────────┘    └─────────┘ │
└─────────────────────────────────────────────┘
```

## 6. Streams 配置详解

```java
Properties props = new Properties();

// 必需配置
props.put(StreamsConfig.APPLICATION_ID_CONFIG, "my-streams-app");
props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");

// 序列化/反序列化
props.put(StreamsConfig.DEFAULT_KEY_SERDE_CLASS_CONFIG, Serdes.StringSerde.class);
props.put(StreamsConfig.DEFAULT_VALUE_SERDE_CLASS_CONFIG, Serdes.StringSerde.class);

// 状态存储
props.put(StreamsConfig.STATE_DIR_CONFIG, "/var/kafka-streams");

// 处理保证
props.put(StreamsConfig.PROCESSING_GUARANTEE_CONFIG, "exactly_once_v2");

// 线程数
props.put(StreamsConfig.NUM_STREAM_THREADS_CONFIG, 4);

// 缓存大小（影响 Reduce/Aggregate 的中间结果刷新频率）
props.put(StreamsConfig.CACHE_MAX_BYTES_BUFFERING_CONFIG, 10 * 1024 * 1024L); // 10MB

// 提交间隔
props.put(StreamsConfig.COMMIT_INTERVAL_MS_CONFIG, 1000L); // 1 秒
```

## 7. Streams 应用生命周期

```java
KafkaStreams streams = new KafkaStreams(topology, props);

// 注册状态监听器
streams.setStateListener((newState, oldState) -> {
    System.out.println("State changed: " + oldState + " -> " + newState);
});

// 启动
streams.start();

// 优雅关闭
Runtime.getRuntime().addShutdownHook(new Thread(streams::close));
```

**状态说明**：
- `CREATED` → `RUNNING` → `PENDING_SHUTDOWN` → `NOT_RUNNING`
- `RUNNING` → `REBALANCING` → `RUNNING`（Rebalance 时）
- `ERROR` → `PENDING_SHUTDOWN` → `NOT_RUNNING`（异常时）

