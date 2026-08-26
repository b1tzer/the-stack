# 分区策略

## 1. 默认策略

```java
// 1. 指定分区
new ProducerRecord<>("topic", 0, "key", "value");

// 2. 有 key → hash(key) % 分区数
new ProducerRecord<>("topic", "key", "value");

// 3. 无 key → 轮询（粘性分区）
new ProducerRecord<>("topic", "value");
```

## 2. 自定义分区器

```java
public class CustomPartitioner implements Partitioner {
    @Override
    public int partition(String topic, Object key, byte[] keyBytes, 
                         Object value, byte[] valueBytes, Cluster cluster) {
        // 自定义分区逻辑
        return Math.abs(key.hashCode()) % cluster.partitionCountForTopic(topic);
    }
}

// 配置
props.put("partitioner.class", "com.example.CustomPartitioner");
```

## 3. 分区与顺序

- 单分区内：消息有序
- 跨分区：无序
- 需要全局有序：只用 1 个分区（牺牲性能）

## 4. 粘性分区（Sticky Partitioner）

从 Kafka 2.4 开始，默认分区器改为粘性分区（DefaultPartitioner 被弃用，使用 UniformStickyPartitioner）：

- **无 Key 时**：选择一个分区批量发送，批次满后切换到下一个分区，减少小批次问题。
- **有 Key 时**：仍然使用 murmur2 hash，保证相同 Key 到相同分区。

```java
// 粘性分区行为演示
for (int i = 0; i < 100; i++) {
    // 无 Key 消息会连续发送到同一分区，直到批次满
    producer.send(new ProducerRecord<>("topic", null, "msg-" + i));
}
```

## 5. 自定义分区器实战

```java
public class BusinessPartitioner implements Partitioner {
    private int vipPartitionCount;

    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                         Object value, byte[] valueBytes, Cluster cluster) {
        int partitionCount = cluster.partitionCountForTopic(topic);
        String keyValue = (String) key;

        // VIP 用户路由到分区 0，实现优先处理
        if (keyValue != null && keyValue.startsWith("VIP")) {
            return 0;
        }

        // 其他用户均匀分配到剩余分区
        return (Math.abs(key.hashCode()) % (partitionCount - 1)) + 1;
    }

    @Override
    public void close() {}

    @Override
    public void configure(Map<String, ?> configs) {}
}
```

## 6. 分区数与性能的关系

| 分区数 | 优势 | 劣势 |
|--------|------|------|
| 少（1-10） | 元数据开销小，Leader 选举快 | 并发度受限 |
| 中（10-100） | 平衡并发和开销 | 合理范围 |
| 多（>1000） | 高并发消费 | Leader 选举慢，Controller 压力大 |

经验公式：**分区数 = max(生产者并发数, 消费者并发数)**

## 7. 分区扩展注意事项

```bash
# 增加分区数（只能增加，不能减少）
kafka-topics.sh --alter --topic my-topic --partitions 6 --bootstrap-server localhost:9092
```

⚠️ **扩展分区后的风险**：
- 有 Key 的消息重新 Hash 后可能路由到新分区，破坏消息顺序。
- 依赖分区数的自定义分区器可能需要调整。

## 8. 最佳实践

1. **生产环境使用有 Key 的消息**：确保同一业务实体的消息在同一分区，保证局部有序。
2. **合理设置初始分区数**：分区只能增加不能减少，初始值建议为消费者实例数的 2-3 倍。
3. **避免过多分区**：超过 1000 个分区时，Controller 故障恢复时间会显著增加。
4. **监控分区数据倾斜**：使用 `kafka-log-dirs.sh` 检查各分区数据量是否均衡。
