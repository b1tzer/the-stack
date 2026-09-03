# 消息去重

> 消息重复是 Kafka 的常态——acks=all + 重试保证不丢，但可能重复。本文讲清重复的来源和去重方案。

## 1. 重复的来源

| 环节 | 原因 | 说明 |
| :-- | :-- | :-- |
| 生产者 | 网络超时重试 | Broker 已写入，但 ACK 丢失，生产者重试 → 重复 |
| 消费者 | Offset 提交失败 | 处理完消息后、提交 Offset 前宕机，重启后重复消费 |
| 消费者 | Rebalance | 分区重新分配，未提交的 Offset 导致重复 |

## 2. 生产端去重：幂等生产者

幂等生产者通过 PID + Sequence Number 保证单分区内的 Exactly Once。详见 [ACK 与幂等](../02-core/chapter-05-ack-and-idempotence.md) §4。

```java
props.put("enable.idempotence", true);
props.put("acks", "all");
```

幂等生产者的限制：只保证单分区内的去重，跨分区无法保证。

## 3. 跨分区去重：事务生产者

事务生产者支持跨分区原子写入，配合 `read_committed` 隔离级别实现消费-生产场景的 Exactly Once。详见 [Exactly Once](./chapter-04-exactly-once.md)。

## 4. 消费端去重

Kafka 的事务只保证生产端。消费端的去重需要在业务层实现。

### 4.1 幂等处理（推荐）

利用数据库唯一键或 Redis 去重：

```java
// 方案1：数据库唯一键
try {
    insertOrder(order);  // INSERT，唯一键冲突则忽略
} catch (DuplicateKeyException e) {
    logger.info("Duplicate message: {}", order.getId());
}

// 方案2：Redis SETNX
Boolean isNew = redisTemplate.opsForValue()
    .setIfAbsent("processed:" + messageId, "1", 24, TimeUnit.HOURS);
if (isNew) {
    processMessage(message);
}
```

### 4.2 事务消费（Kafka → Kafka）

```java
producer.initTransactions();
while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    producer.beginTransaction();
    for (ConsumerRecord<String, String> record : records) {
        producer.send(new ProducerRecord<>("output-topic", record.key(), process(record)));
    }
    producer.sendOffsetsToTransaction(offsets, consumer.groupMetadata());
    producer.commitTransaction();
}
```

## 5. 去重方案选型

| 场景 | 方案 | 说明 |
| :-- | :-- | :-- |
| 生产端重复 | 幂等生产者 | 零成本，直接开启 |
| Kafka → Kafka 消费端 | 事务 | 完整的 Exactly Once |
| Kafka → 外部系统 | 业务层幂等 | 唯一键 / SETNX / 版本号 |

> 大多数场景用 At Least Once + 幂等消费就够了。只有 Kafka → Kafka 的流处理场景才需要完整的 Exactly Once。
