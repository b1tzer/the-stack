# 消息顺序保证

## 1. 分区内顺序

- 单分区内消息有序
- 跨分区无序

## 2. 实现方式

```java
// 相同 Key 的消息发到同一分区
producer.send(new ProducerRecord<>("topic", "user-123", "msg1"));
producer.send(new ProducerRecord<>("topic", "user-123", "msg2"));
```

## 3. 全局有序

```java
// 只使用 1 个分区（牺牲性能）
props.put("num.partitions", 1);
```

## 4. 顺序与重试

```properties
# 保证顺序，关闭重试（牺牲可靠性）
retries=0

# 或使用幂等生产者（推荐）
enable.idempotence=true
max.in.flight.requests.per.connection=5
```

## 5. 分区内顺序保证详解

```java
// 相同 Key 的消息保证在同一分区内有序
producer.send(new ProducerRecord<>("orders", "user-123", "{"action":"create","orderId":"1"}"));
producer.send(new ProducerRecord<>("orders", "user-123", "{"action":"pay","orderId":"1"}"));
producer.send(new ProducerRecord<>("orders", "user-123", "{"action":"ship","orderId":"1"}"));
// 这三条消息保证在同一个分区内，且顺序不变
```

## 6. 顺序与重试的冲突

**问题场景**：
```
消息 A (Sequence=0) → 发送失败 → 重试
消息 B (Sequence=1) → 发送成功 → 先到达 Broker
消息 A (Sequence=0) → 重试成功 → 后到达 Broker

结果：Broker 收到 [B, A]，顺序被破坏！
```

**解决方案**：
```java
// 方案1：关闭重试（牺牲可靠性）
props.put("retries", 0);

// 方案2：限制在途请求数（牺牲性能）
props.put("max.in.flight.requests.per.connection", 1);

// 方案3：开启幂等性（推荐）
props.put("enable.idempotence", true);
// 内部通过 Sequence Number 重排序，允许最多 5 个在途请求
```

## 7. 消费端顺序保证

```
消费端顺序保证：

单线程消费 + 单线程处理：绝对有序
单线程消费 + 多线程处理：可能乱序
多线程消费：每个分区内有序，跨分区无序
```

```java
// 保证消费端顺序的模式
while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, String> record : records) {
        // 按分区顺序处理
        processInOrder(record);
    }
    consumer.commitSync();
}
```

## 8. 全有序 vs 局部有序

| 需求 | 实现方式 | 性能 |
|------|----------|------|
| 全局有序 | 1 个分区 | 最差 |
| 用户级有序 | 按用户 ID 分区 | 好 |
| 业务级有序 | 按业务 ID 分区 | 好 |
| 最终一致 | 多分区 + 业务去重 | 最好 |

## 9. 最佳实践

1. **尽量使用局部有序**：按业务 Key 分区，而不是全局有序。全局有序会严重限制吞吐量。
2. **开启幂等性**：`enable.idempotence=true`，几乎无性能损耗，但能保证顺序和去重。
3. **消费端按分区处理**：避免跨分区乱序导致的业务问题。
4. **使用外部排序**：如果确实需要全局有序，可以使用外部排序服务（如 Redis 有序集合）。
