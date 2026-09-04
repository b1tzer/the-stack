# 消息去重

> 消息重复是 Kafka 的常态——acks=all + 重试保证不丢，但可能重复。本文讲清重复的来源和去重方案。

## 1. 重复的来源

| 环节 | 原因 | 说明 |
| :-- | :-- | :-- |
| 生产者 | 网络超时重试 | Broker 已写入，但 ACK 丢失，生产者重试 → 重复 |
| 消费者 | Offset 提交失败 | 处理完消息后、提交 Offset 前宕机，重启后重复消费 |
| 消费者 | Rebalance | 分区重新分配，未提交的 Offset 导致重复 |

表格里的三类原因背后是同一个机制：**重复是 At Least Once 的必然代价**。只要选择了 `acks=all` + 重试来保证"不丢"，就必然引入"可能重"。下面两条时序说明重复到底是怎么产生的。

**生产端：ACK 丢失后的重试**

```txt
Producer → Broker: 写入 msg（成功，Broker 已落盘）
Broker   → Producer: 返回 ACK
                     （ACK 在网络中丢失）
Producer: 没等到 ACK → 判定超时 → 重发 msg
Broker:   第二次写入 msg
→ 同一条消息在 Broker 里出现两份
```

关键点：Broker 已经写成功了，只是 ACK 没送达。生产者无法区分"没写进去"和"写进去了但 ACK 丢了"，只能重试。幂等生产者解决的正是这条链路。

**消费端：提交前宕机**

```txt
poll() 拉回 offset 100~200
  → 处理完 100~150
  → 处理 151 时宕机（offset 还没提交）
重启后从上次提交的 offset 150 继续
  → 100~150 被重新处理一遍 → 重复
```

消费端要保证"不丢"就必须"处理完再提交"，而"处理完再提交"天然意味着"提交前宕机会重复处理"。这是同一枚硬币的两面，详见 [消息丢失排查](./chapter-01-message-loss.md) §2.3。

表格里的三类原因背后是同一个机制：**重复是 At Least Once 的必然代价**。只要选择了 `acks=all` + 重试来保证"不丢"，就必然引入"可能重"。下面两条时序说明重复到底是怎么产生的。

**生产端：ACK 丢失后的重试**

```txt
Producer → Broker: 写入 msg（成功，Broker 已落盘）
Broker   → Producer: 返回 ACK
                     （ACK 在网络中丢失）
Producer: 没等到 ACK → 判定超时 → 重发 msg
Broker:   第二次写入 msg
→ 同一条消息在 Broker 里出现两份
```

关键点：Broker 已经写成功了，只是 ACK 没送达。生产者无法区分"没写进去"和"写进去了但 ACK 丢了"，只能重试。幂等生产者解决的正是这条链路。

**消费端：提交前宕机**

```txt
poll() 拉回 offset 100~200
  → 处理完 100~150
  → 处理 151 时宕机（offset 还没提交）
重启后从上次提交的 offset 150 继续
  → 100~150 被重新处理一遍 → 重复
```

消费端要保证"不丢"就必须"处理完再提交"，而"处理完再提交"天然意味着"提交前宕机会重复处理"。这是同一枚硬币的两面，详见 [消息丢失排查](./chapter-01-message-loss.md) §2.3。

## 2. 生产端去重：幂等生产者 {#producer-idempotence}

幂等生产者通过 **PID + Sequence Number** 消除上面那条"ACK 丢失重试"的重复链路。完整机制见 [ACK 与幂等 §3](../02-core/chapter-05-ack-and-idempotence.md#idempotent-producer)，这里只强调三个工程要点：

```java
props.put("enable.idempotence", true);
props.put("acks", "all");
props.put("max.in.flight.requests.per.connection", 5);  // 必须 ≤ 5
```

**去重怎么发生**：Broker 为每个 PID 维护一个"期望的下一个 Sequence Number"。收到 `Seq=N`，若期望值正好是 `N` 就写入、期望值变成 `N+1`；若是重试的重复消息（`Seq < 期望值`），直接丢弃但照样返回成功。Broker 只需为每个 PID 记一个数字，空间开销几乎为零。

**为什么必须配合 `max.in.flight.requests.per.connection ≤ 5`**：幂等允许消息在途重试，靠内部重排序缓冲区维护顺序。超过 5 个在途请求就超出重排能力，去重保证失效。这是性能和正确性的平衡点。

**幂等的边界**：PID 和 Sequence Number 按分区维护，只保证**单分区内**去重。跨分区、跨重启（PID 变化）的重复它管不了。

## 3. 跨分区去重：事务生产者

事务生产者支持跨分区原子写入，配合 `read_committed` 隔离级别实现消费-生产场景的 Exactly Once。详见 [Exactly Once §3](./chapter-04-exactly-once.md#transactions)。

## 4. 消费端去重 {#consumer-dedup}

Kafka 的事务只保证生产端。消费端的去重需要在业务层实现。

### 4.1 幂等处理（推荐） {#idempotent-consumer}

消费端的重复无法靠 Kafka 事务消除——事务只覆盖生产端，消费端重复得靠业务层"重复操作不产生副作用"。三种方案各有机制和边界：

**方案 1：数据库唯一键**

```java
try {
    insertOrder(order);  // INSERT，唯一键冲突则忽略
} catch (DuplicateKeyException e) {
    logger.info("Duplicate message: {}", order.getId());
}
```

机制：靠数据库主键/唯一索引的约束，重复 INSERT 必然撞唯一键冲突，捕获异常即视为"已处理过"。

边界：要求业务实体有天然唯一键（订单号、流水号）。对"累加计数"这类非幂等操作无效——第二次 INSERT 被忽略，但"计数 +1"不会因为唯一键而变成"只加一次"。

**方案 2：Redis SETNX**

```java
Boolean isNew = redisTemplate.opsForValue()
    .setIfAbsent("processed:" + messageId, "1", 24, TimeUnit.HOURS);
if (isNew) {
    processMessage(message);
}
```

机制：`SETNX` 是"不存在才设置"的原子操作，用消息 ID 做 key，设置成功说明这条消息第一次来。

边界：必须设过期时间（如 24 小时），否则死 key 永久占位、内存泄漏；过期时间要大于"最大可能重复窗口"。另外 Redis 与数据库是两套存储，极端情况下 SETNX 成功但业务写库失败，需要自行兜底一致性。

**方案 3：版本号**

```java
// 只处理版本号更高的消息，旧消息直接丢弃
if (msg.getVersion() > currentVersion) {
    apply(msg);
    currentVersion = msg.getVersion();
}
```

机制：业务数据带版本号，消费端比较消息版本与当前版本，旧版本丢弃。防的是"乱序场景下旧消息覆盖新消息"，与 [消息顺序](./chapter-03-message-ordering.md) §3.3 配合使用。

边界：要求业务有版本语义（如乐观锁的 `version` 字段）；只适合"状态更新"类，不适合"事件累加"类。

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
