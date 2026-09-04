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

**双写**：元数据要同时写 ZooKeeper 和 Controller 本地缓存。两处数据的一致性靠各种边界条件保证，历史上多次出 bug。

**扩展瓶颈**：ZooKeeper 的 watch 机制在集群规模增大时成为瓶颈——每个 Broker 都要 watch 大量 znode，ZooKeeper 的压力随 Broker 数和分区数线性增长。

**运维复杂**：需要单独维护一个 ZooKeeper 集群，它有自己的配置、监控、升级流程。

## 4. KRaft：把元数据管理内建到 Kafka

KRaft（Kafka Raft）不是"把 ZooKeeper 换了个地方"，而是用 Raft 共识协议把元数据管理内置到 Kafka 自身。

### 架构变化

```txt
ZooKeeper 模式：
  Controller ←→ ZooKeeper（外部）←→ Broker

KRaft 模式：
  Controller Quorum（3~5 个节点）←→ Broker
  元数据存储在 __cluster_metadata 内部 Topic
```

### 关键区别

| 维度 | ZooKeeper | KRaft |
| :-- | :-- | :-- |
| 元数据存储 | 外部 ZooKeeper | 内部 `__cluster_metadata` 日志 |
| Controller 数量 | 1 个 Active | 3 或 5 个（Raft Quorum） |
| 故障恢复 | 重新加载全量元数据 | Raft 自动选主，增量追赶 |
| 元数据传播 | ZK watch + 本地缓存 | 消费元数据日志 |
| 外部依赖 | 需要 ZooKeeper 集群 | 无 |

### 为什么 Raft 比 ZooKeeper 更好

Raft 是一种共识协议，它的核心思想是：**多数节点同意才能提交**。KRaft Controller Quorum 中有 3~5 个节点，Active Controller（Raft Leader）接收元数据写入，复制到多数节点后才提交。

Active Controller 故障时，Raft 自动选举新 Leader。新 Leader 已经有了所有已提交的元数据（因为它参与了多数派确认），增量追赶未提交的部分即可。不需要全量重载——这比 ZooKeeper 模式的恢复快得多。

### 元数据传播

所有 Broker 消费 `__cluster_metadata` 这个内部 Topic，实时更新本地的元数据缓存。这比 ZooKeeper 的 watch 机制更高效——watch 是"推"模式，每个 znode 变更都要通知所有 watch 者；消费日志是"拉"模式，Broker 按自己的节奏消费，不给 Controller 增加压力。

## 5. 迁移的影响

| 维度 | 影响 |
| :-- | :-- |
| 运维 | 不再需要维护 ZooKeeper 集群 |
| 可用性 | 多 Controller 内置冗余，故障恢复更快 |
| 扩展性 | 元数据管理不再受 ZK 限制，支持更大规模的集群 |
| 兼容性 | Kafka 4.0 移除 ZK 支持，升级需要先迁移到 KRaft |

## 6. 配置

```properties
# KRaft 模式
process.roles=broker,controller    # 或分开部署
node.id=1
controller.quorum.voters=1@host1:9093,2@host2:9093,3@host3:9093
controller.listener.names=CONTROLLER
```
