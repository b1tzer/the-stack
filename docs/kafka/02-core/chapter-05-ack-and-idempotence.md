# ACK 与幂等

> ACK 回答的问题是"生产者怎么确认消息写成功了"。但"写成功"本身就是一个模糊的概念——写入 Leader 算成功？写入所有副本算成功？不同的答案对应不同的可靠性级别和吞吐代价。幂等回答的是另一个问题：重试导致的重复消息怎么消除？

## 1. "写成功"到底是什么意思

生产者发送一条消息到 Broker，Broker 返回"成功"。但这个"成功"到底意味着什么？

**场景一**：消息写入了 Leader 的内存缓冲区，还没落盘。Leader 宕机，消息丢失。这算"成功"吗？

**场景二**：消息写入了 Leader 的磁盘，但 Follower 还没同步。Leader 宕机，Follower 当选新 Leader，消息丢失。这算"成功"吗？

**场景三**：消息写入了 Leader 和所有 Follower 的磁盘。Leader 宕机，消息还在。这才是真正的"成功"。

三种场景对应三种 ACK 模式。Kafka 把选择权交给了你——你可以根据业务对可靠性的要求，选择愿意付出多少代价。

## 2. 三种 ACK 模式 {#ack-modes}

### acks=0：发完即忘

```txt
Producer → Broker：发出去就不管了，不等任何确认
```

生产者连 Broker 有没有收到都不关心。网络丢包、Broker 宕机——生产者完全不知道。

代价：吞吐最高（没有任何等待），但消息可能无声无息地丢失。

适用场景：监控指标、日志收集——丢几条不影响业务。

### acks=1：Leader 确认

```txt
Producer → Leader：写入本地日志
Leader → Producer：返回 ACK
（此时 Follower 还没同步。如果 Leader 宕机 → 消息丢失）
```

Leader 写入自己的日志后就返回确认。此时 Follower 可能还没来得及同步。如果 Leader 立刻宕机，Follower 当选新 Leader，这条消息就丢了。

这个"丢失窗口"有多大？取决于 Follower 同步的延迟——通常是毫秒级。所以在大多数情况下 acks=1 不会丢消息，但在极端情况下（Leader 写入后立刻宕机）存在丢消息的可能。

### acks=all：所有 ISR 确认

```txt
Producer → Leader：写入本地日志
Leader → Follower A：Fetch 同步
Leader → Follower B：Fetch 同步
（所有 ISR 副本确认后）
Leader → Producer：返回 ACK
```

消息写入所有 ISR 副本后才返回确认。只要 ISR 中至少有一个副本存活，消息就不会丢。

代价：吞吐最低（必须等最慢的 Follower），但可靠性最高。

### 为什么 acks=all 还需要 min.insync.replicas

`acks=all` 保证消息写入所有 ISR 副本。但如果 ISR 只剩 Leader 一个呢？`acks=all` 退化成了 `acks=1`——只写一个副本就返回确认。

`min.insync.replicas=2` 保证 ISR 中至少有 2 个副本。如果 ISR 收缩到只剩 Leader，Broker 会拒绝 `acks=all` 的写入，返回 `NotEnoughReplicasException`。这是一条硬红线：**宁可拒绝写入，也不允许单副本写入被当作"可靠写入"**。

## 3. 幂等生产者：重试导致的重复

`acks=all` 消除了"丢消息"的问题，但引入了"重复消息"的问题。

```txt
Producer 发送 msg → Broker 写入成功 → 返回 ACK
但 ACK 在网络上丢了
Producer 没收到 ACK，认为失败 → 重试
Broker 写入第二次 → 消息重复
```

重试是保证"不丢"的必要手段，但副作用是"可能重复"。

幂等生产者通过 **PID + Sequence Number** 解决这个问题：

```txt
Producer 启动 → Broker 分配一个唯一的 PID（Producer ID）
每条消息附带 (PID, Sequence Number)
  msg1: (PID=1, Seq=0)
  msg2: (PID=1, Seq=1)
  msg3: (PID=1, Seq=2)

Broker 侧维护：每个 PID 的期望 Sequence Number

收到 (PID=1, Seq=2)：
  期望 Seq=2 → 匹配 → 写入，期望变为 3
收到 (PID=1, Seq=2)：（重试的重复消息）
  期望 Seq=3 → 不匹配 → 丢弃，返回成功
```

关键设计：Broker 不需要保存所有已处理消息的 ID，只需要为每个 PID 保存一个"期望的下一个 Sequence Number"。空间开销极小，但能精确去重。

开启幂等只需 `enable.idempotence=true`，PID 与 Sequence Number 由 Kafka 自动维护：

```java
props.put("enable.idempotence", true);
```

Spring Boot 配置：

```properties
spring.kafka.producer.properties.enable.idempotence=true
```

### 为什么 max.in.flight.requests.per.connection 限制在 5

幂等生产者允许多个请求同时在途（`max.in.flight.requests.per.connection > 1`），但有乱序风险：

```txt
发送 msg1(Seq=0) → 失败（重试中）
发送 msg2(Seq=1) → 成功
发送 msg3(Seq=2) → 成功
msg1 重试成功

Broker 收到的顺序：Seq=1, Seq=2, Seq=0
```

