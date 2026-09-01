# 事务生产者

> 事务生产者解决跨分区原子写入：多条消息要么全部可见，要么全部不可见。本文聚焦工程用法与故障处理；「三种语义、两阶段提交、隔离级别」等机制原理见 [Exactly Once 语义](../05-reliability/chapter-02-exactly-once.md)。

## 1. 事务 API

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
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

## 2. Exactly Once 语义

- 幂等生产者：单分区内 Exactly Once
- 事务生产者：跨分区 Exactly Once
- 消费-生产：read_committed 隔离级别

## 3. 配置

```java
props.put("transactional.id", "unique-id");  // 必须唯一
props.put("enable.idempotence", true);        // 必须开启
props.put("acks", "all");                     // 必须 all
```

## 4. 事务工作原理

```
Producer                               Transaction Coordinator
    │                                        │
    ├──initTransactions()──────────────────►│
    │◄──分配 Producer ID + Epoch────────────┤
    │                                        │
    ├──beginTransaction()──────────────────►│
    │                                        │
    ├──send(topic1, key1, value1)──►Broker   │
    ├──send(topic2, key2, value2)──►Broker   │
    │                                        │
    ├──sendOffsetsToTransaction()──────────►│
    │                                        │
    ├──commitTransaction()─────────────────►│
    │                                        │
    │    Coordinator 写入 COMMIT 标记        │
    │    消费者通过 read_committed 读取       │
```

**Transaction Coordinator 为什么必须固定**

`transactional.id` 通过哈希落到 `__transaction_state` 的某个分区，该分区的 Leader 就是本事务的 Transaction Coordinator。为什么不随机挑，而要哈希固定？因为事务的「进行中 / 已提交 / 已回滚」状态要写进 `__transaction_state` 日志；如果每次请求随机选一个 Broker，事务状态就散落在多个节点，任何一处失败都无法判断该提交还是该回滚。哈希保证同一个 `transactional.id` 的所有请求始终路由到同一个 Coordinator，状态天然集中。

**Epoch 是防「僵尸生产者」的版本号**

`PID + Epoch` 中的 Epoch 是一个递增的版本号。典型场景：旧 Producer 实例因网络分区「失联」，你以为它挂了，于是用同一个 `transactional.id` 起了新实例；新实例 `initTransactions()` 时，Coordinator 把 Epoch 从 0 递增到 1。此后旧实例「复活」再发请求，携带的仍是旧 Epoch=0，Coordinator 发现版本对不上，直接拒绝并触发 `ProducerFencedException`。没有 Epoch，旧实例就能继续往事务里写数据，污染新实例已经提交或回滚的事务。

**COMMIT 标记决定可见性**

事务消息写入分区后，`read_committed` 消费者暂时看不到它；只有 Coordinator 把 COMMIT 标记写进 `__transaction_state` 后，这些消息才对消费者可见。这就是两阶段的边界：写数据是第一阶段，写 COMMIT 标记是第二阶段，两阶段之间宕机则事务回滚。

## 5. 消费-生产 Exactly Once 模式

这是最常见的 Exactly Once 场景：消费 Topic A → 处理 → 写入 Topic B，同时提交 Offset。

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("transactional.id", "my-exactly-once-app");
props.put("enable.idempotence", true);

KafkaProducer<String, String> producer = new KafkaProducer<>(
    props, new StringSerializer(), new StringSerializer());

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(
    createConsumerProps(), new StringDeserializer(), new StringDeserializer());

producer.initTransactions();
consumer.subscribe(Arrays.asList("input-topic"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    if (records.isEmpty()) continue;

    try {
        producer.beginTransaction();
        for (ConsumerRecord<String, String> record : records) {
            // 处理消息并发送到输出 Topic
            String result = process(record.value());
            producer.send(new ProducerRecord<>("output-topic", record.key(), result));
        }
        // 将消费 Offset 也纳入事务
        producer.sendOffsetsToTransaction(
            KafkaUtils.consumerOffsets(records),
            consumer.groupMetadata()
        );
        producer.commitTransaction();
    } catch (Exception e) {
        producer.abortTransaction();
        // 处理失败，消息会被重新消费
    }
}
```

## 6. 事务超时与恢复

```java
props.put("transaction.timeout.ms", 60000);  // 事务超时 60 秒
```

**ProducerFencedException 处理**：
当另一个具有相同 `transactional.id` 的 Producer 实例启动时，旧实例会被 fence（隔离）。

```java
try {
    producer.commitTransaction();
} catch (ProducerFencedException e) {
    // 另一个实例抢占了 transactional.id
    producer.close();
    throw new RuntimeException("Another instance took over", e);
}
```

## 7. 事务 vs 非事务对比

| 特性 | 幂等 Producer | 事务 Producer |
|------|---------------|---------------|
| 范围 | 单分区 | 跨分区 + Offset |
| 开销 | 极低 | 中等 |
| 配置 | `enable.idempotence=true` | `transactional.id` + `enable.idempotence=true` |
| 适用 | 简单去重 | 消费-生产 Exactly Once |

## 8. 最佳实践

1. **每个实例使用唯一的 transactional.id**：如 `app-name-partition-0`，避免 Producer Fenced。
2. **不要在事务中发送大量消息**：长事务会阻塞消费者（read_committed），增加延迟。
3. **合理设置 transaction.timeout.ms**：太短会导致长事务被误回滚，太长会延迟消费者可见性。
4. **监控 transaction-abort-rate**：频繁回滚说明系统存在问题。
