# Exactly Once

> Kafka 的"精确一次"语义（Exactly Once Semantics）保证消息既不丢也不重复。

## 1. 三种语义

| 语义 | 含义 | 实现难度 |
|------|------|----------|
| At Most Once | 最多一次，可能丢消息 | 简单 |
| At Least Once | 最少一次，可能重复 | 中等 |
| Exactly Once | 精确一次，不丢不重 | 复杂 |

## 2. Kafka 的 Exactly Once 实现

### 2.1 Producer 端：幂等 + 事务

```java
props.put("enable.idempotence", true);
props.put("transactional.id", "order-producer-1");

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
producer.initTransactions();

try {
    producer.beginTransaction();
    producer.send(new ProducerRecord<>("orders", "key1", "value1"));
    producer.send(new ProducerRecord<>("orders", "key2", "value2"));
    producer.commitTransaction();
} catch (Exception e) {
    producer.abortTransaction();
}
```

**幂等保证**：同一个 Producer ID + Sequence Number 的消息只写入一次。

**事务保证**：多条消息要么全部成功，要么全部失败。

### 2.2 Consumer 端：read_committed

```java
props.put("isolation.level", "read_committed");
```

Consumer 只读取已提交事务的消息。

## 3. 端到端 Exactly Once

```text
Producer（幂等+事务）→ Kafka（持久化）→ Consumer（手动提交）

要实现端到端 Exactly Once：
  1. Producer 幂等 + 事务
  2. Consumer 手动提交 Offset
  3. Consumer 处理逻辑幂等（数据库唯一约束等）
```

## 4. 事务的性能开销

| 维度 | 无事务 | 有事务 |
|------|--------|--------|
| 吞吐量 | 高 | 降低 10-30% |
| 延迟 | 低 | 稍高 |
| 适用场景 | 日志收集 | 金融、订单 |

## 5. 最佳实践

1. **开启幂等**：`enable.idempotence=true`（几乎无性能损失）
2. **需要原子性时用事务**：多条消息要么全成功要么全失败
3. **Consumer 端做幂等**：即使 Exactly Once 也可能有边界情况
4. **read_committed + 手动提交**：Consumer 端的可靠保证
