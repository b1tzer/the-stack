# Offset 翻译与消费者切换

跨集群复制里容易忽略的一件事：**源集群 topic 里的 offset 500，复制到目标集群不一定是 offset 500**。理解这一点是理解 MM2 灾备切换的前提。

## 1. 为什么 offset 不一致

一个 partition 的 [offset](../02-core/chapter-01-partition-and-offset.md) 是**单集群单调递增的整数**，由该集群 broker 独立分配。MM2 复制消息时，目标集群会为收到的每条消息**重新分配 offset**——若目标分区为空则从 0 开始，若已有记录则接续目标分区现有的 offset 序列，与源集群无关。

三种典型情况会造成源和目标的 offset 偏差：

1. **复制启动时源已经运行**。源 topic 已有 offset 0~999，MM2 从源 offset 800 才开始复制，且目标分区为空。这是没有 offset 空洞、没有被过滤记录的简化场景：源 offset 800~999 这 200 个 offset 位置的消息按序复制后，目标分区分配 offset 0~199，目标 offset 199 对应源 offset 999。两边的 offset 差值来自复制起点不同，与消息条数无关。
2. **压缩 vs 保留策略差异**。源 topic 保留 7 天，目标保留 3 天。保留策略不同导致目标先删了老数据，offset 空洞位置不同。
3. **transaction marker**。源集群里事务提交/回滚会占用 offset（每个事务 marker 占一个 offset），MM2 **不复制 marker**，目标 offset 因此更紧凑。

