# Exactly Once 语义

## 1. 三种语义

| 语义 | 说明 | 实现 |
|------|------|------|
| At Most Once | 最多一次，可能丢消息 | acks=0 |
| At Least Once | 至少一次，可能重复 | acks=all + 重试 |
| Exactly Once | 精确一次 | 幂等 + 事务 |

## 2. 幂等生产者

```properties
enable.idempotence=true
acks=all
retries=Integer.MAX_VALUE
```

原理：PID + Sequence Number 去重。

## 3. 事务

```java
producer.initTransactions();
producer.beginTransaction();
// 发送消息
producer.commitTransaction();
```

## 4. 消费端 Exactly Once

```properties
isolation.level=read_committed
```

- 只读取已提交事务的消息
- 配合消费者 Offset 手动提交

## 5. 幂等生产者原理详解

```
Producer 启动
    │
    ▼
InitProducerIdRequest → 分配 PID (Producer ID)
    │
    ▼
每条消息附带 (PID, Sequence Number)
    │
    ▼
Broker 检查:
    ├── 当前 PID 的期望 Sequence = N
    ├── 收到消息的 Sequence = N → 正常写入，期望变为 N+1
    ├── 收到消息的 Sequence < N → 重复消息，丢弃
    └── 收到消息的 Sequence > N → 乱序，抛出异常
```

**局限性**：
- 只能保证单分区内不重复。
- PID 在 Producer 重启后会变化。
- 不能跨 Topic 保证原子性。

## 6. 事务 Exactly Once 详解

```
事务流程:

1. initTransactions()
   → 向 Transaction Coordinator 注册
   → 获取 PID + Epoch
   → fence 旧的 Producer 实例（如果有）

2. beginTransaction()
   → 标记事务开始

3. send() × N
   → 消息写入分区（对 read_committed 不可见）

4. sendOffsetsToTransaction()
   → 将消费 Offset 纳入事务
   → Offset 写入 __consumer_offsets

5. commitTransaction() / abortTransaction()
   → 写入 COMMIT/ABORT 标记
   → read_committed 消费者可以看到已提交的消息
```

## 7. 消费端 Exactly Once 实现

```java
// 配置消费者只读取已提交的消息
props.put("isolation.level", "read_committed");

// 完整的消费-生产 Exactly Once 示例
Properties producerProps = new Properties();
producerProps.put("bootstrap.servers", "localhost:9092");
producerProps.put("transactional.id", "my-tx-id");
producerProps.put("enable.idempotence", true);

KafkaProducer<String, String> producer = new KafkaProducer<>(
    producerProps, new StringSerializer(), new StringSerializer());

Properties consumerProps = new Properties();
consumerProps.put("bootstrap.servers", "localhost:9092");
consumerProps.put("group.id", "my-group");
consumerProps.put("isolation.level", "read_committed");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(
    consumerProps, new StringDeserializer(), new StringDeserializer());

producer.initTransactions();
consumer.subscribe(Arrays.asList("input-topic"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    if (records.isEmpty()) continue;
    
    producer.beginTransaction();
    try {
        for (ConsumerRecord<String, String> record : records) {
            producer.send(new ProducerRecord<>("output-topic", 
                record.key(), process(record.value())));
        }
        producer.sendOffsetsToTransaction(
            KafkaUtils.consumerOffsets(records),
            consumer.groupMetadata());
        producer.commitTransaction();
    } catch (Exception e) {
        producer.abortTransaction();
    }
}
```

## 8. Exactly Once 的代价

| 代价 | 说明 |
|------|------|
| 性能损耗 | 事务需要额外的网络往返和磁盘写入 |
| 复杂度 | 需要正确处理 ProducerFencedException |
| 延迟增加 | read_committed 消费者需要等待事务提交 |
| 资源消耗 | Transaction Coordinator 需要维护事务状态 |

## 9. 最佳实践

1. **简单场景用幂等生产者**：单分区去重足够时，不需要事务。
2. **消费-生产场景用事务**：需要保证消费 Offset 和生产消息的原子性时使用。
3. **避免长事务**：事务时间越长，对消费者延迟影响越大。
4. **每个实例使用唯一的 transactional.id**：避免 ProducerFencedException。
