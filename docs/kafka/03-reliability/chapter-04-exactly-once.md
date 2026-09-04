# Exactly Once 语义

> Exactly Once 是消息系统的最高可靠性保证：消息恰好被处理一次，不丢不重。本文讲清三种语义的区别、事务机制，以及消费端的 Exactly Once 实现。

## 1. 三种语义

| 语义 | 说明 | 实现 |
| :-- | :-- | :-- |
| At Most Once | 最多一次，可能丢消息 | acks=0 |
| At Least Once | 至少一次，可能重复 | acks=all + 重试 |
| Exactly Once | 恰好一次，不丢不重 | 幂等 + 事务 |

## 2. 幂等生产者：单分区 Exactly Once

幂等生产者通过 PID + Sequence Number 保证单分区内的去重。详见 [ACK 与幂等](../02-core/chapter-05-ack-and-idempotence.md) §3。

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

**Transaction Coordinator 是运行在每个 Broker 上的逻辑组件**，不是独立部署的进程或服务。它的职责是跟踪事务的进行状态，并把提交/回滚决定持久化到 `__transaction_state` 主题。

事务由它管理：

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

**两阶段提交为什么要分两步**：事务消息在 `beginTransaction` 后就已经写入各分区，但带有一个"未提交"标记。`commitTransaction` 并不是直接"让消息生效"，而是分两步：

```txt
第一步（Prepare）：Coordinator 把所有涉及分区的状态写成 PrepareCommit，
                   持久化到 __transaction_state
第二步（Commit）：  Coordinator 把状态推进为 CompleteCommit，
                   并写入各分区的 COMMIT 控制标记
```

分两步的意义在于**崩溃恢复**：如果第一步之后、第二步之前 Coordinator 宕机，重启后能从 `__transaction_state` 读到 PrepareCommit 状态，判断这个事务该继续提交还是回滚。只有第二步完成后，事务才是不可逆的"已提交"。

**`read_committed` 消费者靠什么感知提交**：Broker 在事务提交时会往各分区写入一条**控制消息（control batch）**作为 COMMIT 标记。`read_committed` 消费者读到这个标记，才知道之前那些"未提交"的事务消息现在可以放行；读到 ABORT 标记则跳过整批。这也是事务会引入额外延迟的原因——消费者要多等一个控制消息到达。

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

**Offset 是怎么纳入事务的**：消费 Offset 平时由消费者组协调器（GroupCoordinator）写入内部的 `__consumer_offsets` Topic。`sendOffsetsToTransaction` 做的事是——把"这一批消费到的 Offset"也作为事务的一个参与方挂到当前事务上，由 Transaction Coordinator 在提交时一并写 COMMIT 标记。这样 Offset 的提交和输出消息的提交共享同一个结局：事务提交，Offset 才推进，下游才看到输出；事务回滚，Offset 不动，消费者重启后会重新消费这批消息。

关键前提是**必须关闭自动提交**（`enable.auto.commit=false`），否则自动提交会在事务之外单独推进 Offset，把事务的原子性撕开一道口子。

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

性能下降来自三个叠加的延迟源：每条事务消息多带一个"未提交"标记、提交时多一次与 Coordinator 的往返（两阶段）、消费者要等控制消息到达才放行。这三处都是事务语义强加的开销，无法用参数消除，只能靠"只在真正需要跨分区原子性的场景用事务"来规避。

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
