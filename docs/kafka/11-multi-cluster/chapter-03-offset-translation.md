# Offset 翻译与消费者切换

跨集群复制里最反直觉的一件事：**源集群 topic 里的 offset 500，复制到目标集群不一定是 offset 500**。理解这一点是理解 MM2 灾备切换的前提。

## 1. 为什么 offset 不一致

一个 partition 的 offset 是**单集群单调递增的整数**，由该集群 broker 独立分配。MM2 复制消息时，目标集群会为收到的每条消息**重新分配 offset**——起点是 0，与源集群无关。

三种典型情况会让源和目标偏差越来越大：

1. **复制启动时源已经运行**。源 topic 已有 offset 0~999，MM2 从某一时刻起才开始复制，目标 topic 从 0 开始只装了 offset 800 之后的数据。目标的 offset 799 对应源的 offset 999。
2. **压缩 vs 保留策略差异**。源 topic 保留 7 天，目标保留 3 天。保留策略不同导致目标先删了老数据，offset 空洞位置不同。
3. **transaction marker**。源集群里事务提交/回滚会占用 offset（每个事务 marker 占一个 offset），MM2 **不复制 marker**，目标 offset 因此更紧凑。

来自 [Red Hat MirrorMaker 2 组件文档](https://docs.redhat.com/en/documentation/red_hat_streams_for_apache_kafka/3.1/html/disaster_recovery_using_mirrormaker_2/assembly-mm2-components-str)：

> An important concept to understand is that records on each cluster are highly likely to have different offsets.

不做翻译地把源 offset 直接拿去目标消费 = 消费错位。这就是为什么 MM2 必须自己维护一套 offset 映射机制。

## 2. 两个内部 Topic：offset-syncs 与 checkpoints

MM2 用**两个专门的内部 topic** 记录 offset 映射，分工明确。

### 2.1 `<source>.offset-syncs.internal`：物理 offset 映射

**由 MirrorSourceConnector 写入**。每复制一条消息（或按一定采样频率），把 `(topic, partition, sourceOffset, targetOffset)` 四元组作为一条记录写入 offset-syncs topic。

```text
offset-syncs 内容（伪）:
  (orders, 0, srcOffset=1000, targetOffset=800)
  (orders, 0, srcOffset=2000, targetOffset=1800)
  (orders, 1, srcOffset=1500, targetOffset=1400)
  ...
```

这是**物理 offset**层面的映射，与 consumer group 无关。它是所有翻译的基础事实。

**注意**：offset-syncs topic 存储在目标集群，但它的名字带源集群 alias 前缀：`us-east.offset-syncs.internal`。

### 2.2 `<source>.checkpoints.internal`：Consumer Group 进度快照

**由 MirrorCheckpointConnector 写入**。它定期做两件事：

1. 从源集群读取每个 consumer group 的最新已提交 offset（committed offset）
2. 用 offset-syncs topic 的映射把源 offset 翻译成目标 offset，写入 checkpoints topic

```text
checkpoints 内容（伪）:
  { group: "order-service", topic: "orders", partition: 0,
    upstreamOffset: 1950, downstreamOffset: 1750,
    metadata: "", timestamp: 1700000000 }
```

**关键点**：checkpoints 记录的是**consumer group 的提交进度**，不是当前 topic 的最新 offset。它回答的问题是"如果我现在要切到目标集群，group `order-service` 应该从哪里开始读"。

数据来源：[AWS MSK Migration Guide - MM2](https://docs.aws.amazon.com/whitepapers/latest/amazon-msk-migration-guide/mirrormaker-2.0-mm2.html)、[KIP-382](https://cwiki.apache.org/confluence/display/KAFKA/KIP-382%3A+MirrorMaker+2.0)。

## 3. 翻译精度：为什么不是逐条

MirrorSourceConnector **不会**为每条消息都写一条 offset-syncs 记录——那样开销太大。它采用**变化率驱动的稀疏采样**：

- 每个 partition 首次复制时写一次
- 随后按 offset 差距超过阈值时写一次（默认阈值由内部策略控制）
- 保证 offset-syncs topic 大小可控

这意味着**翻译精度不是逐条精确的**——如果源 offset 1950 落在 syncs 记录 `(1000, 800)` 和 `(2000, 1800)` 之间，Checkpoint 会用线性插值计算出 `downstreamOffset = 1750`。

**代价**：目标 consumer 从翻译得到的 offset 开始读，可能：

- **少读几条**（翻译值偏大）：这些消息永远不会被消费到 → 数据丢失
- **多读几条**（翻译值偏小）：这些消息会被重复消费 → 需要业务侧幂等

MM2 官方**优先保证不丢**，翻译倾向于偏小（重复消费）。这也是灾备切换的普遍语义：at-least-once 而非 exactly-once。

## 4. Consumer 切换的三种做法

灾备切换到目标集群时，consumer 有三种拿到起点的方式，精度和实现复杂度依次递减。

### 4.1 `sync.group.offsets.enabled=true`（Kafka 2.7+，最简单）

MM2 直接把翻译后的 offset **写入目标集群的 `__consumer_offsets`**。切换后 consumer 用原来的 `group.id` 启动，Kafka 会自动从 `__consumer_offsets` 拿到起点，就像本来就在目标集群跑一样。

```properties
# 配置侧
primary->backup.sync.group.offsets.enabled = true
primary->backup.sync.group.offsets.interval.seconds = 60
```

**限制**：只在 Active-Standby 场景启用。Active-Active 里两个集群都有独立 consumer 在写 `__consumer_offsets`，MM2 覆盖会踩到。

### 4.2 `RemoteClusterUtils` 编程翻译（KIP-382 首选）

应用侧调用 API 把源 offset 翻译成目标 offset，然后 `KafkaConsumer.commitSync()` 提交。适合需要精细控制的场景：

```java
Map<String, Object> props = new HashMap<>();
props.put("bootstrap.servers", "kafka-backup:9092");

// 翻译 group "order-service" 的所有 offset
Map<TopicPartition, OffsetAndMetadata> translated =
    RemoteClusterUtils.translateOffsets(
        props,
        "us-east",        // 源集群 alias
        "order-service",  // 消费组 ID
        Duration.ofSeconds(30)
    );

try (KafkaConsumer<String, String> consumer = new KafkaConsumer<>(consumerProps)) {
    consumer.subscribe(List.of("us-east.orders"));
    consumer.commitSync(translated);
    // ... poll loop
}
```

`RemoteClusterUtils.translateOffsets` 内部就是去读目标集群的 checkpoints topic，找每个 partition 的最新 checkpoint。

### 4.3 从 `latest` 或 `earliest` 开始（最粗暴）

最坏情况下——checkpoints topic 都丢了、`sync.group.offsets` 没开——只能：

- `auto.offset.reset=latest`：只消费切换后到达的新消息，历史数据丢弃
- `auto.offset.reset=earliest`：从头重新消费，需要业务幂等

生产上不推荐，但作为最终兜底方案要在 runbook 里写清楚。

## 5. Active-Active 场景的额外复杂度

Active-Active 每个 region 有独立 consumer 在读**本地 + 远端前缀**两批 topic：

```text
us-east consumer 订阅: [ orders,        us-west.orders        ]
us-west consumer 订阅: [ orders,        us-east.orders        ]
```

发生故障 us-east 挂了，us-west 的 consumer 需要接管 us-east 那部分流量。它现在要多读 `us-east.orders` topic 里之前是 us-east 本地 consumer 读的那部分——但它自己的 group 从没读过 `us-east.orders`。

**做法**：切换前，us-west 的 group 已经通过 MirrorCheckpointConnector 把 us-east 上 `order-service` group 的 offset 翻译到了本地 checkpoints。切换时程序读 checkpoint 手工 seek：

```java
consumer.subscribe(List.of("us-east.orders"));  // 新增订阅
// 用 RemoteClusterUtils 拿到翻译后的 offset
Map<TopicPartition, OffsetAndMetadata> resume =
    RemoteClusterUtils.translateOffsets(props, "us-east", "order-service", timeout);
consumer.commitSync(resume);
```

## 6. 一个可验证的例子

假设源 `orders` 已复制 3 小时，目标叫 `us-east.orders`，group `order-service` 在源已提交 offset=5000。

**查 offset-syncs**：

```bash
kafka-console-consumer.sh \
  --bootstrap-server kafka-backup:9092 \
  --topic us-east.offset-syncs.internal \
  --from-beginning --formatter=<你的解析 Formatter>
```

看到最近一条：`(orders, 0, srcOffset=4800, targetOffset=4600)`。

**查 checkpoints**：

```bash
kafka-console-consumer.sh \
  --bootstrap-server kafka-backup:9092 \
  --topic us-east.checkpoints.internal \
  --from-beginning
```

看到最近一条：`group=order-service, topic=orders, partition=0, upstream=5000, downstream=4800`。

**验证公式**：`downstream ≈ targetOffset + (upstream - srcOffset) = 4600 + (5000 - 4800) = 4800`，与 checkpoint 里的 `downstream=4800` 一致。

切换时：consumer 以 `group.id=order-service` 连接目标集群，从 `us-east.orders` 的 offset 4800 开始消费。业务上会重复消费大约 10~100 条（取决于 checkpoint 采样密度），需要幂等处理。

## 7. 三条实操建议

1. **`emit.checkpoints.interval.seconds` 调到 10 秒**。默认 5 秒，稍紧张；30 秒太粗。10 秒在切换精度与 broker 压力之间取平衡。
2. **`sync.group.offsets.enabled` 只在 Active-Standby 开启**。Active-Active 一律走 `RemoteClusterUtils` 手工翻译。
3. **切换前先跑一次翻译演练**。灾备演练时用 `RemoteClusterUtils.translateOffsets` 拉一次目标集群的翻译结果，与源集群的 committed offset 对比，验证复制链路健康、offset-syncs 有更新。