Kafka 内部维护了一个重排序缓冲区，能对最多 5 个在途请求进行重排序。超过 5 个就无法保证去重。这个数字是性能和正确性的平衡点。

## 4. 事务：跨分区的 Exactly Once

幂等生产者只能保证**单分区**内的去重。如果你需要"写入 Topic A 和 Topic B 要么都成功要么都失败"——这就是事务的场景。

事务的核心是 **Transaction Coordinator**：

```txt
Producer → Coordinator: initTransactions() → 分配 PID + Epoch
Producer → Coordinator: beginTransaction()
Producer → Broker: send(topic1, msg1)  ← 消息写入，但对消费者不可见
Producer → Broker: send(topic2, msg2)
Producer → Coordinator: commitTransaction()
Coordinator → __transaction_state: 写入 COMMIT 标记
Consumer（read_committed）: 看到 COMMIT 标记后，msg1 和 msg2 才可见
```

**为什么需要 Epoch**：旧 Producer 实例因网络分区"失联"，你用同一个 `transactional.id` 起了新实例。新实例的 Epoch 递增。旧实例"复活"后发请求，Epoch 对不上，被拒绝。没有 Epoch，旧实例就能继续往事务里写数据，污染新实例的状态。

**为什么 Coordinator 必须固定**：`transactional.id` 哈希到 `__transaction_state` 的某个分区，该分区的 Leader 就是 Coordinator。哈希保证同一个事务的所有请求始终路由到同一个 Coordinator，状态天然集中。

## 5. 消费-生产 Exactly Once

最常见的 Exactly Once 场景：消费 Topic A → 处理 → 写入 Topic B，同时提交 Offset。

```java
producer.initTransactions();   // ⭐ 只执行一次：向 Transaction Coordinator 注册，获取 PID + Epoch
while (true) {
    ConsumerRecords records = consumer.poll(Duration.ofMillis(100));  // ① 从输入 Topic 拉取一批消息
    producer.beginTransaction();  // ② 开启一个新事务
    for (ConsumerRecord record : records) {
        // ③ 逐条处理并写入输出 Topic；此刻消息带「未提交」标记，下游 read_committed 消费者不可见
        producer.send(new ProducerRecord<>("output-topic", process(record)));
    }
    // ④ 把「本批消费到的 Offset」也登记进当前事务，交给 Coordinator 一并提交
    producer.sendOffsetsToTransaction(offsets, consumer.groupMetadata());
    producer.commitTransaction();  // ⑤ 提交：输出消息与 Offset 同时生效
}
```

输出 Topic 的消息和输入 Topic 的 Offset 在同一个事务中原子提交——要么都成功，要么都回滚。消费者重启后从提交的 Offset 继续，不会重复处理。

## 6. 消费端去重

Kafka 的事务只保证生产端。消费端的重复无法靠 Kafka 消除——它的来源是"处理完消息但还没提交 Offset 就宕机"或 Rebalance，重启后同一批消息会被重新消费。所以消费端去重只能靠业务层，让"重复处理"不产生副作用。

| 方案 | 原理 | 核心边界 |
| :-- | :-- | :-- |
| 数据库唯一键 | 靠主键/唯一索引兜底，重复 INSERT 撞唯一键冲突即视为已处理 | 要求业务实体有天然唯一键（订单号、流水号）；对"累加计数"这类非幂等操作无效 |
| Redis SETNX | `SETNX` 是"不存在才设置"的原子操作，用消息 ID 做 key，设置成功才算第一次来 | 必须设过期时间，否则死 key 永久占位；Redis 与数据库是两套存储，需自行兜底一致性 |
| 版本号 | 业务数据带版本号，只处理版本号更高的消息，旧版本丢弃 | 要求业务有版本语义；只适合"状态更新"，不适合"事件累加" |

详见 [消息去重](../03-reliability/chapter-02-message-dedup.md)。

## 7. 配置清单

```java
// 生产者：可靠性优先
props.put("acks", "all");                              // 所有 ISR 副本确认后才返回成功，不丢消息
props.put("enable.idempotence", true);                 // 开启幂等，重试不产生重复消息
props.put("retries", Integer.MAX_VALUE);               // 网络异常时无限重试，实际时长由 delivery.timeout.ms 封顶
props.put("delivery.timeout.ms", 120000);              // 单条消息发送总超时 120 秒，超时放弃并回调异常
props.put("max.in.flight.requests.per.connection", 5); // 幂等在途请求上限，保证乱序可重排去重
```

```properties
# Broker：配合生产者
min.insync.replicas=2                # ISR 至少 2 个副本，防止 acks=all 退化为单副本写入
unclean.leader.election.enable=false # 禁止落后副本当选 Leader，杜绝已确认消息丢失
default.replication.factor=3         # 新建 Topic 默认 3 副本
```

## 8. 一句话总结

- 三种 ACK 模式是可靠性与吞吐的权衡——acks=all 是最可靠的选择，但需要付出等待副本同步的代价。
- 幂等通过 PID + Sequence Number 消除重试导致的重复，代价几乎为零。
- 事务通过 Transaction Coordinator 实现跨分区原子写入，适用于消费-生产 Exactly Once 场景。
- 大多数场景用 At Least Once + 幂等消费就够了，只有 Kafka → Kafka 的流处理才需要完整事务。