来自 [Red Hat MirrorMaker 2 组件文档](https://docs.redhat.com/en/documentation/red_hat_streams_for_apache_kafka/3.1/html/disaster_recovery_using_mirrormaker_2/assembly-mm2-components-str)：

> An important concept to understand is that records on each cluster are highly likely to have different offsets.

如果直接把源集群的 offset 用作目标集群的消费位置，消费者可能跳过尚未处理的消息，也可能重新读取已处理过的消息。这就是为什么 MM2 必须自己维护一套 offset 映射机制。

## 2. 两个内部 Topic：offset-syncs 与 checkpoints

MM2 用**两个专门的内部 topic** 记录 offset 映射，分工明确。

### 2.1 offset-syncs：物理 offset 映射

**由 MirrorSourceConnector 写入**。它不会为每条消息都写记录，而是按采样策略把 `(topic, partition, sourceOffset, targetOffset)` 四元组作为稀疏的 offset 对应点写入 offset-syncs topic。

```txt
offset-syncs 内容（伪）:
  (orders, 0, srcOffset=1000, targetOffset=800)
  (orders, 0, srcOffset=2000, targetOffset=1800)
  (orders, 1, srcOffset=1500, targetOffset=1400)
  ...
```

这是**物理 offset**层面的映射，与 consumer group 无关。offset-syncs 提供物理日志位置之间的对应关系，checkpoints 则把这种关系用于特定消费组的已提交进度，两者用途不同。

**注意**：offset-syncs 的存储位置由 `offset-syncs.topic.location` 决定，官方默认值是 `source`（源集群），要存放在目标集群需显式配置为 `target`。本文后续示例假设已配置为 `target`，因此通过目标集群读取。

### 2.2 checkpoints：Consumer Group 进度快照

**由 MirrorCheckpointConnector 写入**。它定期做两件事：

1. 按 `emit.checkpoints.interval.seconds` 周期，从源集群读取每个 [consumer group](../02-core/chapter-03-consumer-group.md#offset-management) 的最新已提交 offset（committed offset）
2. 用 offset-syncs topic 的映射把源 offset 翻译成目标 offset，写入 checkpoints topic

```txt
checkpoints 内容（伪）:
  { group: "order-service", topic: "orders", partition: 0,
    upstreamOffset: 1950, downstreamOffset: 1750,
    metadata: "", timestamp: 1700000000 }
```

checkpoints 记录的是**consumer group 的提交进度**，不是当前 topic 的最新 offset。它回答的问题是"如果我现在要切到目标集群，group `order-service` 应该从哪里开始读"。checkpoint 按周期生成，与消费组的实时提交位置之间存在时间差。

数据来源：[AWS MSK Migration Guide - MM2](https://docs.aws.amazon.com/whitepapers/latest/amazon-msk-migration-guide/mirrormaker-2.0-mm2.html)、[KIP-382](https://cwiki.apache.org/confluence/display/KAFKA/KIP-382%3A+MirrorMaker+2.0)。

## 3. 翻译精度：为什么不是逐条

MirrorSourceConnector **不会**为每条消息都写一条 offset-syncs 记录——那样开销太大。它按采样策略记录部分 offset 对应点：

- 每个 partition 首次复制时写一次
- 随后在源 offset 相对上一次同步点的差距超过 `offset.lag.max`（默认 100）时再写一次
- 保证 offset-syncs topic 大小可控

`offset.lag.max` 定义的是远端分区在被重新同步前允许的最大不同步程度（默认 100），它决定 offset-sync 记录的稀疏程度，但采样行为还受限流、低流量分区行为及 Kafka 版本影响，不能简单等同于完整的采样算法。

这意味着**翻译精度不是逐条精确的**——翻译时，MM2 取已有的 offset 对应点，按 offset 差值估算目标位置。例如已知源 offset 1000 对应目标 offset 800，翻译源 offset 1950 时，目标位置为 `800 + (1950 - 1000) = 1750`。

**代价**：目标 consumer 从翻译得到的 offset 开始读，可能：

- **少读几条**（翻译值偏大）：本次切换会跳过这些尚未处理的消息 → 数据丢失，除非后续人工重置 offset 或重新回放
- **多读几条**（翻译值偏小）：这些消息会被重复消费 → 需要业务侧幂等

偏移映射的估算误差、复制链路是否完整、消费者切换后的投递时序是三件不同的事。跨集群复制本身不能提供 exactly-once 保证，复制可能产生重复记录，但也不能笼统地说 MM2 在任何情况下都保证 at-least-once。过大的起始 offset 可能跳过尚未处理的消息，过小的起始 offset 则导致重复消费。生产环境应结合复制进度、切换时机和业务幂等策略验证实际语义。

## 4. Consumer 切换的三种做法 {#consumer-switch}

灾备切换到目标集群时，首先要恢复目标集群的消费进度。MM2 可以自动同步消费组 offset，也可以通过 `RemoteClusterUtils` 查询翻译结果后手工设置进度；只有两种方式都无法恢复有效位置时，才考虑 `auto.offset.reset` 的回退行为。这三者不是可互换的同类方案。

### 4.1 `sync.group.offsets.enabled=true` 自动同步（Kafka 2.7+）

MM2 直接把翻译后的 offset **写入目标集群的 `__consumer_offsets`**。切换后 consumer 用原来的 `group.id` 启动，Kafka 会自动从 `__consumer_offsets` 拿到起点，就像本来就在目标集群跑一样。

```properties
# 配置侧
primary->backup.sync.group.offsets.enabled = true
primary->backup.sync.group.offsets.interval.seconds = 60
```

**限制**：官方约束是「目标集群该组没有活跃消费者连接时才同步」。一旦目标集群有该组的活跃消费者，MM2 会停止同步该组 offset。因此它适合目标集群没有独立活跃消费者的主备切换场景；Active-Active 里两个集群都有独立 consumer 在写 `__consumer_offsets`，无法安全使用。

### 4.2 `RemoteClusterUtils` 编程翻译

应用侧调用 API 把源 offset 翻译成目标 offset。适合需要精细控制的场景：

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
    // 分区分配是异步的，循环 poll 直到拿到分区
    while (consumer.assignment().isEmpty()) {
        consumer.poll(Duration.ofMillis(100));
    }
    for (TopicPartition tp : consumer.assignment()) {
        OffsetAndMetadata m = translated.get(tp);
        if (m != null) {
            consumer.seek(tp, m.offset());  // 让当前消费者从翻译位置开始读
        }
    }
    // ... poll loop
}
```

`RemoteClusterUtils.translateOffsets` 内部就是去读目标集群的 checkpoints topic，找每个 partition 的最新 checkpoint。

注意两点：`subscribe()` 是异步分配分区的，必须先 `poll()` 后从 `assignment()` 拿到分区，才能对它们 `seek()`；`commitSync()` 提交的是消费组的进度，不会让当前消费者自动从该 offset 开始读取。若想持久化翻译结果供后续启动的消费者接管，应把翻译结果写入目标集群的消费组提交位置，而不是依赖 `commitSync()` 改变当前消费者的位置。

### 4.3 `auto.offset.reset` 回退

最坏情况下——checkpoints topic 都丢了、`sync.group.offsets` 没开、目标集群也没有可用的已提交 offset——`auto.offset.reset` 才会决定消费者在无有效位置时如何处理：

- `auto.offset.reset=latest`：从目标分区当前末尾开始，切换前到达的消息不会被消费
- `auto.offset.reset=earliest`：从目标分区当前保留的最早位置开始，可能重复消费已处理的消息，需要业务幂等

`auto.offset.reset` 不是正常切换过程中主动选择消费起点的通用机制，它只在消费组没有有效已提交 offset（或该 offset 已失效）时生效。生产上不推荐作为唯一兜底，但仍要在 runbook 里写清它的触发条件。

## 5. Active-Active 场景的额外复杂度

Active-Active 每个 region 有独立 consumer 在读**本地 + 远端前缀**两批 topic：

```txt
us-east consumer 订阅: [ orders,        us-west.orders        ]
us-west consumer 订阅: [ orders,        us-east.orders        ]
```

发生故障 us-east 挂了，us-west 的 consumer 需要接管 us-east 那部分流量。它现在要多读 `us-east.orders` topic 里之前是 us-east 本地 consumer 读的那部分——但它自己的 group 从没读过 `us-east.orders`。

**做法**：切换前，应确认 MirrorCheckpointConnector 已经把 us-east 上 `order-service` group 的 offset 翻译到了本地 checkpoints（checkpoint 周期性生成，需确认其足够新）。切换时程序读 checkpoint，等分区分配完成后 seek 到翻译位置：

```java
consumer.subscribe(List.of("orders", "us-east.orders"));  // subscribe 设置完整订阅集合，非追加
while (consumer.assignment().isEmpty()) {
    consumer.poll(Duration.ofMillis(100));                // 等分区分配完成
}
// 用 RemoteClusterUtils 拿到翻译后的 offset
Map<TopicPartition, OffsetAndMetadata> resume =
    RemoteClusterUtils.translateOffsets(props, "us-east", "order-service", timeout);
for (TopicPartition tp : consumer.assignment()) {
    OffsetAndMetadata m = resume.get(tp);
    if (m != null) {
        consumer.seek(tp, m.offset());
    }
}
```

上面的代码是流程示意。接管的核心不是「读 checkpoint 手工 seek」这一句能概括的，而是要显式定义消费组与 topic 的归属：故障前哪些消费者读本地 topic、哪些读镜像 topic；故障后由谁接管 `us-east.orders`、使用哪个消费组、如何取到与已处理进度一致的起始位置；同一业务事件若已由另一集群处理，如何避免重复副作用。

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

> 上述数据均为假设值，仅用于演示。offset-syncs 与 checkpoints 的生成时间不同，复制链路可能仍在推进，验证时需确认样本属于同一复制方向、同一 topic-partition，并理解两者之间的时间差。MM2 内部 topic 使用内部序列化格式，普通 `kafka-console-consumer.sh` 的输出不一定是上面的伪结构，需要配合对应的内部消息 formatter 才能解析。

**查 checkpoints**：

```bash
kafka-console-consumer.sh \
  --bootstrap-server kafka-backup:9092 \
  --topic us-east.checkpoints.internal \
  --from-beginning
```

看到最近一条：`group=order-service, topic=orders, partition=0, upstream=5000, downstream=4800`。

**验证公式**：`downstream ≈ targetOffset + (upstream - srcOffset) = 4600 + (5000 - 4800) = 4800`，与 checkpoint 里的 `downstream=4800` 一致。该公式演示的是 offset 差值的估算方式，不代表 MM2 一定会得到该值。

切换时：consumer 以 `group.id=order-service` 连接目标集群，从 `us-east.orders` 的 offset 4800 开始消费。实际会重复消费多少条取决于翻译位置、提交时序和复制状态，无法从示例数据推算固定范围，业务侧需要幂等处理。

## 7. 三条实操建议

1. **`emit.checkpoints.interval.seconds` 控制 checkpoint 生成频率**。官方默认值是 60 秒（按所用 Kafka 版本核对）。间隔越短，checkpoint 越及时，但也会增加内部 topic 写入量与 broker 开销。10 秒可作为演练起点，具体值按允许的进度偏差、消费组数量和集群负载确定。缩短间隔不能消除 offset-syncs 的稀疏映射误差，也不能弥补复制延迟。
2. **`sync.group.offsets.enabled` 只在目标集群无该组活跃消费者的主备场景开启**。是否自动同步不应只看拓扑名称，而要看目标消费组的活动状态与切换方式；Active-Active 通常需要 `RemoteClusterUtils` 手工翻译。
3. **切换前先跑一次翻译演练**。灾备演练时用 `RemoteClusterUtils.translateOffsets` 拉一次目标集群的翻译结果，与源集群的 committed offset 对比。演练要验证的是完整的消费者接管流程：目标 topic 名称与分区、翻译后的起始位置、消费者实际获得的分区，以及切换后是否存在重复处理或跳过消息，而不只是比较两个 offset 数值。
