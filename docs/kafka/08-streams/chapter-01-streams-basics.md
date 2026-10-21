# Kafka Streams 概览

> Kafka Streams 是一个把 Kafka 集群当运行时的流处理库。它不是独立的处理引擎（如 Flink、Spark Streaming），也不是普通的消费者——它把「计算」直接编成一个持续消费与生产的 Kafka 客户端，从而复用 Kafka 已有的分区、副本、位移、事务机制。本章讲清 Kafka Streams 的定位、DSL 与 Processor API 的区别，以及 KStream / KTable / GlobalKTable 三个核心抽象。

## 1. 它是什么，不是什么

Kafka Streams 是一个 **JVM 库**，不是集群、不是服务、不是常驻进程管理器。要用它，只需要在业务应用里引入 `org.apache.kafka:kafka-streams` 依赖，用一段 `Topology` 描述数据流转，然后启动 `KafkaStreams` 对象即可。

它与常见流处理选项的关键差别：

| 维度 | Kafka Streams | Flink / Spark Streaming | 普通 Consumer + Producer |
| :-- | :-- | :-- | :-- |
| 部署形态 | 与业务代码同进程的库 | 可独立部署的流处理运行时，部署模式取决于框架与环境 | 与业务代码同进程 |
| 状态管理 | 本地 State Store，持久化状态通常用 RocksDB + changelog 恢复 | 内置分布式状态 | 需自建 |
| 容错 | 基于 Kafka 的任务协调、状态恢复与可选事务机制 | 独立的 checkpoint 机制 | 需自建 |
| 端到端 exactly-once | 有，覆盖 Kafka 位移、状态与 Kafka 输出之间 | 有，覆盖范围取决于框架 | 需自建 |
| 水平扩容 | 可增实例或 Stream Thread，并行度受分区数与拓扑限制 | 提交更多资源到集群 | 增消费者 |
| 依赖 | 主要依赖 Kafka 集群，仍可能依赖外部系统 | 依赖自己的集群，Kafka 为可选数据源 | 只依赖 Kafka |

它的定位是「**把 Kafka 集群当作流处理引擎的运行时**」。应用内的算子通过处理拓扑连接，相邻节点通常在进程内传递记录；需要重新分区时，框架用内部 repartition topic 传递记录。有状态算子把计算状态落在本地 State Store，持久化状态通常通过 changelog topic 支持故障恢复；实例故障或扩缩容时，Kafka Streams 重新分配任务，并在必要时从 changelog 恢复本地状态。

这种架构不需要单独部署流处理集群，应用与业务服务采用相同的部署方式。但运维上仍要管理内部 topic、本地状态目录、任务分配和恢复耗时。相比 Flink，Kafka Streams 少了独立集群这一层，代价是流处理框架的丰富度更低。两者的运行时与容错模型不同，例如事件时间控制、跨算子背压等能力更弱。

