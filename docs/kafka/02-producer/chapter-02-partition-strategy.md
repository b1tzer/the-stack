# 分区策略

> 分区策略决定了消息被发送到哪个分区，直接影响消息顺序、负载均衡和消费并行度。本章讲清默认策略、自定义分区器，以及分区数与性能的关系。

## 1. 默认分区策略

Kafka 的默认分区器（`UniformStickyPartitioner`，2.4+）的行为：

```text
1. 指定分区 → 直接发送到该分区
2. 有 Key → murmur2(key) % 分区数（相同 Key 到相同分区）
3. 无 Key → 粘性分区（批次内发到同一分区，批次满后切换）
```

```java
// 1. 指定分区
new ProducerRecord<>("topic", 0, "key", "value");

// 2. 有 Key → hash 路由
new ProducerRecord<>("topic", "user:1001", "value");

// 3. 无 Key → 粘性分区
new ProducerRecord<>("topic", "value");
```

### 1.1 粘性分区（Sticky Partitioner）

Kafka 2.4 之前默认使用 RoundRobin 分区器，无 Key 时每条消息轮询到不同分区——导致每个分区的 batch 都很小，发送效率低。

粘性分区的改进：无 Key 的消息在同一个 batch 内发到同一分区，batch 满后切换到下一个分区：

```text
RoundRobin：msg0→P0, msg1→P1, msg2→P2, msg3→P0, ...（每个 batch 只有 1 条）
Sticky：    msg0→P0, msg1→P0, msg2→P0, ... batch满 → msg3→P1, msg4→P1, ...
```

粘性分区提高了 batch 利用率，减少了网络请求次数。

## 2. 自定义分区器

```java
public class BusinessPartitioner implements Partitioner {

    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                         Object value, byte[] valueBytes, Cluster cluster) {
        int partitionCount = cluster.partitionCountForTopic(topic);
        String keyValue = (String) key;

        // VIP 用户路由到分区 0（优先处理）
        if (keyValue != null && keyValue.startsWith("VIP")) {
            return 0;
        }

        // 其他用户均匀分配
        return (Math.abs(key.hashCode()) % (partitionCount - 1)) + 1;
    }

    @Override
    public void close() {}

    @Override
    public void configure(Map<String, ?> configs) {}
}

// 配置
props.put("partitioner.class", "com.example.BusinessPartitioner");
```

## 3. 分区与顺序

| 维度 | 顺序保证 |
| :-- | :-- |
| 单分区内 | 严格有序 |
| 跨分区 | 无序 |
| 全局有序 | 只用 1 个分区（牺牲并行度） |

需要局部有序的场景：同一用户的操作必须有序。解决方案：

```java
// 用用户 ID 作为 Key，同一用户的所有消息路由到同一分区
new ProducerRecord<>("user-events", userId, event);
```

## 4. 分区数与性能

| 分区数 | 优势 | 劣势 |
| :-- | :-- | :-- |
| 少（1~10） | 元数据开销小，Leader 选举快 | 并发度受限 |
| 中（10~100） | 平衡并发和开销 | 合理范围 |
| 多（>1000） | 高并发消费 | Leader 选举慢，Controller 压力大 |

### 4.1 经验公式

```text
分区数 = max(生产者并发数, 消费者并发数)
```

### 4.2 分区过多的代价

| 代价 | 说明 |
| :-- | :-- |
| Leader 选举慢 | 每个分区都需要选举 Leader，分区越多越慢 |
| Controller 压力大 | 元数据管理开销增加 |
| 文件句柄多 | 每个分区对应多个文件，分区越多打开的文件越多 |
| 端到端延迟增加 | 多个分区的 HW 推进需要协调 |

> 分区数超过 1000 时，Controller 故障恢复时间会显著增加。如果需要更多并行度，建议先优化消费者处理速度，而不是盲目增加分区。

## 5. 分区扩展

```bash
# 只能增加，不能减少
kafka-topics.sh --alter --topic my-topic --partitions 6 --bootstrap-server localhost:9092
```

扩展分区的风险：

| 风险 | 说明 |
| :-- | :-- |
| Key 路由变化 | 有 Key 的消息 rehash 后可能路由到新分区，破坏顺序 |
| 消费者 Rebalance | 分区数变化触发 Rebalance |
| 数据倾斜 | 新分区没有历史数据，短期内数据不均衡 |

> 分区扩展前必须评估 Key 路由变化的影响。如果业务依赖 Key 的顺序性，扩展分区会导致顺序破坏。

## 6. 最佳实践

1. **有 Key 的消息**：确保同一业务实体的消息在同一分区，保证局部有序。
2. **初始分区数**：设为消费者实例数的 2~3 倍，预留扩展空间。
3. **避免过多分区**：超过 1000 个分区时 Controller 压力大。
4. **监控数据倾斜**：`kafka-log-dirs.sh` 检查各分区数据量是否均衡。
