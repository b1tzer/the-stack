# 消费者优化

## 1. 多线程消费

```java
// 方案1：多消费者实例
for (int i = 0; i < 10; i++) {
    new Thread(() -> {
        KafkaConsumer<String, String> consumer = createConsumer();
        consumer.subscribe(Arrays.asList("topic"));
        while (true) {
            ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
```java
// 方案2：单消费者多线程处理
ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
ExecutorService executor = Executors.newFixedThreadPool(10);
for (ConsumerRecord<String, String> record : records) {
    executor.submit(() -> processMessage(record));
}
```

两种方案的取舍在「offset 是否有序」：

- 方案 1（多消费者实例）各自独立 poll、独立提交 offset，天然并行且顺序可控，代价是每个线程一个 `KafkaConsumer` 实例（`KafkaConsumer` 不是线程安全的）。
- 方案 2（单消费者 + 线程池）省实例，但**破坏了处理顺序**：`processMessage` 在线程池里并发执行，后到的消息可能先处理完。如果处理完一条就提交 offset，提交的 offset 会「越过」还在处理中的前序消息——一旦此时宕机，那些尚未处理完的前序消息会被当作已消费而丢失，造成**重复消费或丢消息**。

所以方案 2 的正确姿势不是「每处理完一条就提交」，而是等一批消息全部处理完再提交，或者为 offset 维护一个有序的提交队列。```

## 2. 批量处理

```java
props.put("max.poll.records", 1000);  // 增加单次拉取条数
```

## 3. 背压机制

```java
// 控制处理速度，避免内存溢出
if (records.count() > 0) {
    processBatch(records);
    consumer.commitSync();
}
```

背压要解决的问题是「消费快、处理慢」导致的**内存无界增长**。`poll()` 会一次性把 `max.poll.records` 条消息拉进 JVM 内存，如果处理速度跟不上拉取速度，每轮 poll 攒下的一批消息还没处理完，下一轮 poll 又拉来一批，消息对象在堆里越堆越多，最终 OOM。

上面的写法把「拉取」和「处理」串成同一步：处理完当前批、提交 offset，才开始下一轮 poll。这等于把消费速率钳制在处理速率上，队列长度恒为一批，内存就不会失控。

更精细的做法是引入有界队列 + 信号量，让背压既限制内存又保留一定缓冲，而不是简单地在 poll 循环里串行处理。

## 4. 消费者性能瓶颈分析

```
消费延迟 = 处理延迟 + 网络延迟 + Rebalance 延迟

处理延迟:
- 消息处理耗时过长
- 外部调用（DB、HTTP）阻塞
- GC 停顿

网络延迟:
- Broker 到消费者的网络带宽
- Fetch 请求的批量大小

Rebalance 延迟:
- 频繁的消费者加入/离开
- 处理时间超过 max.poll.interval.ms
```

## 5. Fetch 调优

```java
props.put("fetch.min.bytes", 1024);         // 最小拉取字节数
props.put("fetch.max.wait.ms", 500);         // 最大等待时间
props.put("max.partition.fetch.bytes", 1048576);  // 单分区最大拉取字节数
props.put("max.poll.records", 1000);         // 单次 poll 最大记录数
```

**调优策略**：
- 高吞吐场景：增大 `fetch.min.bytes` 和 `max.poll.records`，减少 poll 次数。
- 低延迟场景：减小 `fetch.max.wait.ms`，更快获取新消息。

## 6. 序列化/反序列化优化

```java
// 使用高性能序列化框架
// Avro: 压缩比好，Schema 演进支持
// Protobuf: 速度快，跨语言支持
// JSON: 通用性好，但性能较差

// 配置 Schema Registry
props.put("specific.avro.reader", true);
props.put("schema.registry.url", "http://localhost:8081");
```

## 7. 手动分区分配优化

```java
// 当不需要自动 Rebalance 时，手动分配分区
consumer.assign(Arrays.asList(
    new TopicPartition("topic", 0),
    new TopicPartition("topic", 1),
    new TopicPartition("topic", 2)
));

// 手动管理 Offset
consumer.seek(new TopicPartition("topic", 0), 1000);
```

适用场景：
- 消费者数量固定，不需要动态扩展。
- 需要精确控制每个消费者消费哪些分区。
- 消费者之间有依赖关系。

## 8. 内存优化

```java
props.put("max.partition.fetch.bytes", 1048576);  // 控制单次拉取大小
props.put("max.poll.records", 500);                // 控制单次处理记录数
```

**避免内存溢出**：
- 不要一次拉取过多消息，设置合理的 `max.poll.records`。
- 处理完一批消息后再拉取下一批，避免消息堆积在内存。
- 使用连接池管理外部资源（数据库连接、HTTP 连接）。

## 9. 监控消费者性能

| JMX 指标 | 说明 | 告警阈值 |
| :-- | :-- | :-- |
| records-lag-max | 最大消费延迟 | > 10000 |
| fetch-rate | 拉取速率 | 根据业务设定 |
| fetch-latency-avg | 平均拉取延迟 | > 1000ms |
| records-consumed-rate | 消费速率 | 根据业务设定 |
| commit-rate | 提交频率 | 根据业务设定 |

