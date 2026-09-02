# 副本机制

> Kafka 的可用性与持久性靠副本。本章讲清 Leader/Follower/ISR 三者如何协同，追到 `ReplicaManager` / `Partition` / `ReplicaFetcherThread` 的调用链，并解释「为什么必须用 Leader Epoch 而不能靠 HW 做截断」这一条历史遗留下的核心机制。

## 1. 角色与关键偏移量

一个分区在集群里表现为一组副本（Replica）。副本分布在不同 Broker 上，其中一个是 Leader，其余是 Follower：

| 角色 | 职责 |
| :-- | :-- |
| Leader | 处理该分区所有 Produce/Consume 请求，维护 HW 与 ISR |
| Follower | 用同一套 FetchRequest 协议持续从 Leader 拉数据、写入本地日志 |
| Preferred replica | 副本列表的第一个成员，均衡时优先重新当选 Leader |
| ISR | In-Sync Replicas：与 Leader 同步的副本集合（包含 Leader 自身） |

副本状态由每个 Broker 上的 `Partition` 对象维护，字段包括 `leaderReplicaIdOpt` / `inSyncReplicas` / `leaderEpoch` / `allReplicasMap`。所有分区共同管理在 `ReplicaManager` 的 `allPartitions` 池里。

来源：[apache/kafka `Partition.scala`](https://github.com/apache/kafka/blob/trunk/core/src/main/scala/kafka/cluster/Partition.scala)、[`ReplicaManager.scala`](https://github.com/apache/kafka/blob/trunk/core/src/main/scala/kafka/server/ReplicaManager.scala)、[DeepWiki: Replication and Partition Management](https://deepwiki.com/apache/kafka/2.3-log-management)

每个副本都维护两个偏移量：

| 概念 | 含义 |
| :-- | :-- |
| LEO（Log End Offset） | 本地日志末尾的下一个待写入 offset |
| HW（High Watermark） | 该分区当前对消费者可见的最大 offset + 1 |

Leader 侧的 HW 由 `Partition#maybeIncrementLeaderHW` 计算：

```text
Leader HW = min(所有 ISR 成员的 LEO)
```

Follower 侧的 HW 由 Fetch 响应带回：

```text
Follower HW = min(本地 LEO, FetchResponse.hw)
```

消费者只能读到 HW 之前的记录——低于 HW 意味着已经在全部 ISR 上落盘，即使 Leader 立刻故障，切换到 ISR 内任意副本仍能读到这条消息。

## 2. Follower 同步的调用链

Follower Broker 通过 `ReplicaFetcherManager` 为每个 Leader Broker 维护若干条 `ReplicaFetcherThread`（线程数由 `num.replica.fetchers` 决定，默认 1）。线程数不是每分区一条，而是「每个远端 Leader Broker 一组」，同 Broker 的多个分区被哈希到组内。

`ReplicaFetcherThread` 继承自 `AbstractFetcherThread`，主循环极简：

```scala
// core/src/main/scala/kafka/server/AbstractFetcherThread.scala
override def doWork(): Unit = {
  maybeTruncate()   // §3：处理 leader epoch 分歧，做精确截断
  maybeFetch()      // 拼 FetchRequest → 发送 → 处理响应
}
```

`maybeFetch` 拼请求时会带上 `replicaId`——Leader 借此判断请求来源是 Follower 还是 Consumer，前者会触发 ISR/HW 更新，后者只做数据读。响应回到 Follower 后走 `processPartitionData`：追加到本地 `UnifiedLog`、更新 LEO、按响应中的 leader HW 推进本地 HW。

Leader 侧的追加与响应发生在 `ReplicaManager#appendRecords` → `Partition#appendRecordsToLeader` → `UnifiedLog#appendAsLeader`。对 `acks=all` 的 Produce，请求不会立刻返回——`ReplicaManager` 把它挂进 `DelayedProducePurgatory`，等 HW 追上该请求的 offset 后再唤醒返回响应。

时序：

```text
Producer            Leader                Follower A         Follower B
  │ ProduceReq acks=all │
  ├────────────────────▶│  appendAsLeader → LEO 前进
  │                     │  挂 DelayedProduce
  │                     │◀── Fetch(replicaId=A) ── │
  │                     │                          │
  │                     │◀── Fetch(replicaId=B) ─────────────── │
  │                     │  两个 Follower 上报 LEO
  │                     │  min(ISR.LEO) 越过目标 → HW 前进
  │                     │  唤醒 DelayedProduce
  │◀── ProduceResp OK ──│
```

来源：[Factory Kafka wiki: Replication](https://factory.ai/open-source-wikis/kafka?page=features%2Freplication.md)、[Matt's Blog: 副本同步机制实现](https://matt33.com/2018/04/29/kafka-replica-fetcher-thread/)

## 3. Leader Epoch：为什么不能只靠 HW 做截断

Follower 切换 Leader 时需要把本地日志「回退到与新 Leader 一致的位置」。早期做法是「截断到本地 HW」——听起来合理，但存在 KIP-101 明确指出的数据丢失场景：

```text
时刻 T1: Leader L 写入 offset=100，ISR = {L, F}
        L 已把 HW 推到 100 之前的某个位置（因 F 还没 ack）
时刻 T2: F 在 fetch 到 100 之前，F 侧记录 HW=99
时刻 T3: L 宕机；F 当选 Leader
时刻 T4: L 恢复，切成 Follower；按"截断到本地 HW=99" 的旧规则，
        它会保留自己已写的 offset=100
        而 F 作为新 Leader 从未见过 offset=100
        → 两侧日志分叉
```

KIP-101 引入 **Leader Epoch**：每次 Leader 换届，Controller 分配一个单调递增的 epoch，写入 Broker 本地的 `LeaderEpochFileCache`（对应 `leader-epoch-checkpoint` 文件），每条 RecordBatch 头部的 `partitionLeaderEpoch` 字段（见 [日志分段与索引](./chapter-01-log-segment.md) §2）也会被 Broker 打上当时的 epoch。

新的截断协议在 `ReplicaFetcherThread#maybeTruncate` 中：

```text
1. Follower 向新 Leader 发 OffsetForLeaderEpochRequest(followerLastEpoch)
2. Leader 查自己的 LeaderEpochFileCache，返回:
      - 若 followerLastEpoch 在 Leader 侧存在，返回该 epoch 的 endOffset
      - 否则返回 Leader 侧首个更早 epoch 的 endOffset
3. Follower 把本地日志截断到 min(该 endOffset, 本地 LEO)
4. 从截断点开始正常 Fetch
```

关键在于第 2 步 Leader 用 epoch 精确定位「两条日志的公共前缀在哪里」，不再依赖 HW 这个可能过时的值。

来源：[KIP-101](https://cwiki.apache.org/confluence/display/KAFKA/KIP-101+-+Alter+Replication+Protocol+to+use+Leader+Epoch+rather+than+High+Watermark+for+Truncation)、[`LeaderEpochFileCache.java`](https://github.com/apache/kafka/tree/trunk/storage/src/main/java/org/apache/kafka/storage/internals/log/epoch)

## 4. ISR 的进出与传播

### 4.1 何时移出

Leader 侧有一个 ISR 过期检查任务（`ReplicaManager#maybeShrinkIsr`，周期 = `replica.lag.time.max.ms`）。任一 Follower 满足下列条件之一，即被移出 ISR：

- 超过 `replica.lag.time.max.ms` 没发过 Fetch。
- 有 Fetch 但 `fetchOffset < LeaderLEO` 且距离上次追上 LeaderLEO 已超时。

`replica.lag.time.max.ms` 默认自 Kafka 2.5 起改为 30000（30 秒），此前长期为 10000（KIP-537）。这一参数不宜盲目下调——GC 停顿、网络抖动都可能把它触发出 spurious shrink，把 ISR 反复抖动造成 acks=all 的产生阻塞。

来源：[Kafka 3.0 配置文档](https://kafka.apache.org/30/configuration/) `replica.lag.time.max.ms`、[Configuring Apache Kafka for High-Load Systems](https://dev.to/deadlovelll/configuring-apache-kafka-for-high-load-systems-42e3)

### 4.2 何时加回

Follower 的 `fetchOffset` 追上 Leader 当前 LEO 后立即被加回 ISR。**不需要**先追到 Leader HW——Leader 侧的判定条件是 `follower.LEO >= leader.LEO`。

### 4.3 变更如何全局生效

在 KRaft 与 KIP-497（AlterPartition）之后，ISR 变更的传播路径是：

```text
Leader（发起端）
   │  AlterPartitionRequest（含新 ISR、新 leader epoch）
   ▼
Controller（唯一权威）
   │  校验后写入元数据日志 PartitionChangeRecord
   ▼
所有 Broker
   │  MetadataLoader 消费到该记录
   ▼
每个 Broker 上的 Partition 对象更新本地视图
```

Controller 是 ISR 的唯一真实来源。之所以要绕这一圈，是为了让 ISR 状态在 Leader 换届过程中也保持全局一致：不同 Broker 上永远不会同时看到「旧 Leader 的旧 ISR」与「新 Leader 的新 ISR」。

来源：[KIP-497 AlterIsr → AlterPartition](https://cwiki.apache.org/confluence/display/KAFKA/KIP-497%3A+Add+inter-broker+API+to+alter+ISR)、[Factory Kafka wiki: Replication](https://factory.ai/open-source-wikis/kafka?page=features%2Freplication.md)

## 5. Leader 选举

正常选举由 Controller 主导（在 KRaft 里就是 `ReplicationControlManager`）：Leader 所在 Broker 被判定失联后，Controller 从当前 ISR 里选第一个成员作为新 Leader，写一条 `PartitionChangeRecord` 带上 bumped leader epoch。

### 5.1 Unclean Leader Election

当 ISR 缩到空（所有同步副本都失联），是否从非 ISR 副本里选 Leader，由 `unclean.leader.election.enable` 决定：

| 值 | 含义 | 版本默认 |
| :-- | :-- | :-- |
| `false` | ISR 空时分区不可用，等原 ISR 成员恢复 | Kafka 0.11 起默认 |
| `true` | 从非 ISR 中选，接受数据丢失换取可用性 | 早于 0.11 |

打开时必须监控 `UncleanLeaderElectionsPerSec`——每一次触发就意味着一次真实的数据丢失。

来源：[Kafka 3.0 配置](https://kafka.apache.org/30/configuration/) `unclean.leader.election.enable`

### 5.2 Eligible Leader Replicas（KIP-966）

新引入的 ELR 概念：曾在 ISR 中、但当前离线的副本仍作为候选保存在元数据里，跨 Controller 换届也保留。这让「受控关机 → 重启」的副本能在不启用 Unclean 的前提下重新当选，缓解「ISR 只剩一个 Leader 时的可用性 vs 持久性冲突」。启用需要显式抬升 `eligible.leader.replicas.version` feature level。当前不是所有版本默认启用，用之前先查发行版说明。

来源：[KIP-966 Eligible Leader Replicas](https://cwiki.apache.org/confluence/display/KAFKA/KIP-966%3A+Eligible+Leader+Replicas)

### 5.3 Preferred Leader 均衡

副本列表首位称为 preferred replica。集群运行久了 Leader 会漂移，`auto.leader.rebalance.enable=true`（默认）时 Controller 会周期性检查每个 Broker 的 Leader 占比，若超出 `leader.imbalance.per.broker.percentage`（默认 10%）就触发 preferred election 把 Leader 迁回首位副本。

## 6. 副本选择与读优化

### 6.1 分配

`kafka-topics.sh --create` 时 Controller 会按下列规则分配副本：

- 同一分区的 N 个副本落在 N 个不同 Broker 上。
- 分区 Leader 尽可能在 Broker 间均衡。
- 若各 Broker 配置了 `broker.rack`，则同分区副本尽量落到不同 rack（rack awareness）。

### 6.2 KIP-392 Follower Fetching

Kafka 2.4 起，消费者可以从 Follower 而不是 Leader 读，用于降低跨可用区流量。开启方式：Broker 侧 `replica.selector.class=org.apache.kafka.common.replica.RackAwareReplicaSelector`；Consumer 侧配 `client.rack`，`ReplicaSelector` 会挑选同 rack 的 ISR 成员响应 fetch。写入路径不受影响，仍走 Leader。

来源：[KIP-392](https://cwiki.apache.org/confluence/display/KAFKA/KIP-392%3A+Allow+consumers+to+fetch+from+closest+replica)

## 7. 关键配置与推荐

| 参数 | 版本默认 | 生产建议 | 备注 |
| :-- | :-- | :-- | :-- |
| `default.replication.factor` | 1 | 3 | Broker 级默认，Topic 可覆盖 |
| `min.insync.replicas` | 1 | 2 | 配合 `acks=all` 才有意义 |
| `unclean.leader.election.enable` | false（0.11+） | 保持 false | 除非可用性优先且能容忍丢数据 |
| `replica.lag.time.max.ms` | 30000（2.5+，此前 10000） | 保持默认 | 调小易触发 spurious shrink |
| `num.replica.fetchers` | 1 | 2–4（磁盘/网卡富余时） | 提升 Follower 并行度 |
| `auto.leader.rebalance.enable` | true | true | 保持默认 |
| `transaction.state.log.replication.factor` | 3 | 3 | 内部事务 topic |
| `transaction.state.log.min.isr` | 2 | 2 | 内部事务 topic |
| `offsets.topic.replication.factor` | 3 | 3 | 内部 offsets topic |

Producer 端配合的 `acks` 语义与 `min.insync.replicas` 的交互见 [ACK 机制与可靠性保证](../05-reliability/chapter-01-acks.md)。

## 8. 常态监控指标

副本相关的核心 JMX：

| 指标 | 含义 | 期望 |
| :-- | :-- | :-- |
| `kafka.server:type=ReplicaManager,name=UnderReplicatedPartitions` | 当前 ISR 少于 RF 的分区数 | 稳态应为 0 |
| `kafka.server:type=ReplicaManager,name=UnderMinIsrPartitionCount` | ISR 少于 `min.insync.replicas` 的分区数 | 应为 0；大于 0 表示 acks=all 已开始拒写 |
| `kafka.server:type=ReplicaManager,name=IsrShrinksPerSec` / `IsrExpandsPerSec` | ISR 收缩 / 扩张频率 | 稳态应接近 0，频繁抖动说明 `replica.lag.time.max.ms` 与实际不匹配 |
| `kafka.controller:type=ControllerStats,name=UncleanLeaderElectionsPerSec` | Unclean 选举触发次数 | 应为 0 |
| `kafka.server:type=FetcherLagMetrics,name=ConsumerLag,clientId=Replica,...` | Follower 拉取滞后条数 | 稳态应接近 0 |

## 9. 一句话小结

- HW = min(所有 ISR 成员的 LEO)；消费者只能读到 HW 之前的记录。
- Follower 通过 `ReplicaFetcherThread` 用同一份 FetchRequest 协议从 Leader 拉数据；`acks=all` 通过 `DelayedProduce` 等 HW 追上目标 offset 后再返回。
- 截断靠 Leader Epoch（KIP-101），不再靠 HW——这是修复 in-flight 场景下数据分叉 bug 的关键。
- ISR 变更由 Leader 发 AlterPartition 给 Controller，Controller 是唯一真实来源。
- 生产上守住 `min.insync.replicas=2` + `unclean.leader.election.enable=false` 这两条硬红线。
