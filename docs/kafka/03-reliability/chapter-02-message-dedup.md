# 消息去重

> 消息重复是 Kafka 的常态——acks=all + 重试保证不丢，但可能重复。本文讲清重复的来源和去重方案。

## 1. 重复的来源

| 环节 | 原因 | 说明 |
| :-- | :-- | :-- |
| 生产者 | 网络超时重试 | Broker 已写入，但 ACK 丢失，生产者重试 → 重复 |
| 消费者 | Offset 提交失败 | 处理完消息后、提交 Offset 前宕机，重启后重复消费 |
| 消费者 | Rebalance | 分区重新分配，未提交的 Offset 导致重复 |

表格里的三类原因背后是同一个机制：**At Least Once 允许重复**。选择 `acks=all` + 重试是为了"不丢"，但 `acks=all` 本身不会造成重复，重复只在结果不确定的重试、或消费端因 Offset 未提交而重新处理时才发生。下面两条时序说明重复到底是怎么产生的。

**生产端：ACK 丢失后的重试**

```txt
Producer → Broker: 写入 msg（成功，Broker 已落盘）
Broker   → Producer: 返回 ACK
                     （ACK 在网络中丢失）
Producer: 没等到 ACK → 判定超时 → 重发 msg
Broker:   第二次写入 msg
→ 同一条消息在 Broker 里出现两份
```

关键点：Broker 已经写成功了，只是 ACK 没送达。生产者无法区分"没写进去"和"写进去了但 ACK 丢了"，只能重试。这是未启用幂等生产者（或重试超出幂等去重能力）时的情况，幂等生产者解决的正是这条链路。

**消费端：提交前宕机**

```txt
poll() 拉回 offset 100~200
  → 处理完 offset 100~150 的消息
  → 提交 offset 151 之前宕机（本批处理结果未提交）
重启后从上次提交的 offset 100 继续
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

**去重怎么发生**：Broker 为每个生产者的每个分区维护一个"期望的下一个 Sequence Number"。收到某分区的 `Seq=N`，若期望值正好是 `N` 就写入、期望值变成 `N+1`；若是重试的重复消息（`Seq < 期望值`），直接丢弃但照样返回成功。Broker 只需为每个分区记一个数字，空间开销几乎为零。

**为什么必须配合 `max.in.flight.requests.per.connection ≤ 5`**：这是幂等生产者的配置约束，不是运行时的兜底——启用幂等后若该值超过 5，客户端会在初始化时直接报 `ConfigException`。上限 5 是 KIP-98 在"允许在途重试"与"保证单分区顺序"之间取的折中：在途请求越少，重试时乱序的可能越小，但吞吐越低。

**幂等的边界**：PID 和 Sequence Number 按分区维护，只保证**同一生产者会话内、单分区内**的重试去重。它不提供跨分区去重，也不提供跨生产者会话的业务级去重——PID 变化后，旧会话的重试无法靠新 PID 的序列号识别。这不等于"每次重启必然重复"，只是说幂等去重不覆盖重启后的新会话。

## 3. 跨分区去重：事务生产者

事务生产者支持跨分区原子写入，配合 `read_committed` 隔离级别实现消费-生产场景的 Exactly Once。详见 [Exactly Once §3](./chapter-04-exactly-once.md#transactions)。

## 4. 消费端去重 {#consumer-dedup}

Kafka 事务能把消费 Offset 与输出消息原子提交（见 §4.2），解决 Kafka → Kafka 场景的重复，但管不了外部业务副作用——消费后调用外部接口、写外部库这类副作用，仍要靠业务层幂等兜底。

### 4.1 幂等处理（推荐） {#idempotent-consumer}

消费端的重复无法靠 Kafka 事务消除——事务能原子提交消费 Offset 与输出消息，但管不了"重复操作产生副作用"（如重复调用外部接口），这类重复得靠业务层幂等。三种方案各有机制和边界：

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

边界：必须设过期时间（如 24 小时），否则死 key 永久占位、内存泄漏；过期时间要大于"最大可能重复窗口"。更关键的是，`SETNX` 成功只代表"去重标记已写入"，不代表业务处理成功——若标记写入后 `processMessage` 失败或进程宕机，重试会被已存在的标记拦截，这条消息就永远漏处理了。要么让去重标记与业务写入在同一事务中原子提交，要么设计失败后的标记清理或补偿机制。Redis 与数据库是两套存储，一致性问题无法靠单次 `SETNX` 兜底。

**方案 3：版本号**

```java
// 只处理版本号更高的消息，旧消息直接丢弃
if (msg.getVersion() > currentVersion) {
    apply(msg);
    currentVersion = msg.getVersion();
}
```

机制：业务数据带版本号，消费端比较消息版本与当前版本，旧版本丢弃。防的是"乱序场景下旧消息覆盖新消息"，与 [消息顺序](./chapter-03-message-ordering.md) §3.3 配合使用。

边界：要求业务有版本语义（如乐观锁的 `version` 字段）；只适合"状态更新"类，不适合"事件累加"类。示例里"比较 → 更新 → 推进版本"三步在并发下不是原子的，多个线程可能同时读到同一 `currentVersion` 而重复执行。必须交给数据库条件更新（`UPDATE ... WHERE version = ?`）或乐观锁，让比较与推进在同一原子操作内完成。

### 4.2 事务消费（Kafka → Kafka）

```java
// 消费者必须关闭自动提交，Offset 改由事务统一提交
props.put("enable.auto.commit", "false");

