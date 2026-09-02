# Controller

> Controller 是 Kafka 集群里唯一有权变更元数据的角色。本章讲清 Controller 做什么、它如何与 Broker 通信、以及为什么从 ZooKeeper 时代的"单实例"变成 KRaft 时代的"Raft quorum"是一次架构级重构，而不只是换个存储。KRaft 的深入内容留给 [KRaft](./chapter-05-kraft.md)。

## 1. Controller 的职责

无论 ZooKeeper 模式还是 KRaft 模式，Controller 都是集群里唯一被授权做以下事情的角色：

| 职责 | 具体行为 |
| :-- | :-- |
| Broker 生死判定 | 收心跳 → 决定谁在线 → 触发下游动作 |
| 分区 Leader 选举 | Leader 失联时从 ISR 选新 Leader，bump `leaderEpoch` |
| ISR 变更 | 接受 Leader 的 `AlterPartitionRequest`，落盘并广播 |
| Topic 生命周期 | 创建、删除、分区扩容、副本重分配 |
| 元数据广播 | 让所有 Broker 感知到上述变更 |
| Preferred Leader 均衡 | 定期把 Leader 迁回 preferred replica |

其他 Broker 只是元数据的**观察者**：本地缓存一份，处理 Produce/Fetch/Metadata 请求。任何要写元数据的动作都要走 Controller。

## 2. ZooKeeper 模式的 Controller

在 2.8 之前，Kafka 的元数据存储外挂在 ZooKeeper：

```text
znode 结构：
/brokers/ids/<id>            ← 每个 Broker 一个临时节点
/brokers/topics/<topic>      ← Topic 元数据（分区/副本分配）
/brokers/topics/<topic>/partitions/<n>/state ← Leader、ISR
/controller                  ← 当前 Controller 的临时节点
/controller_epoch            ← 控制器代次
/admin/reassign_partitions   ← 触发重分配
```

### 2.1 选举方式

启动时每个 Broker 都尝试在 ZK 上创建 `/controller` 临时节点。谁先建成，谁就是 Controller，其余 Broker 在 `/controller` 上加一个 Watch。原 Controller 崩溃 → 临时节点消失 → 所有 Broker 收到通知重新竞争。选举本身很轻，代价在下一步。

### 2.2 新 Controller 上任的代价

