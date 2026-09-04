# KRaft 模式

> Controller 的架构定位与 Broker 交互路径见 [Controller](./chapter-04-controller.md)。本章聚焦 KRaft 协议本身：它是如何"改造过的 Raft"、`__cluster_metadata` 日志的结构、快照机制、以及部署与迁移的实际操作。

## 1. KRaft ≠ 标准 Raft

KRaft 全名 Kafka Raft，用 Raft 的思想解决 Controller Quorum 的一致性问题，但**没有直接照搬标准 Raft**。它复用了 Kafka 已有的 pull 式复制协议，把术语和 RPC 都对齐到 Kafka 生态，与标准 Raft 有几处关键区别：

| 维度 | 标准 Raft | KRaft |
| :-- | :-- | :-- |
| 复制方向 | Leader push `AppendEntries` | Follower 主动 `Fetch` 拉取 |
| 心跳 | 独立 `AppendEntries` heartbeat | `FetchResponse` 兼作心跳，无独立 RPC |
| 术语 | term（任期） | epoch（含义相同） |
| 日志内容 | 不透明字节 | 强类型元数据记录（`RegisterBrokerRecord` / `PartitionRecord` / …） |
| 快照内容 | 应用层任意状态 | 序列化后的 `MetadataImage` |
| 慢 follower | Leader 卡等重试 | Leader 不阻塞，只是等对方下一次 Fetch |

pull 模式是最本质的一个改动：Kafka 副本层本来就是 follower 向 leader Fetch，把这套代码复用给 KRaft 意味着**存储、传输、慢副本处理的整套机制不用重写**。Leader 不会被慢 follower 拖住，它只跟踪对方上报的 fetch offset。

