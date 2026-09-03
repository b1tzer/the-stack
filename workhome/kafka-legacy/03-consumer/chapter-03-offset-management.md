# Offset 管理

## 1. 自动提交

```java
props.put("enable.auto.commit", true);
props.put("auto.commit.interval.ms", 5000);
```

问题：可能丢消息或重复消费。

## 2. 手动提交

```java
// 同步提交
consumer.commitSync();

// 异步提交
consumer.commitAsync((offsets, exception) -> {
    if (exception != null) {
        System.err.println("Commit failed: " + exception);
    }
});

// 指定 Offset 提交
consumer.commitSync(Collections.singletonMap(
    new TopicPartition("topic", 0), 
    new OffsetAndMetadata(offset + 1)
));
```

## 3. 指定 Offset 消费

```java
// 从头消费
consumer.seekToBeginning(partitions);

// 从末尾消费
consumer.seekToEnd(partitions);

// 指定 Offset
consumer.seek(new TopicPartition("topic", 0), 100);
```

## 4. Offset 存储

- 存储在 `__consumer_offsets` 主题中
- Key：group.id + topic + partition
- Value：offset

## 5. Offset 存储机制详解

`__consumer_offsets` 是 Kafka 内部 Topic，默认 50 个分区：

```
Key: (group.id, topic, partition)
Value: {
    "offset": 12345,
    "metadata": "optional metadata string",
    "commit_timestamp": 1692000000000
}
```

**Offset 提交流程**：
1. Consumer 发送 OffsetCommitRequest 到 Group Coordinator。
2. Coordinator 将 Offset 写入 `__consumer_offsets` 的对应分区。
3. 返回成功/失败响应。

## 6. Offset 重置策略

```java
props.put("auto.offset.reset", "latest");  // 无有效 Offset 时从最新开始
// 或
props.put("auto.offset.reset", "earliest"); // 无有效 Offset 时从最早开始
// 或
props.put("auto.offset.reset", "none");     // 无有效 Offset 时抛出异常
```

**何时触发重置**：
- 消费者首次加入组，没有已提交的 Offset。
- 已提交的 Offset 对应的消息已被删除（超过保留时间）。
- 已提交的 Offset 无效（数据损坏等）。

## 7. 精确 Offset 管理

```java
// 场景：处理完消息后才提交 Offset
while (running) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, String> record : records) {
        processRecord(record);
        // 每处理完一条就提交（性能差，但最精确）
        consumer.commitSync(Collections.singletonMap(
            new TopicPartition(record.topic(), record.partition()),
            new OffsetAndMetadata(record.offset() + 1)
        ));
    }
}
```

**性能优化：批量提交**
```java
List<ConsumerRecord<String, String>> batch = new ArrayList<>();
while (running) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, String> record : records) {
        processRecord(record);
        batch.add(record);
    }
    if (!batch.isEmpty()) {
        // 批量提交最新 Offset
        Map<TopicPartition, OffsetAndMetadata> offsets = new HashMap<>();
        for (ConsumerRecord<String, String> r : batch) {
            offsets.put(
                new TopicPartition(r.topic(), r.partition()),
                new OffsetAndMetadata(r.offset() + 1)
            );
        }
        consumer.commitAsync(offsets, null);
        batch.clear();
    }
}
```

## 8. __consumer_offsets 管理

```bash
# 查看消费者组的 Offset
kafka-consumer-groups.sh --describe --group my-group --bootstrap-server localhost:9092

# 重置 Offset（谨慎使用）
kafka-consumer-groups.sh --group my-group --topic my-topic \
    --reset-offsets --to-earliest --execute --bootstrap-server localhost:9092

# 重置到指定时间点
kafka-consumer-groups.sh --group my-group --topic my-topic \
    --reset-offsets --to-datetime "2024-01-01T00:00:00.000" --execute --bootstrap-server localhost:9092
```

