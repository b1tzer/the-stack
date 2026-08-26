# Kafka Streams 概览

## 1. 什么是 Kafka Streams

- 客户端库，无需集群
- 从 Kafka 读取、处理、写入 Kafka
- 支持 DSL 和 Processor API

## 2. DSL 示例

```java
StreamsBuilder builder = new StreamsBuilder();

KStream<String, String> stream = builder.stream("input-topic");

KTable<String, Long> counts = stream
    .flatMapValues(value -> Arrays.asList(value.split(" ")))
    .groupBy((key, word) -> word)
    .count();

counts.toStream().to("output-topic", Produced.with(Serdes.String(), Serdes.Long()));
```

## 3. 核心概念

| 概念 | 说明 |
|------|------|
| KStream | 流，无界数据集 |
| KTable | 表，变更日志 |
| GlobalKTable | 全局表，每个实例都有全量数据 |

## 4. 优势

- 轻量级，无需集群
- 端到端 Exactly Once
- 状态存储（RocksDB）
- 窗口操作

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

## 6. KStream vs KTable vs GlobalKTable

| 类型 | 数据模型 | 更新方式 | 适用场景 |
|------|----------|----------|----------|
| KStream | 事件流 | 追加 | 订单、日志、点击流 |
| KTable | 变更日志 | 更新/删除 | 用户信息、配置、状态 |
| GlobalKTable | 全局表 | 更新/删除 | 维度表、字典表 |

```java
// KStream：每个事件都是独立的
KStream<String, Order> orders = builder.stream("orders");

// KTable：相同 Key 的后续事件会覆盖前一个
KTable<String, UserProfile> profiles = builder.table("profiles");

// GlobalKTable：每个实例都有全量数据，无需 Co-partition
GlobalKTable<String, Product> products = builder.globalTable("products");
```

## 7. Streams 配置详解

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

## 8. Streams 应用生命周期

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

## 9. 最佳实践

1. **合理设置 APPLICATION_ID**：每个 Streams 应用使用唯一的 APPLICATION_ID，它决定了消费者组名和状态存储目录。
2. **监控 Streams 应用状态**：监听 `KafkaStreams.StateListener`，及时处理 REBALANCING 和 ERROR 状态。
3. **设置合理的缓存大小**：增大 `cache.max.bytes.buffering` 可以减少中间结果的刷新频率，提高性能。
4. **使用 Exactly Once 语义**：对于需要精确一次处理的场景，设置 `processing.guarantee=exactly_once_v2`。