来源：[Confluent: Why ZooKeeper Was Replaced with KRaft](https://www.confluent.io/blog/why-replace-zookeeper-with-kafka-raft-the-log-of-all-logs/)、[Kafka Replication — ISR, Leader Election, and KRaft](https://www.beyondcruds.com/blog/kafka_replication)

### 1.1 多数派提交为什么就够

Raft 的一致性靠"多数派确认"，而不是"全部节点确认"。假设 Quorum 有 3 个 Controller，只要 2 个（多数）落盘一条元数据变更，这条变更就算 committed：

```txt
3 个节点，多数派 = 2
Leader 写入「创建 Topic X」的日志
Leader 落盘 → 复制到 Follower1 落盘 → Follower2 尚未收到
多数派（Leader + Follower1）已确认 → 提交成功
此时 Follower2 故障，也不影响一致性
```

关键在于：任意两次多数派集合必然相交。旧 Leader 把某条日志提交给多数派 {A, B}，之后它宕机，新 Leader 必须赢得多数派选票——这个新多数派里至少有一个节点参加过前一次提交，所以新 Leader 一定"见过"这条已提交日志。KRaft 在投票阶段还加了 log completeness check：一个日志比其他人更旧的候选者拿不到多数票。

## 2. `__cluster_metadata` 的物理结构

元数据 topic 在磁盘上和普通 Kafka topic 结构一样，但只有一个分区、且写入被限制为只有 Active Controller。目录布局：

```txt
metadata.log.dir/__cluster_metadata-0/
├── 00000000000000000000.log              ← 元数据事件日志段
├── 00000000000000000000.index            ← 偏移量索引
├── 00000000000000000000.timeindex
├── 00000000000123456789-00000000000000000005.checkpoint  ← 快照
├── quorum-state                          ← 当前 epoch/leader 状态
└── meta.properties                       ← cluster.id、node.id、directory.id
```

日志段与索引复用 `LogSegment` / `OffsetIndex` 那一套（见 [日志分段与索引](./chapter-01-log-segment.md)）；不同之处是内容以 KRaft 定义的元数据 record 类型编码。用 `kafka-dump-log --cluster-metadata-decoder` 可以看到解码后的事件流：

```bash
bin/kafka-dump-log.sh --cluster-metadata-decoder \
    --files __cluster_metadata-0/00000000000000000000.log
```

来源：[Kafka 3.5 KRaft Operations](https://kafka.apache.org/35/operations/kraft/)

### 2.1 元数据事件的种类

主要 record 类型（都定义在 `metadata` 模块）：

| Record | 触发场景 |
| :-- | :-- |
| `RegisterBrokerRecord` | Broker 上线 |
| `UnregisterBrokerRecord` | Broker 下线 |
| `TopicRecord` | 创建 Topic |
| `PartitionRecord` | 创建分区 |
| `PartitionChangeRecord` | ISR / Leader / leader epoch 变更 |
| `ConfigRecord` | 动态配置变更 |
| `AccessControlEntryRecord` | ACL 变更 |
| `FeatureLevelRecord` | Feature flag 抬升 |
| `ProducerIdsRecord` | Producer ID 段分配 |

## 3. 元数据快照（KIP-630）

日志会无限增长，需要压缩。KRaft 不能用 `compact` 清理策略（这个策略保留每个 key 的最新值，对元数据事件序列不适用），而是走**快照**：

- Active Controller 把内存中的 `MetadataImage` 序列化成一个 `checkpoint` 文件；
- 快照文件名 = `<endOffset>-<epoch>.checkpoint`；
- 快照之前的日志段可以被删除；
- 新加入或长时间离线的节点先拉快照，再从快照的 endOffset 开始 Fetch 后续记录。

快照频率由 `metadata.log.max.record.bytes.between.snapshots` 控制，默认 20 MB。快照文件通过 `FetchSnapshot` RPC 传输，带 CRC 校验。

来源：[KIP-630](https://cwiki.apache.org/confluence/x/gyZ4CQ)

## 4. Controller Quorum 与部署

### 4.1 Voter 与 Observer

Quorum 里的角色：

- **Voter**：`process.roles` 包含 `controller` 的节点，参与 Raft 选举与提交。
- **Observer**：普通 Broker，不投票，只作为 Raft 层意义上的观察者从 Quorum 拉元数据。

只有 Voter 参与投票，选举与提交延迟只依赖 Controller 数量（3 或 5），与集群里 Broker 数量无关。这是 KRaft 能横向扩展到大规模集群的另一个关键：把参与共识的节点数固定住。

### 4.2 Quorum 大小

容忍 f 个故障需要 2f+1 个 Voter：3 个 Controller 容忍 1 个故障，5 个容忍 2 个。生产上：

- 3 个 Controller 是最常见的配置；
- 5 个用于对可用性要求非常高的场景；
- **奇数**——偶数节点数的容忍度和 (n-1) 一样，只多花一份成本。

### 4.3 部署模式

`process.roles` 决定节点角色：

```properties
# 生产推荐：Controller 与 Broker 分离
process.roles=controller     # controller 节点
process.roles=broker         # broker 节点

# 开发 / 小型集群：combined
process.roles=broker,controller
```

Kafka 官方与 Confluent 都明确说：combined 模式**仅用于开发**。生产集群把 Controller 放到独立进程，避免业务 IO 与 GC 影响元数据共识。Confluent Platform 目前甚至不支持 combined 模式的生产部署。

来源：[Kafka 3.5 KRaft Operations](https://kafka.apache.org/35/operations/kraft/)、[Confluent KRaft Overview](https://docs.confluent.io/platform/7.7/kafka-metadata/kraft.html)

### 4.4 关键配置

```properties
# 节点唯一 ID，每台不同
node.id=1

# 角色
process.roles=controller

# Voter 列表：所有 Controller 都要枚举，格式 <id>@<host>:<port>
controller.quorum.voters=1@controller1:9093,2@controller2:9093,3@controller3:9093

# 监听器
listeners=CONTROLLER://controller1:9093
controller.listener.names=CONTROLLER

# 元数据日志目录（独立于 Broker 数据日志）
log.dirs=/var/kraft-controller-logs

# 快照频率（默认 20 MB）
metadata.log.max.record.bytes.between.snapshots=20971520
```

Broker 侧只需 `process.roles=broker` 与相同的 `controller.quorum.voters`；它通过这个列表建立 Fetch 连接。

## 5. 集群启动流程

新集群启动前必须先「格式化」——这是 KRaft 与 ZK 时代最大的运维差异：

```bash
# 1. 生成集群 UUID（cluster.id）
CLUSTER_ID=$(bin/kafka-storage.sh random-uuid)

# 2. 每个节点分别执行 format（把 cluster.id 写到 meta.properties）
bin/kafka-storage.sh format \
    --config config/kraft/server.properties \
    --cluster-id $CLUSTER_ID

# 3. 启动
bin/kafka-server-start.sh config/kraft/server.properties
```

不允许自动格式化的原因：ZK 时代目录空就自动初始化，掩盖了「多数控制器带空日志启动可能选出丢数据的 leader」这个错误场景。显式 format 强迫运维确认当前节点的存储状态。

## 6. 动态 Quorum 成员（KIP-853）

3.9 之前，Voter 集合由 `controller.quorum.voters` 静态配置，改动 Controller 需要滚动重启全部节点。KIP-853 引入了 `AddVoter` / `RemoveVoter` RPC 与 `controller.quorum.bootstrap.servers` 配置，可以在集群运行时增删 Controller：

```bash
# 3.9+ 增加一个 Controller
bin/kafka-metadata-quorum.sh --bootstrap-server ... add-controller --id 4 ...
```

在此之前，替换故障 Controller 磁盘需要人工在旧节点和新节点上小心操作 on-disk 状态；有了 KIP-853 后这变成一次在线操作。启用需要检查 Kafka 版本与 feature flag。

来源：[KIP-853: KRaft Controller Membership Changes](https://cwiki.apache.org/confluence/pages/viewpage.action?pageId=399279209)

## 7. 从 ZooKeeper 迁移

在线迁移（KIP-866）从 3.5 起可用，3.6 GA。分四步：

```txt
① 元数据复制阶段
   启动一组 KRaft Controller，让它们连上 ZK，把 ZK 里的元数据复制到 __cluster_metadata

② Dual-write 混合阶段
   KRaft Controller 成为 Active，元数据同时写 KRaft 日志和 ZK，Broker 仍在 ZK 模式

③ Broker 滚动重启阶段
   逐个 Broker 改为 KRaft 模式（改 process.roles、controller.quorum.voters）
   Phase 3 中随时可回滚

④ Finalization
   停止 dual-write，Controller 只写 KRaft 日志，退出 ZK
```

迁移前的硬性要求：Kafka 版本 ≥ 3.5、集群没有使用被 4.0 移除的特性、有完整备份、有独立 Controller 节点。这不是一个可以在生产直接跑的动作，必须先在测试集群完整走一遍。4.0 已完全移除 ZK 支持——ZK 集群升级 4.x 前必须完成迁移。

来源：[KIP-866 ZooKeeper to KRaft Migration](https://cwiki.apache.org/confluence/display/KAFKA/KIP-866+ZooKeeper+to+KRaft+Migration)、[Factor House: Kafka architecture](https://factorhouse.io/articles/kafka-architecture)

## 8. 运维与观测

```bash
# Quorum 状态：Active Controller、committed offset、follower lag
bin/kafka-metadata-quorum.sh --bootstrap-server broker:9092 describe --status

# 输出示例：
# ClusterId:              fMCL8kv1SWm87L_Md-I2hg
# LeaderId:               3002
# LeaderEpoch:            2
# HighWatermark:          10
# MaxFollowerLag:         0
# MaxFollowerLagTimeMs:   -1
# CurrentVoters:          [3000,3001,3002]
# CurrentObservers:       [0,1,2]

# 交互式浏览元数据
bin/kafka-metadata-shell.sh --snapshot .../__cluster_metadata-0/00000000000000000000.log

# Dump 元数据日志
bin/kafka-dump-log.sh --cluster-metadata-decoder \
    --files .../__cluster_metadata-0/00000000000000000000.log
```

生产上稳定看几个指标：

- `MaxFollowerLagTimeMs`：Follower 与 Active Controller 的复制延迟；持续升高说明 Quorum 内部有问题。
- `kafka.controller:type=KafkaController,name=ActiveControllerCount`：整个集群总和应恒为 1。
- 元数据日志的磁盘增长速率：正常应远慢于业务 topic；如果异常上涨往往是 config / partition churn 过高。

## 9. 常见坑

- **Controller 与 Broker 混部导致 Quorum 抖动**：业务流量的 GC 抖动会拖慢 Controller Raft，副作用是分区 Leader 选举变慢。生产集群必须分离。
- **`controller.quorum.voters` 与实际 `node.id` 对不上**：任何一个节点写错都会导致该节点起不来或投票被拒。
- **元数据日志目录用同一块盘**：`metadata.log.dir` 若与业务 log dirs 共用磁盘，busy 时会拖累元数据写入；推荐独立盘（哪怕小）。
- **Combined 模式带上生产流量**：官方明确不建议，且 Confluent Platform 不支持。

## 10. 一句话小结

- KRaft 是"pull-based Raft + 强类型元数据 topic"的组合，不是标准 Raft 的照搬。
- 元数据本身是一份可回放、可快照的 Kafka topic，Broker 是它的 observer。
- 3 或 5 个奇数 Controller 独立部署，与 Broker 隔离；combined 只用于开发。
- 4.0 之后没有 ZK；3.x 集群要在升级 4.x 前用 KIP-866 迁移到 KRaft。
