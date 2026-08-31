# 消息顺序

> Kafka 保证 Partition 内有序，但不保证全局有序。理解这一点是设计消息系统的基础。

## 1. Partition 内有序

```text
Partition 0: [msg0][msg1][msg2][msg3]...
  → 严格按写入顺序消费
  → 先发的先收到
```

## 2. 全局无序

```text
Partition 0: [msgA][msgC]
Partition 1: [msgB][msgD]

消费顺序可能是：msgA, msgB, msgC, msgD 或 msgB, msgA, msgD, msgC
```

## 3. 如何保证全局有序

### 方案 1：单 Partition

```text
Topic 只设 1 个 Partition
  → 全局有序
  → 无法并行消费，吞吐量受限
```

### 方案 2：相同 Key 发到同一 Partition

```java
// 同一个订单的消息发到同一个 Partition
producer.send(new ProducerRecord<>("orders", orderId, message));
// orderId 相同 → hash 相同 → 同一个 Partition
```

```text
orderId=001 → Partition 0: [创建][支付][发货]
orderId=002 → Partition 1: [创建][支付]

同一订单内有序，不同订单间无序
```

## 4. 顺序与重试的冲突

```text
问题：
  msg1 发送失败 → 重试 msg1
  msg2 发送成功
  结果：msg2 先到，msg1 后到 → 乱序！

解决：
  max.in.flight.requests.per.connection = 1
  → 一次只发一条，等确认后再发下一条
  → 牺牲性能保顺序
```

### 幂等生产者 + 顺序保证

```java
props.put("enable.idempotence", true);
props.put("max.in.flight.requests.per.connection", 5);
```

开启幂等后，即使 `max.in.flight.requests.per.connection > 1`，也能保证顺序（Kafka 内部处理乱序）。

## 5. 最佳实践

1. **相同业务 Key 发到同一 Partition**：保证业务内有序
2. **开启幂等生产者**：避免重试导致乱序
3. **不要追求全局有序**：大多数场景只需要业务内有序
4. **Consumer 端按 Key 分组处理**：相同 Key 的消息保证顺序处理
