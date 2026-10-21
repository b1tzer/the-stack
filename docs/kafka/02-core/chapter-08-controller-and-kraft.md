# Controller 与 KRaft

> Kafka 集群需要一个"管理员"来决定谁是 Leader、谁在线、元数据怎么管理。这个管理员就是 Controller。从 ZooKeeper 到 KRaft 的迁移不是"换了个存储"，而是把这个管理员从"外聘"变成了"内建"。

## 1. 为什么需要 Controller

分布式系统里，有一个基本问题：**谁来决定"谁是什么"？**

- 哪个 Broker 是 Partition 0 的 Leader？
- 哪些 Broker 在 ISR 中？
- Broker 3 宕机了，它的分区怎么处理？

这些问题不能让 Broker 自己回答——如果两个 Broker 都认为自己是 Leader，就会出现"脑裂"。必须有一个**唯一的权威源**来管理元数据，所有 Broker 向它看齐。

这就是 Controller 的角色：集群中唯一有权变更元数据的节点。

## 2. Controller 做什么

| 职责 | 为什么需要它 |
| :-- | :-- |
| Broker 生死判定 | Broker 宕机后需要触发 Leader 选举 |
| 分区 Leader 选举 | Leader 宕机后从 ISR 选新 Leader |
| ISR 变更 | Leader 报告 ISR 变化，Controller 确认并广播 |
| Topic 生命周期 | 创建/删除 Topic、分区扩容、副本重分配 |
| 元数据广播 | 让所有 Broker 感知上述变更 |

其他 Broker 只是元数据的"观察者"——本地缓存一份，处理 Produce/Fetch 请求。任何要**写**元数据的动作都必须走 Controller。

## 3. ZooKeeper 模式的问题

Kafka 2.8 之前，Controller 依赖外部的 ZooKeeper 集群存储元数据：

```txt
元数据存在 ZooKeeper 的 znode 里：
/brokers/ids/<id>                ← Broker 注册
/brokers/topics/<topic>/partitions/<n>/state  ← Leader、ISR
/controller                      ← 当前 Controller 的临时节点
```

这个架构有四个问题：

**单点**：只有一个 Active Controller。它宕机后，新 Controller 需要从 ZooKeeper 重新加载全量元数据——集群越大，恢复越慢。

**双写**：元数据的权威存储在 ZooKeeper，Controller 本地还要维护一份运行时状态，两处需要保持一致。这种一致性靠各种边界条件保证，历史上多次出 bug。

**扩展瓶颈**：ZooKeeper 模式下 Controller 要 watch 大量 znode，任何变更都要先经 ZK 通知 Controller，再由 Controller 广播给所有 Broker。这条通知链路在分区数和 Broker 数增长时开销显著，Controller 单点成为瓶颈。

**运维复杂**：需要单独维护一个 ZooKeeper 集群，它有自己的配置、监控、升级流程。

## 4. KRaft：把元数据管理内建到 Kafka

KRaft（Kafka Raft）不是"把 ZooKeeper 换了个地方"，而是用 Raft 共识协议把元数据管理内置到 Kafka 自身。

### 架构变化

```txt
ZooKeeper 模式：
  Controller ←→ ZooKeeper（外部）←→ Broker

KRaft 模式：
  Controller Quorum（3~5 个节点）—Raft 复制—→ 多数派提交
  Broker（observer）—fetch 拉取—→ Active Controller
  元数据存储在 Controller 的元数据日志（__cluster_metadata）
```

### 关键区别

| 维度 | ZooKeeper | KRaft |
| :-- | :-- | :-- |
| 元数据存储 | 外部 ZooKeeper | 内部 `__cluster_metadata` 日志 |
| Controller 数量 | 1 个 Active | 3 或 5 个（Raft Quorum） |
| 故障恢复 | 重新加载全量元数据 | Raft 自动选主，增量追赶 |
| 元数据传播 | ZK watch + 本地缓存 | Broker 主动拉取（fetch） |
| 外部依赖 | 需要 ZooKeeper 集群 | 不需要 ZooKeeper 集群 |

### 为什么 Raft 比 ZooKeeper 更好

Raft 是一种共识协议，它的核心思想是：**多数节点同意才能提交**。KRaft Controller Quorum 中有 3~5 个节点，Active Controller（Raft Leader）接收元数据写入，复制到多数节点后才提交。

Active Controller 故障时，Raft 自动选举新 Leader。Raft 的选举规则保证新 Leader 一定拥有全部已提交的元数据。投票者只会把选票投给日志不比自己旧的候选者（比较最后任期和偏移量），而任何已提交日志都已复制到多数派节点——候选者要凑齐多数派选票，就必须覆盖这些已提交日志，否则持有它们的节点不会投票给它。未提交的日志则可能在换届时被覆盖。因此新 Leader 无需像 ZooKeeper 模式那样从外部存储全量重载元数据。这是架构上的优势：恢复不再随集群规模线性恶化，但实际恢复时间仍取决于选举耗时、日志追赶和状态重建。

### 元数据传播

元数据传播分两条路径。Controller 之间：Active Controller 把元数据变更写入 `__cluster_metadata` 这个单分区元数据日志，通过 Raft 复制到其他 Controller，多数派确认后才提交。Controller 与 Broker 之间：Broker 是元数据日志的 observer（观察者），不参与投票，而是通过 fetch 机制定期向 Active Controller 拉取元数据增量并更新本地缓存——这与普通消费者组消费业务 Topic 是两回事。

这套"拉"模式比 ZooKeeper 的 watch"推"模式更高效。watch 模式下每个 znode 变更都要通知所有 watch 者，Controller 的推送压力随 Broker 数和分区数增长；fetch 模式下 Broker 按自己的节奏拉取，落后时只补增量，Controller 不承担主动推送的负担。

## 5. 迁移的影响

| 维度 | 影响 |
| :-- | :-- |
| 运维 | 不再需要维护 ZooKeeper 集群 |
| 可用性 | 多 Controller 内置冗余，故障恢复更快 |
| 扩展性 | 元数据管理不再受 ZK 限制，支持更大规模的集群 |
| 兼容性 | Kafka 4.0 移除 ZK 支持，升级需要先迁移到 KRaft |

## 6. 配置

下面的示例是**静态 Quorum** 配置，`controller.quorum.voters` 显式列出所有投票节点。Kafka 3.9 起支持**动态 Quorum**（KIP-853），改用 `controller.quorum.bootstrap.servers` 引导发现 Quorum，运行时可通过 `kafka-metadata-quorum.sh` 增删 Controller。静态或动态 Quorum 在集群格式化时决定；Kafka 4.1 起可按迁移流程把已运行的静态 Quorum 转为动态，不能仅靠修改配置项切换。新集群部署优先考虑动态 Quorum。

```properties
# KRaft 模式（静态 Quorum）
process.roles=broker,controller    # 合并部署；生产环境建议分离为 broker 与 controller 独立节点
node.id=1
controller.quorum.voters=1@host1:9093,2@host2:9093,3@host3:9093   # 动态 Quorum 改用 controller.quorum.bootstrap.servers
controller.listener.names=CONTROLLER
```
