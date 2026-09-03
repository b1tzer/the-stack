# 消息顺序

> 消息顺序是很多业务场景的硬性要求。Kafka 保证单分区内有序，但不保证跨分区有序。本文讲清顺序保证的边界、破坏顺序的场景，以及如何在业务层保证全局有序。

## 1. Kafka 的顺序保证

| 维度 | 顺序保证 |
| :-- | :-- |
| 单分区内 | 严格有序（写入顺序 = 读取顺序） |
| 跨分区 | 无序 |
| 全局有序 | 不保证（需要特殊处理） |

单分区内有序的原理：每个分区是一条独立的追加日志，消息按写入先后排列。详见 [分区与 Offset](../02-core/chapter-01-partition-and-offset.md)。

## 2. 破坏顺序的场景

### 2.1 重试导致乱序

```txt
发送 msg1 → 失败（重试中）
发送 msg2 → 成功
msg1 重试成功
结果：msg2 在 msg1 之前（乱序）
```

解决方案：开启幂等生产者，内部通过 Sequence Number 重排序。

```java
props.put("enable.idempotence", true);
props.put("max.in.flight.requests.per.connection", 5);  // 允许 5 个在途请求，内部保证顺序
```

### 2.2 分区扩展导致乱序

有 Key 的消息在分区扩展后 rehash，同一 Key 的消息可能路由到新分区：

```txt
扩展前：Key=A 的消息全部到 Partition 0（有序）
扩展后：Key=A 的消息部分到 Partition 0，部分到 Partition 3（无序）
```

### 2.3 消费者 Rebalance 导致乱序

Rebalance 期间，分区重新分配，可能导致同一分区的消息被不同消费者处理。

## 3. 保证顺序的方案

### 3.1 单分区内有序（最简单）

```java
// 同一业务实体的消息用相同的 Key
new ProducerRecord<>("orders", orderId, event);
```

适用场景：同一订单的状态变更、同一用户的行为日志。

### 3.2 全局有序（牺牲性能）

```java
// 只用 1 个分区
kafka-topics.sh --create --topic ordered-topic --partitions 1 --replication-factor 3
```

| 维度 | 说明 |
| :-- | :-- |
| 优点 | 严格全局有序 |
| 缺点 | 只能用 1 个消费者，无并行度 |
| 适用场景 | 吞吐量低、顺序要求极高 |

### 3.3 业务层排序（推荐）

不依赖 Kafka 的顺序保证，在消费端按业务时间戳排序：

```java
TreeMap<Long, List<ConsumerRecord>> sorted = new TreeMap<>();
for (ConsumerRecord record : records) {
    sorted.computeIfAbsent(record.timestamp(), k -> new ArrayList<>()).add(record);
}
```

## 4. 方案选型

| 方案 | 顺序保证 | 吞吐量 | 复杂度 |
| :-- | :-- | :-- | :-- |
| 单分区 | 全局有序 | 低（无并行） | 低 |
| 多分区 + 相同 Key | 局部有序 | 高 | 低 |
| 业务层排序 | 最终有序 | 高 | 中 |

> 大多数业务只需要「同一实体有序」，不需要全局有序。用 Key 路由到同一分区是最优方案。
