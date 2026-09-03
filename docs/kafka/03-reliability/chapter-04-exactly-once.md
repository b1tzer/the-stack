# Exactly Once 语义

> Exactly Once 是消息系统的最高可靠性保证：消息恰好被处理一次，不丢不重。本文讲清三种语义的区别、事务机制，以及消费端的 Exactly Once 实现。

## 1. 三种语义

| 语义 | 说明 | 实现 |
| :-- | :-- | :-- |
| At Most Once | 最多一次，可能丢消息 | acks=0 |
| At Least Once | 至少一次，可能重复 | acks=all + 重试 |
| Exactly Once | 恰好一次，不丢不重 | 幂等 + 事务 |

## 2. 幂等生产者：单分区 Exactly Once

幂等生产者通过 PID + Sequence Number 保证单分区内的去重。详见 [ACK 与幂等](../02-core/chapter-05-ack-and-idempotence.md) §4。

## 3. 事务：跨分区 Exactly Once

### 3.1 事务 API

```java
Properties props = new Properties();
props.put("transactional.id", "my-transactional-id");
props.put("enable.idempotence", true);

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
producer.initTransactions();

try {
    producer.beginTransaction();
    producer.send(new ProducerRecord<>("topic1", "key1", "value1"));
    producer.send(new ProducerRecord<>("topic2", "key2", "value2"));
    producer.commitTransaction();
} catch (Exception e) {
    producer.abortTransaction();
}
```

### 3.2 Transaction Coordinator

事务由 Transaction Coordinator 管理：

```txt
Producer → Transaction Coordinator：
  InitProducerId：获取 PID + Epoch
  AddPartitionsToTxn：注册事务涉及的分区
  EndTxn：提交或回滚

Transaction Coordinator → __transaction_state：
  写入事务状态日志
  两阶段提交：Prepare → Commit/Abort
```

**Coordinator 为什么必须固定**：`transactional.id` 通过哈希落到 `__transaction_state` 的某个分区，该分区的 Leader 就是 Coordinator。哈希保证同一个 `transactional.id` 的所有请求始终路由到同一个 Coordinator，状态天然集中。

**Epoch 是防「僵尸生产者」的版本号**：旧 Producer 实例因网络分区「失联」，新实例 `initTransactions()` 时 Epoch 递增。旧实例再发请求时版本对不上，被拒绝并触发 `ProducerFencedException`。

### 3.3 事务隔离级别

```java
props.put("isolation.level", "read_committed");   // 只读已提交的事务消息
props.put("isolation.level", "read_uncommitted");  // 读所有消息（默认）
```

事务消息写入分区后，`read_committed` 消费者暂时看不到它；只有 Coordinator 把 COMMIT 标记写进 `__transaction_state` 后，这些消息才对消费者可见。

### 3.4 消费-生产 Exactly Once 模式

最常见的 Exactly Once 场景：消费 Topic A → 处理 → 写入 Topic B，同时提交 Offset。

```java
producer.initTransactions();
consumer.subscribe(Arrays.asList("input-topic"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    if (records.isEmpty()) continue;

    try {
        producer.beginTransaction();
        for (ConsumerRecord<String, String> record : records) {
            String result = process(record.value());
            producer.send(new ProducerRecord<>("output-topic", record.key(), result));
        }
        // 将消费 Offset 也纳入事务
        producer.sendOffsetsToTransaction(offsets, consumer.groupMetadata());
        producer.commitTransaction();
    } catch (Exception e) {
        producer.abortTransaction();
    }
}
```

输出 Topic 的消息和输入 Topic 的 Offset 在同一个事务中原子提交——要么都成功，要么都回滚。

## 4. 消费端 Exactly Once

Kafka 的事务只保证生产端。消费端的 Exactly Once 需要额外处理：

| 场景 | 方案 |
| :-- | :-- |
| Kafka → Kafka | 事务消费-生产模式（见上） |
| Kafka → 外部系统 | 业务层幂等（唯一键 / SETNX / 版本号） |

详见 [消息去重](./chapter-02-message-dedup.md)。

## 5. Exactly Once 的代价

| 代价 | 说明 |
| :-- | :-- |
| 性能下降 | 事务需要两阶段提交，增加延迟 |
| 复杂度增加 | 需要配置 transactional.id、isolation.level |
| 存储开销 | 事务状态日志占用存储 |

> 大多数场景用 At Least Once + 幂等消费就够了。只有 Kafka → Kafka 的流处理场景才需要完整的 Exactly Once。

## 6. 配置清单

```java
// 生产者
props.put("transactional.id", "unique-id");
props.put("enable.idempotence", true);
props.put("acks", "all");
props.put("transaction.timeout.ms", 60000);

// 消费者
props.put("isolation.level", "read_committed");
props.put("enable.auto.commit", false);
```

```properties
# Broker
transaction.state.log.replication.factor=3
transaction.state.log.min.isr=2
```
