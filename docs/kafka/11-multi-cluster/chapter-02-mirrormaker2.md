# MirrorMaker 2 架构与配置

MirrorMaker 2（简称 MM2）是 Apache Kafka 官方跨集群复制工具，通过 [KIP-382](https://cwiki.apache.org/confluence/display/KAFKA/KIP-382%3A+MirrorMaker+2.0) 在 Kafka 2.4 引入，替换了 MM1 的 consumer-producer 直连方案。旧版 MM1 已在 Kafka 4.0 被移除，本文只讲 MM2。

## 1. 为什么不是 MM1

MM1 是一对 consumer + producer 在同一 JVM 里跑：

```text
   [source cluster] ──▶ Consumer ──▶ Producer ──▶ [target cluster]
```

它有 3 个致命限制，KIP-382 的动机段列得很清楚：

1. **不同步 offset**。MM1 只复制消息，consumer 侧的消费进度停留在源集群的 `__consumer_offsets` 里。灾备切换后，目标集群的 consumer 无从知道"我该从哪里开始读"，只能 `earliest` 从头或 `latest` 从尾。
2. **不同步 topic 配置和 ACL**。分区数、保留时间、副本因子、ACL 都要在目标集群手工重建。
3. **不支持 Active-Active**。缺少循环防护机制。

MM2 在 Kafka Connect 框架上重写，把这些坑都补齐了。

## 2. 三个 Connector

MM2 本质上是一组 Kafka Connect Connector。启动 `connect-mirror-maker.sh` 会自动部署三个 Connector（每个 replication flow 一套）：

| Connector | 职责 | 输出的内部 Topic |
| :-- | :-- | :-- |
| **MirrorSourceConnector** | 复制消息数据；同步 topic 配置与 ACL；向 offset-syncs 写入 offset 映射 | `<source>.<topic>`、`<source>.offset-syncs.internal` |
| **MirrorCheckpointConnector** | 定期读取源集群 consumer group offset，翻译成目标集群 offset 后写入 checkpoint topic | `<source>.checkpoints.internal` |
| **MirrorHeartbeatConnector** | 向源集群写心跳消息，随消息流被 SourceConnector 复制到目标，用于端到端复制延迟监控 | `heartbeats`、`<source>.heartbeats` |

三者的关系：

```text
                       source cluster                              target cluster
                     ┌──────────────────┐                       ┌──────────────────┐
      producer ────▶ │  topic: orders   │ ──── MirrorSource ──▶ │ src.orders       │
                     │                  │                       │                  │
                     │  __consumer_off  │ ── MirrorCheckpoint ▶ │ src.checkpoints. │
                     │                  │   translate & write   │  internal        │
                     │  heartbeats      │ ◀── MirrorHeartbeat ─┐│                  │
                     │                  │      write hb        ││ src.heartbeats   │
                     │                  │ ──── MirrorSource ───┴│ (via replication)│
                     └──────────────────┘                       └──────────────────┘
```

MirrorHeartbeatConnector 是唯一一个**向源集群写**的连接器。它写的 `heartbeats` topic 会被 MirrorSourceConnector 当成普通消息复制到目标，形成一条端到端"心跳链路"——目标集群看到的 heartbeat 与心跳时间戳的差值就是当前的端到端复制延迟。

数据来源：[Kafka MirrorMaker 2 — Multi-Cluster Replication](https://cscode.io/kafka/KafkaMirrorMaker)、[KIP-382](https://cwiki.apache.org/confluence/display/KAFKA/KIP-382%3A+MirrorMaker+2.0)、[Red Hat: MirrorMaker components](https://docs.redhat.com/en/documentation/red_hat_streams_for_apache_kafka/3.1/html/disaster_recovery_using_mirrormaker_2/assembly-mm2-components-str)。

## 3. Remote Topic 命名：循环防护的关键

MM2 复制 topic 时，默认**给 topic 加上源集群 alias 作为前缀**。这是 `DefaultReplicationPolicy` 的核心行为。

```text
Source cluster alias: us-east
Source topic:         orders

Target cluster stored: us-east.orders
```

为什么这么设计？Active-Active 拓扑下，如果不改名字：

- `us-east.orders` 消息复制到 `us-west` 的 `orders`
- `us-west.orders` 又被 MM2 反向复制回 `us-east.orders`
- 无限循环，消息量指数级增长

有了前缀，Connector 判定"topic 名字里已经带了目标集群前缀"就跳过，循环被自然切断。

**代价**：目标集群消费者要订阅 `us-east.orders`，而不是 `orders`——应用代码要感知 topic 命名规范。

另一种选择是 `IdentityReplicationPolicy`，不加前缀。它只适合 Active-Standby 单向复制场景，Active-Active 用它会立刻循环炸掉。

```properties
# 不加前缀（仅 Active-Standby 可用）
replication.policy.class=org.apache.kafka.connect.mirror.IdentityReplicationPolicy
```

## 4. 最小可运行配置

一份典型的 Active-Standby 配置：

```properties
# ── 集群 alias ─────────────────────────────
clusters = primary, backup

# ── Bootstrap ──────────────────────────────
primary.bootstrap.servers = kafka-primary-1:9092,kafka-primary-2:9092,kafka-primary-3:9092
backup.bootstrap.servers  = kafka-backup-1:9092,kafka-backup-2:9092,kafka-backup-3:9092

# ── 复制方向：primary → backup ──────────────
primary->backup.enabled  = true
backup->primary.enabled  = false

# ── 复制哪些 topic 和 consumer group ────────
primary->backup.topics         = orders,payments,inventory-.*
primary->backup.topics.exclude = .*\.internal,__.*
primary->backup.groups         = .*
primary->backup.groups.exclude = console-consumer-.*

# ── 副本因子 ───────────────────────────────
replication.factor                       = 3
checkpoints.topic.replication.factor     = 3
heartbeats.topic.replication.factor      = 3
offset-syncs.topic.replication.factor    = 3

# ── 复制策略 ───────────────────────────────
replication.policy.class = org.apache.kafka.connect.mirror.DefaultReplicationPolicy

# ── 同步频率 ───────────────────────────────
emit.heartbeats.interval.seconds    = 1
emit.checkpoints.interval.seconds   = 10
sync.topic.configs.enabled          = true
sync.topic.acls.enabled             = true
refresh.topics.interval.seconds     = 30

# ── 并行度 ─────────────────────────────────
tasks.max = 8
```

启动：

```bash
bin/connect-mirror-maker.sh config/mm2.properties
```

Active-Active 只需要把反向也 enable：

```properties
primary->backup.enabled = true
backup->primary.enabled = true
```

## 5. 关键配置详解

### 5.1 `sync.topic.configs.enabled`

默认 `true`。开启后 SourceConnector 会周期性地把源 topic 的配置（`retention.ms`、`cleanup.policy`、`max.message.bytes` 等）同步到目标 topic。

**注意**：`replication.factor` 不会被同步。目标 topic 的副本因子由 MM2 配置里的 `replication.factor` 决定，默认 `2`（生产环境应显式设为 `3`）。

### 5.2 `sync.topic.acls.enabled`

默认 `true`。同步 topic 级别的 ACL。但**不**同步 `ALLOW WRITE` ACL——避免其他客户端写入目标集群造成不一致。其它资源（group、cluster、transactional-id 等）的 ACL 也不同步，需要另行维护（GitOps 是常见做法）。

### 5.3 `emit.checkpoints.interval.seconds`

默认 5 秒。MirrorCheckpointConnector 每隔多久把最新的 offset 映射写入 checkpoints topic。灾备切换时的 offset 精度上限 = 这个间隔。生产上通常调到 10~30 秒平衡性能与切换精度。

### 5.4 `sync.group.offsets.enabled`（Kafka 2.7+）

默认 `false`。开启后 MirrorCheckpointConnector 会**直接把翻译后的 offset 提交到目标集群的 `__consumer_offsets`**，而不仅仅写 checkpoints topic。灾备切换时 consumer 可以直接以原 group.id 启动，无需再用 `RemoteClusterUtils` 手工翻译。

::: warning 只在灾备场景开启
`sync.group.offsets.enabled=true` 会让目标集群的 `__consumer_offsets` 被源集群覆盖。如果目标集群同时有独立的消费者在跑（Active-Active 场景），会互相踩到。**只在 Active-Standby 单向复制时开启**。
:::

### 5.5 `refresh.topics.interval.seconds`

默认 5 秒。周期性检查源集群是否有新 topic 出现。新 topic 会自动创建对应的 remote topic 并开始复制。生产建议调大到 30~60 秒——过于频繁会给 broker 带来无谓的 metadata 请求压力。

### 5.6 内部 topic 的副本因子

`checkpoints.topic.replication.factor` / `heartbeats.topic.replication.factor` / `offset-syncs.topic.replication.factor` 默认都是 `3`（KIP-382 定义），但很多示例配置里写的是 `1`——**生产环境必须改成 3**。offset-syncs 尤其关键，它挂了会直接导致 Checkpoint 断流，灾备切换失败。

## 6. 部署形态

MM2 有三种部署方式：

**1. Dedicated MM2 Cluster**：`connect-mirror-maker.sh` 启动一个专用 Connect 集群。最常见，运维简单。

**2. 复用现有 Kafka Connect 集群**：把三个 Connector 手工注册到已有 Connect 集群。适合已经有大量 Connector 的场景。

**3. Kubernetes Operator**：Strimzi 提供 `KafkaMirrorMaker2` CRD，声明式管理。生产环境跑 Kubernetes 的团队首选。

## 7. 常见坑

**坑一：目标 topic 副本因子只有 2**。默认值 `replication.factor=2`，生产环境应显式 `replication.factor=3`。

**坑二：`__consumer_offsets` 也被复制**。默认 `topics.exclude` 会排除，但如果自己写了 `topics = .*` 覆盖，会连内部 topic 一起复制，造成灾难。必须显式加 `topics.exclude=__.*,.*\.internal`。

**坑三：Active-Active 忘记双向 enable**。只 enable 一个方向 = Active-Standby，切换时另一方向的消息全丢。

**坑四：延迟只看 `record-count`**。真正衡量端到端延迟的指标是 `replication-latency-ms`（KIP-382 定义），基于消息 timestamp 与到达 target 的时间差。

**坑五：MirrorHeartbeatConnector 部署位置**。它向**源集群**写心跳，如果 MM2 部署在离目标近的位置（推荐做法，减少复制延迟），HeartbeatConnector 会跨机房写。Red Hat 官方文档建议**灾备场景关掉 HeartbeatConnector**，仅在需要监控端到端延迟时开启。

## 8. 与本目录其他章节的关系

- offset 到底怎么翻译、翻译精度如何 → [§3 Offset 翻译](./chapter-03-offset-translation.md)
- 真正切换时的执行流程 → [§4 灾备演练](./chapter-04-dr-drill.md)