producer.initTransactions();
while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    producer.beginTransaction();
    try {
        for (ConsumerRecord<String, String> record : records) {
            producer.send(new ProducerRecord<>("output-topic", record.key(), process(record)));
        }
        // 假定本批记录均已成功处理，对每个分区提交"最后一条消息的 Offset + 1"
        Map<TopicPartition, OffsetAndMetadata> offsets = new HashMap<>();
        for (TopicPartition tp : records.partitions()) {
            List<ConsumerRecord<String, String>> part = records.records(tp);
            offsets.put(tp, new OffsetAndMetadata(part.get(part.size() - 1).offset() + 1));
        }
        producer.sendOffsetsToTransaction(offsets, consumer.groupMetadata());
        producer.commitTransaction();
    } catch (ProducerFencedException e) {
        // 生产者被 fencing：进入不可恢复状态，应退出并重建实例，不能盲目重试
        producer.close();
        throw e;
    } catch (Exception e) {
        // 事务内失败：中止事务，本批输出消息与 Offset 都不会提交。
        // abortTransaction() 自身也可能失败，且并非所有异常都可恢复——生产环境需区分可重试失败与致命错误，不能一律 abort 后继续循环
        producer.abortTransaction();
    }
}
```

示例省略了消费者组 Rebalance、关闭资源与重试策略等生产环境处理。`enable.auto.commit=false`、Offsets 的构造方式与 fencing 异常的处理是事务消费能成立的前提，缺了它们就只是演示代码而非可用的 Exactly Once 实现。

## 5. 去重方案选型

| 场景 | 方案 | 说明 |
| :-- | :-- | :-- |
| 生产端重复 | 幂等生产者 | 零成本，直接开启 |
| Kafka → Kafka 消费端 | 事务 | 完整的 Exactly Once |
| Kafka → 外部系统 | 业务层幂等 | 唯一键 / SETNX / 版本号 |

> 大多数业务用 At Least Once + 业务层幂等就够了。Kafka 事务适合需要原子提交 Kafka 输出消息与消费 Offset 的场景；涉及外部系统时，应依据目标系统的事务能力、幂等接口与失败恢复机制设计一致性方案，而不是按数据流是否跨 Kafka Topic 直接决定是否需要 Exactly Once。
