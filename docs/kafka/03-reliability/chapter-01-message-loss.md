# 消息丢失排查

> 消息从生产者到消费者经过三个环节，每个环节都可能丢数据。本文按环节逐一分析丢消息的原因和解决方案。

## 1. 现象

- 消费者处理的消息数量少于生产者发送的数量
- 下游系统缺少预期的数据
- 监控中发现生产端和消费端的计数不一致

## 2. 三个环节的丢消息场景

> 本节涉及的术语在前置章节有详细解释：[acks 与幂等](../02-core/chapter-05-ack-and-idempotence.md#ack-modes)、[副本与 ISR/OSR](../02-core/chapter-04-replication-and-isr.md#isr)、[Offset](../02-core/chapter-03-consumer-group.md#offset-management) 与 [Rebalance](../02-core/chapter-03-consumer-group.md#rebalance)。

### 2.1 生产者 → Broker

| 场景 | 原因 | 解决方案 |
| :-- | :-- | :-- |
| [acks](../02-core/chapter-05-ack-and-idempotence.md#ack-modes)=0 | 发完即返回，网络丢包无感知 | 改为 acks=all |
| [acks](../02-core/chapter-05-ack-and-idempotence.md#ack-modes)=1 | Leader 写入后返回 ACK，Leader 宕机时 Follower 未同步 | 改为 acks=all |
| 发送异常未处理 | send() 的 Future 被忽略 | 检查回调或 .get() 返回值 |

```java
// 错误：忽略发送结果
producer.send(record);

// 正确：检查发送结果
producer.send(record, (metadata, exception) -> {
    if (exception != null) {
        logger.error("Send failed: {}", exception.getMessage());
    }
});
```

#### 为什么 acks=1 存在丢失窗口

三种 ACK 的完整语义见 [ACK 与幂等 §2](../02-core/chapter-05-ack-and-idempotence.md#ack-modes)，这里只看"丢消息"这一面。`acks=1` 的丢失发生在 Leader 写入后、Follower 同步前的这段时间：

```txt
acks=1 的时序：
Producer → Leader: 写入本地日志（LEO 前进）
Leader   → Producer: 立即返回 ACK
                     （此刻 Follower 还没拉取这条消息）

此刻 Leader 立刻宕机：
Controller 从 ISR 里选一个新 Leader（某个 Follower）
→ 已 ACK 的那条消息不在新 Leader 的日志里
→ 生产者以为"发送成功"，消息实际丢了
```

`acks=1` 的丢失窗口 = Follower 拉取同步的间隔，通常只有毫秒级。所以它在绝大多数时候不丢，唯独"Leader 写入后立刻宕机"这个临界时刻会丢。对账、金融类场景必须用 `acks=all` 关掉这个窗口；日志、埋点类场景可以接受它换来更低的延迟。

`acks=0` 则连这个窗口都没有——发出去就不等确认，网络层丢包生产者毫无感知，属于"能接受丢才用"的模式。

### 2.2 Broker 存储

| 场景 | 原因 | 解决方案 |
| :-- | :-- | :-- |
| 副本因子=1 | 单节点宕机，数据永久丢失 | default.replication.factor=3 |
| [min.insync.replicas](../02-core/chapter-05-ack-and-idempotence.md#min-insync-replicas)=1 | acks=all 但只有一个副本写入 | min.insync.replicas=2 |
| [Unclean Leader 选举](../02-core/chapter-04-replication-and-isr.md#unclean-leader-election) | [OSR](../02-core/chapter-04-replication-and-isr.md#isr) 副本当选，丢失未同步数据 | unclean.leader.election.enable=false |
| 数据保留过期 | 消息被自动删除 | 合理配置 log.retention |

#### 为什么 min.insync.replicas=1 时 acks=all 也会丢

`acks=all` 有一个隐蔽的失效条件，只看"all"三个字会被骗过去。关键在 ISR 收缩：

```txt
正常：ISR = {Leader, F1, F2}，min.insync.replicas=2
F2 掉队（超过 replica.lag.time.max.ms）→ ISR = {Leader, F1}
F1 也掉队 → ISR = {Leader}（收缩到只剩一个副本）

此时 acks=all 写入：
  写入 Leader 本地 → ISR 里只有 Leader 一个
  → 满足"所有 ISR 副本已写入" → 返回 ACK
  → 但这等价于 acks=1：数据只在一个副本上

Leader 宕机 → 消息永久丢失
```

根源：`acks=all` 保证的是"写入所有 **ISR** 副本"，不是"写入所有副本"。ISR 收缩到只剩 Leader 时，`acks=all` 就退化成了单副本写入，而生产者完全不知情。

`min.insync.replicas=2` 是那条硬红线：当 ISR 成员数不足 2，Broker 拒绝 `acks=all` 写入，返回 `NotEnoughReplicasException`——宁可拒写，也不把单副本写入当成可靠写入。ISR 收缩的完整判定机制见 [副本与 ISR §4](../02-core/chapter-04-replication-and-isr.md#isr-definition)。

`unclean.leader.election.enable=false` 防的是另一类丢失：ISR 为空时，若允许 OSR（落后副本）当选 Leader，OSR 里缺失的消息就永久丢了。它和前者的取舍相反——前者是"宁可拒写"，这里是"宁可不可用也不丢数据"，机制见 [副本与 ISR §7](../02-core/chapter-04-replication-and-isr.md#leader-election)。

### 2.3 Broker → 消费者

| 场景 | 原因 | 解决方案 |
| :-- | :-- | :-- |
| 自动提交 [Offset](../02-core/chapter-03-consumer-group.md#offset-management) | 消息处理前 Offset 已提交，宕机后跳过 | enable.auto.commit=false |
| 手动提交时机不对 | 先提交再处理，处理失败时消息丢失 | 处理完再提交 |
| 消费者 [Rebalance](../02-core/chapter-03-consumer-group.md#rebalance) | 分区重新分配，未提交的 Offset 丢失 | Rebalance 监听器 + 手动提交 |

#### 自动提交是怎么把消息"静默丢掉"的

自动提交（`enable.auto.commit=true`）的丢失根源是**提交语义与处理语义错位**。Kafka 的自动提交是定时提交——每隔 `auto.commit.interval.ms`（默认 5 秒）把当前已 poll 到的 offset 提交一次，它只代表"我拉取到了"，不代表"我处理完了"：

```txt
poll() 拉回 offset 100~200
  → 业务开始处理（还没处理完）
  → 定时器触发，offset 被提交到 200
  → 业务处理中宕机

重启后从 offset 200 继续消费
  → 100~200 这条消息没处理完，但永远不会再被拉取
  → 这批消息"静默丢失"，连异常日志都没有
```

手动提交也要警惕时机。正确姿势是**处理完再提交**，而不是先提交再处理：

```java
// ❌ 先提交再处理：提交后处理抛异常，消息丢了
consumer.commitSync();
process(records);

// ✅ 处理完再提交：失败则不提交，重启后重新消费
process(records);
consumer.commitSync();
```

提交时机"提前"就丢消息、"延后"就重复消息，这是一体两面。延后一面的处理见 [消息去重](./chapter-02-message-dedup.md)。

#### Rebalance 把提交时机问题推到分区被夺走的边界

前面的讨论都假设「一个消费者安稳地循环消费」。Rebalance 打破这个假设：Coordinator 会把一个分区从当前消费者手里强行收回、重新分给另一个消费者。收回之前，当前消费者可能刚 `poll()` 回一批消息、正在处理，这批消息的 offset 还没提交——而分区一旦被夺走，它就再也没机会为这个分区提交 offset 了。

如果这时依赖默认行为（自动提交提交的是「已 poll 的位置」，不是「已处理的位置」），新消费者接管后会从「已 poll 的位置」继续，你正在处理的那批消息被直接跳过：

```txt
消费者 A 持有分区 P，poll 到 offset 100~200，正在处理（处理到 150）
Rebalance 触发，分区 P 被收回、分给消费者 B
  → 若提交的是 poll 位置 200（而非已处理的 150）
  → B 从 200 继续消费
  → 150~200 这批已拉取但未处理完的消息，永远不再被处理
  → 静默丢失
```

`ConsumerRebalanceListener` 的 `onPartitionsRevoked` 回调就是为这个边界设计的：分区被收回时，Kafka 会调用这个回调，你在这里把「已处理到的 offset」同步提交一次，新消费者才能从正确位置接手：

```java
Map<TopicPartition, OffsetAndMetadata> offsets = new HashMap<>();

consumer.subscribe(Collections.singletonList("my-topic"), new ConsumerRebalanceListener() {
    @Override
    public void onPartitionsRevoked(Collection<TopicPartition> partitions) {
        // ⭐ 分区被收回前，只提交「已处理完」的分区 offset
        Map<TopicPartition, OffsetAndMetadata> toCommit = new HashMap<>();
        for (TopicPartition tp : partitions) {
            OffsetAndMetadata om = offsets.get(tp);
            if (om != null) toCommit.put(tp, om);
        }
        consumer.commitSync(toCommit);
    }

    @Override
    public void onPartitionsAssigned(Collection<TopicPartition> partitions) {
        // 分区到手时，丢弃已不属于自己的进度
        offsets.keySet().retainAll(consumer.assignment());
    }
});

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, String> r : records) {
        process(r);
        // 每处理完一条，记录「下一条该消费的位置」= 已处理 offset + 1
        offsets.put(new TopicPartition(r.topic(), r.partition()),
                    new OffsetAndMetadata(r.offset() + 1));
    }
}
```

关键点：提交的是「已处理到的 offset + 1」，不是「已 poll 到的位置」。这跟本节前面「处理完再提交、不要先提交再处理」是同一个原则，只是把提交动作从业务循环挪到了「分区被收回」这个确定的边界上——不这么做，Rebalance 就会把在途消息跳过。

Rebalance 的触发与暂停机制见 [消费者组 §4.1](../02-core/chapter-03-consumer-group.md#rebalance-flow)；频繁 Rebalance 的治理（静态成员 `group.instance.id`）见 [同文档 §8](../02-core/chapter-03-consumer-group.md#static-membership)。

## 3. 排查步骤

### Step 1：确认是哪个环节

```bash
# 检查 Broker 侧的消息总量
kafka-run-class.sh kafka.tools.GetOffsetShell \
    --broker-list localhost:9092 --topic my-topic --time -1

# 对比生产者的发送计数
# 对比消费者的消费计数
```

### Step 2：检查生产端配置

```bash
# 检查 Topic 的副本配置
kafka-topics.sh --describe --topic my-topic --bootstrap-server localhost:9092

# 关注：
# - Replication Factor: 应为 3
# - ISR 列表: 应与副本数一致
```

### Step 3：检查消费端配置

```bash
# 查看消费者组的 Offset
kafka-consumer-groups.sh --describe --group my-group --bootstrap-server localhost:9092

# 关注：
# - CURRENT-OFFSET vs LOG-END-OFFSET: Lag 是否异常
# - 是否有分区的 CURRENT-OFFSET 为 -1（未提交）
```

### Step 4：检查 Broker 日志

```bash
grep -E "UncleanLeader|NotEnoughReplicas|DATA_LOSS" /var/kafka-logs/server.log
```

## 4. 防丢配置清单

```properties
# 生产者
acks=all
enable.idempotence=true
retries=Integer.MAX_VALUE
delivery.timeout.ms=120000

# Broker
default.replication.factor=3
min.insync.replicas=2
unclean.leader.election.enable=false

# 消费者
enable.auto.commit=false
isolation.level=read_committed  # 事务场景
```

> 其中 `enable.idempotence` 是幂等生产者开关（见 [幂等生产者](../02-core/chapter-05-ack-and-idempotence.md#idempotent-producer)），`isolation.level=read_committed` 是事务场景的消费隔离级别（见 [事务隔离级别](./chapter-04-exactly-once.md#isolation-level)）。

## 5. 预防

- 上线前用 `kafka-producer-perf-test.sh` 和 `kafka-consumer-perf-test.sh` 做端到端计数对比
- 监控 `UnderReplicatedPartitions` 和 `UnderMinIsrPartitionCount`
- 消费者实现[幂等处理](./chapter-02-message-dedup.md#idempotent-consumer)，即使重复消费也不产生副作用