来源：[Kafka Streams 官方文档](https://kafka.apache.org/documentation/streams/)

## 2. DSL 与 Processor API

Kafka Streams 提供两层 API：

- **Streams DSL**：`StreamsBuilder` + `KStream` / `KTable` 的链式操作，接近 SQL 或函数式集合 API。适合大多数场景。
- **Processor API**：直接定义记录处理逻辑，通过 `ProcessorContext` 访问状态存储、转发记录或注册定时回调。需要自定义状态处理或定时逻辑时使用；常见转换、聚合和连接仍优先用 DSL。

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

这段代码会被展开为多个 Source、Processor、Sink 节点，逻辑操作的数量并不等于实际拓扑节点数。其中 `groupBy` 把 key 从原始记录的 key 换成单词，框架需要按新 key 重新分区，通常会创建 `<application-id>-<name>-repartition` 内部 topic，再通过内部节点写入并重新读取记录；`count` 用本地 State Store 保存计数，并通过 changelog topic 支持状态恢复。这些多出来的内部 topic 不是 bug，而是当前示例中 `groupBy` 更换 key 导致的重新分区结果。实际生成的拓扑和内部资源可调用 `Topology.describe()` 查看，不必凭 DSL 操作的数量推断节点数。

## 3. 三个核心抽象：KStream / KTable / GlobalKTable

这三个类型的差异，根源在于它们对「同 key 多条消息」的处理方式不同：

| 类型 | 同 key 多条消息 | 数据分布 | 与 `KStream` join 的约束 |
| :-- | :-- | :-- | :-- |
| `KStream` | 事件流：每条都独立保留 | 按 key 分区 | 流-流 join 需共分区，通常还需窗口 |
| `KTable` | 变更日志：输入记录更新对应 key 的当前状态 | 按 key 分区 | 需 Co-partition |
| `GlobalKTable` | 变更日志：输入记录更新对应 key 的当前状态 | 每个实例维护完整本地副本 | 无需 Co-partition |

`KTable` 把输入记录解释为对表项的更新，相同 key 的新记录覆盖旧值；当记录 value 为 null（tombstone）时，表示删除该 key 的表项。

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

Co-partition（共分区）指的是：对普通的 key-based join，参与连接的输入需要按连接 key 共分区——两个输入 topic 的分区数相同，且相同 key 的记录用兼容的分区策略进入对应分区。这样同一个处理任务才能在本地完成连接。若输入不满足要求，需要显式或依赖框架重新分区；Kafka Streams 不会把普通 join 自动变成任意的跨节点远程查表。

`GlobalKTable` 让每个实例都持有完整的本地表副本，任何 key 都能在本地查到，因此跳过了分区对齐这个约束。代价是每个实例都要读取并维护全量数据，带来额外的存储、网络流量和集群负载：它适合数据规模可控、需要在每个实例本地查找的维度表 / 字典表，不适合按用户维度累计变更的大表。

## 4. 使用场景与不合用的场景

它擅长：

- 从 topic 消费 → 无状态转换（map / filter / branch）→ 写回 topic。
- 有状态计算：分组聚合、窗口统计、流表关联。计算主要围绕 Kafka 数据流展开时，可直接在应用内完成，不必另建流处理集群。
- 端到端 exactly-once：与 Kafka 事务生产者、事务性 consumer 深度集成，跨算子精确一次（`processing.guarantee=exactly_once_v2`，详见 [Streams Exactly Once](./chapter-05-exactly-once-streams.md)）。
- 已有 Java 服务可直接部署应用进程，但基础设施不提供独立流处理集群的环境。

不太合适的场景：

- 对乱序、迟到数据有复杂要求时，应先验证 Kafka Streams 的时间戳提取、窗口与宽限期机制是否满足业务语义；需要更丰富的事件时间控制与独立资源调度能力时，再评估 Flink。
- 需要从多个 Kafka 集群联合读取和处理数据时，标准拓扑围绕单个集群组织输入、状态恢复与任务协调，多集群联合计算需额外设计数据同步或自定义接入，不是内置的常规能力。
- 需要精细的资源隔离、多租户调度（Flink / Spark 有独立集群资源模型）。

## 5. Streams 架构

Kafka Streams 应用由一个处理拓扑和运行该拓扑的应用实例组成。每个实例可启动多个 Stream Thread，框架根据输入 topic 的分区数和拓扑结构创建、分配 Stream Task。

Task 是实际执行处理逻辑的基本单元，多个 Task 并行处理不同的输入分区，但实际并行度受分区数和拓扑结构限制。有状态的 Task 用本地 State Store 保存计算状态；需要故障恢复的持久化状态通常通过 changelog topic 保存变更，Task 转移到其他实例时，新实例从 changelog 恢复。需要重新分区的操作则使用内部 repartition topic（见 [状态存储](./chapter-04-state-store.md)）。

因此增加应用实例不等于一定提升并行度。排查处理能力不足时，还要检查输入分区数、Task 分配、线程负载和状态恢复开销。

## 6. Streams 配置详解

下面展示常见的应用级配置。Serde 必须与输入、输出记录的实际类型一致；线程数、状态目录、缓存和提交间隔应根据分区数、状态规模和处理延迟要求调整。示例省略 import 与 `Topology` 构建过程，仅作配置片段。

```java
Properties props = new Properties();

// 应用 ID，用于标识 Streams 应用及其消费者组、内部资源命名
props.put(StreamsConfig.APPLICATION_ID_CONFIG, "my-streams-app");
props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");

// 序列化/反序列化
props.put(StreamsConfig.DEFAULT_KEY_SERDE_CLASS_CONFIG, Serdes.StringSerde.class);
props.put(StreamsConfig.DEFAULT_VALUE_SERDE_CLASS_CONFIG, Serdes.StringSerde.class);

// 本地状态目录；同一文件系统上的不同实例必须使用不同目录
props.put(StreamsConfig.STATE_DIR_CONFIG, "/var/kafka-streams");

// 处理保证（协调 Kafka 位移、状态更新与 Kafka 输出之间的 exactly-once）
props.put(StreamsConfig.PROCESSING_GUARANTEE_CONFIG, "exactly_once_v2");

// 线程数
props.put(StreamsConfig.NUM_STREAM_THREADS_CONFIG, 4);

// 状态存储记录缓存总量上限，影响缓存刷新与下游转发频率
props.put("statestore.cache.max.bytes", 10 * 1024 * 1024L); // 10MB

// 提交间隔
props.put(StreamsConfig.COMMIT_INTERVAL_MS_CONFIG, 1000L); // 1 秒
```

`exactly_once_v2` 协调的是 Kafka 输入位移、状态更新和 Kafka 输出之间的处理保证。它不自动覆盖数据库写入、HTTP 调用等事务之外的副作用，这些操作仍需单独设计幂等或一致性机制。

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

`start()` 启动的是运行过程，不代表应用已经完成分区分配、状态恢复并进入稳定处理状态。排查启动异常时应结合状态监听、日志和 Streams 指标判断实际进度；发生 Rebalance 时还要关注任务重新分配与本地状态恢复带来的延迟。上面的 Shutdown Hook 适合教学示例，生产环境还需配置关闭超时、容器终止宽限期和应用自身的关闭流程。

**常见状态变化（示例，非完整状态机）**：

- `CREATED` → `RUNNING` → `PENDING_SHUTDOWN` → `NOT_RUNNING`
- `RUNNING` → `REBALANCING` → `RUNNING`（Rebalance 时）
- `ERROR` → `PENDING_SHUTDOWN` → `NOT_RUNNING`（异常时，并非所有异常都走这条路径）
