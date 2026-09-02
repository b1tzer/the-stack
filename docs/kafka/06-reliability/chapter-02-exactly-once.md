# Exactly Once 语义

> Exactly Once 是消息系统的最高可靠性保证：消息恰好被处理一次，不丢不重。本章讲清三种语义的区别、幂等生产者原理、事务机制，以及消费端的 Exactly Once 实现。

## 1. 三种语义

| 语义 | 说明 | 实现 |
| :-- | :-- | :-- |
| At Most Once | 最多一次，可能丢消息 | acks=0 |
| At Least Once | 至少一次，可能重复 | acks=all + 重试 |
| Exactly Once | 恰好一次，不丢不重 | 幂等 + 事务 |

## 2. 幂等生产者

幂等生产者的 PID + Sequence Number 原理、配置、限制，见 [ACK 机制与重试](../02-producer/chapter-03-acks-retries.md) §2。

## 3. 事务生产者

事务解决了幂等的限制——支持跨分区原子写入。

### 3.1 事务流程

```java
Properties props = new Properties();
props.put("transactional.id", "my-transactional-id");  // 事务 ID
props.put("enable.idempotence", true);
props.put("acks", "all");

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
producer.initTransactions();  // 初始化事务

try {
    producer.beginTransaction();
    producer.send(new ProducerRecord<>("topic1", "key1", "value1"));
    producer.send(new ProducerRecord<>("topic2", "key2", "value2"));
    producer.commitTransaction();  // 原子提交
} catch (Exception e) {
    producer.abortTransaction();  // 回滚
}
```

### 3.2 Transaction Coordinator

事务由 Transaction Coordinator 管理：

```text
Producer → Transaction Coordinator：
  InitProducerId：获取 PID + Epoch
  AddPartitionsToTxn：注册事务涉及的分区
  EndTxn：提交或回滚

Transaction Coordinator → __transaction_state：
  写入事务状态日志
  两阶段提交：Prepare → Commit/Abort
```

### 3.3 事务隔离级别

```java
// 消费者配置
props.put("isolation.level", "read_committed");  // 只读已提交的事务消息
// 或
props.put("isolation.level", "read_uncommitted");  // 读所有消息（包括未提交）
```

| 隔离级别 | 说明 |
| :-- | :-- |
| `read_uncommitted` | 默认，读所有消息（包括未提交事务的） |
| `read_committed` | 只读已提交事务的消息 |

## 4. 消费端 Exactly Once

Kafka 的事务只保证生产端的 Exactly Once。消费端的 Exactly Once 需要额外处理：

### 4.1 手动提交 + 幂等处理

```java
while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, String> record : records) {
        // 幂等处理（如用数据库唯一键去重）
        processIdempotent(record);
    }
    consumer.commitSync();  // 处理完提交
}
```

### 4.2 事务消费（Kafka → Kafka）

```java
// 从一个 Topic 消费，处理后写入另一个 Topic，原子性
consumer.subscribe(Collections.singletonList("input-topic"));
producer.initTransactions();

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    producer.beginTransaction();
    for (ConsumerRecord<String, String> record : records) {
        producer.send(new ProducerRecord<>("output-topic", record.key(), process(record)));
    }
    // 原子提交：输出 Topic 的消息 + 输入 Topic 的 Offset
    producer.sendOffsetsToTransaction(offsets, consumer.groupMetadata());
    producer.commitTransaction();
}
```

## 5. Exactly Once 的代价

| 代价 | 说明 |
| :-- | :-- |
| 性能下降 | 事务需要两阶段提交，增加延迟 |
| 复杂度增加 | 需要配置 transactional.id、isolation.level |
| 存储开销 | 事务状态日志占用存储 |

> 大多数场景用 At Least Once + 幂等消费就够了。只有 Kafka → Kafka 的流处理场景才需要完整的 Exactly Once。