新 Controller 需要"重建集群状态"：从 ZK 递归读取所有 topic、partition、replica 元数据 → 写入本地内存 `ControllerContext` → 逐个通知 Broker。这一步的成本随分区数线性增长。Confluent 官方基准：Kafka 1.1 在 200,000 分区规模下故障切换耗时约 14 秒，且随分区数近似线性增长（[Confluent KRaft Overview](https://docs.confluent.io/platform/7.7/kafka-metadata/kraft.html)）。

这就是 ZK 时代广泛引用的「单集群约 200,000 分区上限」的机制来源——不是 Kafka 本身处理不了更多分区，而是 Controller 故障切换时间在这个规模上已经无法接受。

### 2.3 Broker → Controller 的通知路径

ZK 模式下，Controller 向 Broker 广播元数据不是通过 topic，而是通过三种 RPC：

| RPC | 用途 |
| :-- | :-- |
| `LeaderAndIsrRequest` | 通知某分区的新 Leader / ISR |
| `UpdateMetadataRequest` | 通知集群 metadata 变更 |
| `StopReplicaRequest` | 通知某分区副本从本机移除 |

Broker 只有收到 `LeaderAndIsrRequest` 才会为对应分区启动 `ReplicaFetcherThread` 或成为 Leader。ZK 里的 znode 只是 Controller 的"账本"，Broker 不直接读 ZK 拿元数据。

来源：[apache/kafka `KafkaController.scala`](https://github.com/apache/kafka/blob/trunk/core/src/main/scala/kafka/controller/KafkaController.scala)、[DeepWiki: Replication and Partition Management](https://deepwiki.com/apache/kafka/2.3-log-management)

### 2.4 ZK 模式的两条固有问题

- **单点计算**：Controller 由一个 Broker 兼任，元数据的一切写入都排队在这个进程内。它的 CPU、GC、IO 都会直接影响集群变更速度。
- **状态不在 Kafka 里**：一份权威元数据在 ZK，一份运行时缓存在 Broker，两者靠 Watch 与 RPC 追齐。理论上可能出现"Kafka 认为副本还是 Leader，但 ZK 已经改了"的短暂不一致。

## 3. KRaft 模式的 Controller

KIP-500（2019 提出，Kafka 2.8 预览，3.3 GA，3.5 起 ZK 模式弃用，4.0 起 ZK 完全移除）把 Controller 与元数据存储都搬进 Kafka 自己。

来源：[KIP-500](https://cwiki.apache.org/confluence/display/KAFKA/KIP-500%3A+Replace+ZooKeeper+with+a+Self-Managed+Metadata+Quorum)、[Confluent KRaft Overview](https://docs.confluent.io/platform/7.7/kafka-metadata/kraft.html)、[Apache Kafka 4.0 release notes](https://kafka.apache.org/blog#apache_kafka_400_release_announcement)

### 3.1 Controller Quorum 与 Active Controller

一组（通常 3 或 5 个）Controller 节点组成 Raft 仲裁：

- 其中一个是 Active Controller（Raft leader），处理所有元数据写请求。
- 其余是 Standby Controller（Raft follower），只做日志复制。
- Active Controller 故障时按 Raft 协议在 follower 中选新 leader；由于 follower 一直在内存里保持最新状态，切换是**毫秒级**的，与分区数量无关。

节点通过 `process.roles` 配置指定角色：`controller`、`broker` 或两者组合（combined，仅推荐开发/测试用）。生产环境推荐分离部署，Controller 独立、只跑 Raft，不承载业务流量。

### 3.2 `__cluster_metadata` 元数据 topic

集群元数据不再存在 ZK 里，而是存在一个特殊的内部 topic：

```text
Topic: __cluster_metadata
Partitions: 1 （唯一，禁止修改）
Replicas: 与 Controller Quorum 节点数一致
```

这个 topic 用的是 KRaft 的定制 Raft 实现（不是普通的 Kafka 副本机制），日志内容是有类型的元数据事件（`RegisterBrokerRecord`、`TopicRecord`、`PartitionRecord`、`PartitionChangeRecord`、`ConfigRecord`、`AccessControlEntryRecord` 等）。所有元数据变更都以事件形式追加写入这个 topic：

```text
offset  event
   0    RegisterBrokerRecord(id=1, ...)
   1    RegisterBrokerRecord(id=2, ...)
   2    TopicRecord(name=orders, id=uuid1)
   3    PartitionRecord(topic=uuid1, partitionId=0, replicas=[1,2,3], isr=[1,2,3], leader=1, leaderEpoch=0)
   4    PartitionChangeRecord(topic=uuid1, partitionId=0, isr=[1,2], leaderEpoch=1)
   ...
```

对比 ZK 时代的差异：**元数据本身也变成了一份可回放的日志**，天然带 offset、天然有 leader epoch、天然可做增量同步。

来源：[apache/kafka `metadata` 模块](https://github.com/apache/kafka/tree/trunk/metadata/src/main/java/org/apache/kafka/metadata)、[Kafka Internals](https://systeminternals.dev/kafka/)

### 3.3 Broker 侧的元数据同步

Broker 现在是这个元数据 topic 的**只读消费者**：

```text
Broker 启动
    │
    ▼
连接 Controller Quorum，从 __cluster_metadata 拉取全部记录（或最新快照）
    │
    ▼
apply 到本地 MetadataImage（内存中的完整元数据视图）
    │
    ▼
持续增量拉取；每收到一批新记录 → apply 到 MetadataDelta
    │
    ▼
按 delta 更新本地 Partition / ReplicaManager 状态
```

对应源码：`BrokerMetadataListener` / `MetadataLoader` / `MetadataImage` / `MetadataDelta`，均在 `metadata` 模块下。

推模式 → 拉模式：
- ZK 时代 Controller 主动 `UpdateMetadataRequest` 广播，Broker 多时容易形成风暴。
- KRaft 时代 Broker 主动拉取，节奏由 Broker 控制，且拉取是增量的（只带回 offset 之后的新事件）。

### 3.4 元数据的写路径（以 `AlterPartition` 为例）

Leader 决定 ISR 变更时的完整链路：

```text
Leader Broker
   │  AlterPartitionRequest（含新 ISR、期望的 leader epoch）
   ▼
Active Controller
   │  ReplicationControlManager 校验：epoch 是否匹配、新 ISR 是否合法
   │  生成 PartitionChangeRecord
   ▼
写入 __cluster_metadata（Raft 复制）
   │  多数派 Standby Controller 确认
   ▼
Active Controller 认为该记录已 committed
   │  向请求 Broker 返回 AlterPartitionResponse
   │
   │  同时该记录会被所有 Broker 从 __cluster_metadata 拉走
   ▼
每个 Broker 的 MetadataLoader apply 该记录
   │  本地 Partition 对象更新 ISR / leaderEpoch
```

关键性质：
- 元数据变更的**顺序**由 offset 决定，全集群看到的顺序完全一致。
- 变更的**权威**在 Controller Quorum 的 committed offset，Broker 只是复读机。
- Active Controller 崩溃后新 Active 直接接管——它本来就在内存里持有完整 `MetadataImage`。

来源：[KIP-497 AlterIsr → AlterPartition](https://cwiki.apache.org/confluence/display/KAFKA/KIP-497%3A+Add+inter-broker+API+to+alter+ISR)

## 4. ZK 模式 vs KRaft 模式对比

| 维度 | ZooKeeper 模式 | KRaft 模式 |
| :-- | :-- | :-- |
| 元数据存储 | 外部 ZK znode | 内部 topic `__cluster_metadata` |
| Controller 数量 | 集群里恰好 1 个 Broker 兼任 | Controller Quorum（3/5 节点） |
| Controller 选举 | ZK 临时节点竞争 | KRaft 内部 Raft 协议 |
| 故障切换成本 | 新 Controller 全量重建状态，200K 分区 ≈ 14 秒 | 毫秒级，follower 已在内存中 |
| 变更传播 | Controller 主动 RPC 推送 | Broker 主动拉取 topic |
| 分区规模上限 | 约 200,000（Controller 切换时间瓶颈） | Confluent 实验室验证 2,000,000 |
| 支持版本 | ≤ 3.x；3.5 弃用；4.0 完全移除 | 2.8 预览，3.3 GA，4.0 唯一支持 |

上述"200,000/2,000,000"两个数字都来自 Confluent 官方文档；它们是**极限演示**而非日常运行目标。真实生产集群大多在几千到几万分区量级，瓶颈会先在 ulimit（文件描述符）、`vm.max_map_count`、Follower fetcher 线程等资源层面暴露出来（[Factor House: Kafka topic partition best practices](https://factorhouse.io/articles/kafka-topic-partition-best-practices)）。

## 5. 版本与兼容注意

| 版本 | 与 Controller 相关的关键变化 |
| :-- | :-- |
| 2.8 | KRaft 首次以预览形式出现，仅限开发/测试 |
| 3.3 | KRaft 标记为生产可用（[KIP-833](https://cwiki.apache.org/confluence/display/KAFKA/KIP-833%3A+Mark+KRaft+as+Production+Ready)） |
| 3.4 | 提供 ZK → KRaft 的迁移工具（bridge release 准备） |
| 3.5 | ZooKeeper 模式正式标记为 deprecated |
| 3.7 | ZK ↔ KRaft dual-write 桥接完善 |
| 4.0 | 完全移除 ZooKeeper 代码，KRaft 成为唯一支持的模式 |

来源：[Apache Kafka 4.0 release announcement](https://kafka.apache.org/blog#apache_kafka_400_release_announcement)、[Systeminternals.dev: Kafka Internals](https://systeminternals.dev/kafka/)

新建集群直接选 KRaft；ZK 集群还未升级的，按 3.5 → 3.7 → 4.0 的路径分步迁移，不要跳版本。迁移工具与流程见 [KRaft](./chapter-05-kraft.md)。

## 6. 常见运维观察点

- `kafka-metadata-quorum.sh describe --status`：查看 Active Controller、当前 committed offset、Follower 复制滞后。
- `kafka.controller:type=KafkaController,name=ActiveControllerCount`：全集群里数值总和应为 1，不为 1 说明脑裂或者 Controller 尚未选出。
- `kafka.controller:type=ControllerStats,name=UncleanLeaderElectionsPerSec`：任何非零都意味着一次真实的数据丢失事件。
- Controller 与 Broker 分离部署时，观察 Controller 节点 CPU / GC 状况——它承担了所有元数据写入与 Raft 复制，负载模型和普通 Broker 完全不同。

## 7. 一句话小结

- Controller 是元数据的唯一写入方；其他 Broker 都是它的观察者。
- ZK 模式下这份"唯一"是单个 Broker 兼任，故障切换需要重建状态，规模超过 20 万分区就会撞墙。
- KRaft 模式把元数据本身做成一个 Raft 复制的内部 topic，Controller Quorum 里 follower 一直是热备，切换毫秒级。
- 从 4.0 起 KRaft 是唯一形态；ZK 相关知识仅用于理解历史与做迁移。
