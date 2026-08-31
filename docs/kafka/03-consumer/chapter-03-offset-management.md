# Offset 管理

> Offset 是 Consumer 在 Partition 中的消费位置。管理好 Offset 是保证"不丢消息、不重复消费"的关键。

## 1. Offset 的含义

```text
Partition 0: [msg0][msg1][msg2][msg3][msg4][msg5]...
                                              ↑
                                        committed offset = 5
                                        下次消费从 offset 5 开始
```

## 2. 自动提交 vs 手动提交

### 自动提交（enable.auto.commit=true）

```text
每 auto.commit.interval.ms（默认5秒）自动提交当前最大 offset
  → 可能提交了还没处理完的消息 offset
  → Consumer 崩溃后，未处理的消息被跳过（消息丢失）
```

### 手动提交（enable.auto.commit=false）

```java
consumer.subscribe(List.of("orders"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, String> record : records) {
        processRecord(record);
    }
    consumer.commitSync();  // 处理完后手动提交
}
```

## 3. 提交粒度

### 同步提交（commitSync）

```java
consumer.commitSync();  // 阻塞直到提交成功
```

- 可靠，但性能差
- 适用于对可靠性要求高的场景

### 异步提交（commitAsync）

```java
consumer.commitAsync((offsets, exception) -> {
    if (exception != null) {
        log.error("Commit failed", exception);
    }
});
```

- 性能好，但可能丢失提交结果
- 适用于高吞吐场景

### 分区级别提交

```java
Map<TopicPartition, OffsetAndMetadata> offsets = new HashMap<>();
offsets.put(new TopicPartition("orders", 0), new OffsetAndMetadata(100));
offsets.put(new TopicPartition("orders", 1), new OffsetAndMetadata(200));
consumer.commitSync(offsets);
```

## 4. Offset 存储位置

| 版本 | 存储位置 |
|------|---------|
| 0.9 之前 | ZooKeeper |
| 0.9+ | 内部 Topic `__consumer_offsets` |

`__consumer_offsets` 是一个50个分区的内部 Topic，存储所有 Consumer Group 的 Offset。

## 5. 重置 Offset

```java
// 从头消费
props.put("auto.offset.reset", "earliest");

// 从最新位置消费
props.put("auto.offset.reset", "latest");

// 手动重置
consumer.seekToBeginning(partitions);
consumer.seek(partition, offset);
```

## 6. 最佳实践

1. **手动提交 Offset**：保证消息不丢
2. **先处理再提交**：不要先提交再处理
3. **分区级别提交**：精确控制每个分区的 Offset
4. **处理 Rebalance**：在 onPartitionsRevoked 中提交已处理的 Offset
5. **幂等消费**：即使 Offset 管理完美，网络问题仍可能导致重复
