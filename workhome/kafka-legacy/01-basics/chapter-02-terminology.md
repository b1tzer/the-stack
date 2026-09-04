# 核心术语

> Kafka 的术语体系是理解其架构的基础。本章系统梳理核心概念，并解释它们之间的关系。

![Kafka 核心组件全景图](/kafka/01-basics-chapter-02-terminology.svg)

## 1. 为什么需要这套术语

Kafka 要解决两个根本问题：海量消息的分布式存储，以及节点故障时的高可用。围绕这两个目标，术语自然地分层展开：

- 单机存不下海量消息 → 需要分布式，引入 **Broker**；
- 要并行读写、横向扩展 → 把消息按 **Topic** 再切成 **Partition**；
- 节点可能宕机 → 每个 Partition 复制出 **Replica**，选出一个 **Leader**；
- 多个 Broker 需要协调 → 引入 **Controller**。

先记住这条因果链，后续每个术语都能挂到它上面，而不是零散地背名词。

## 2. 存储模型

| 术语 | 说明 |
| :-- | :-- |
| Broker | Kafka 服务器节点，负责存储消息和处理请求 |
| Topic | 消息的逻辑分类，类似数据库的「表」 |
| Partition | Topic 的物理分片，是并行和扩展的基本单位 |
| Segment | Partition 内的日志段文件，每个 Segment 对应一个 `.log` 文件 |
| Offset | 消息在分区内的唯一标识，从 0 开始递增 |

> **为什么需要 Partition？** 单台 Broker 的吞吐和磁盘都有上限。把 Topic 切成多个 Partition，消息可以并行写入不同 Broker，也能让多个消费者并行消费。Partition 是 Kafka 水平扩展和并行的最小单位。

存储层级关系：

```txt
Topic（逻辑）
  └── Partition 0（物理分片）
  │     ├── Segment 0（000000.log）
  │     ├── Segment 1（001234.log）
  │     └── Segment 2（005678.log）
  └── Partition 1
  │     ├── Segment 0
  │     └── ...
  └── Partition 2
        └── ...
```

## 3. 副本机制

| 术语 | 说明 |
| :-- | :-- |
| Replica | 分区的副本，分布在不同 Broker 上 |
| Leader | 主副本，处理该分区的所有读写请求 |
| Follower | 从副本，从 Leader 同步数据，不处理客户端请求 |
| AR | Assigned Replicas，分区的全部副本，即全集 |
| ISR | In-Sync Replicas，AR 中与 Leader 保持同步的子集 |
| OSR | Out-of-Sync Replicas，AR 中落后于 Leader 的子集（OSR = AR − ISR） |

ISR 的动态变化：

```txt
正常：ISR = {Leader, Follower1, Follower2}
Follower2 变慢：ISR = {Leader, Follower1}（Follower2 被移出）
Follower2 恢复：ISR = {Leader, Follower1, Follower2}（重新加入）
```

> ISR 是 Kafka 可靠性的核心。副本落后于 Leader 超过 `replica.lag.time.max.ms`（默认 30 秒）会被移出 ISR，追上后重新加入。`acks=all` 表示消息必须写入所有 ISR 副本才算成功；ISR 收缩意味着可靠性下降，需要监控。

## 4. 生产者

| 术语 | 说明 |
| :-- | :-- |
| Producer | 生产者，发送消息到 Topic |
| RecordAccumulator | 消息累加器，按分区聚合消息到内存缓冲区 |
| Sender | 发送线程，从累加器取出批量消息发送到 Broker |
| Batch | 批量，多条消息打包成一个请求发送 |
| ACK | 确认机制：0=不等确认、1=Leader确认、all=ISR全部确认 |
| Idempotent Producer | 幂等生产者，通过 PID + Sequence Number 去重 |

> 发送流程（拦截器 → 序列化 → 分区器 → RecordAccumulator → Sender → Broker）详见 [生产者 API](../../02-producer/chapter-01-producer-basics.md)。

## 5. 消费者

| 术语 | 说明 |
| :-- | :-- |
| Consumer | 消费者，从 Topic 读取消息 |
| Consumer Group | 消费者组，组内竞争消费同一 Topic |
| Rebalance | 重平衡，分区重新分配给消费者 |
| Heartbeat | 心跳，消费者向 Group Coordinator 报告存活 |
| Poll | 拉取，消费者从 Broker 获取消息 |
| Commit | 提交 Offset，标记已消费到的位置 |
| Lag | 消费延迟 = 最新 Offset - 已提交 Offset |

消费者组与分区的关系：

```txt
Topic 有 3 个分区
Consumer Group 有 2 个消费者

分配方案：
  Consumer1 → Partition 0, Partition 1
  Consumer2 → Partition 2

一个分区只能被组内一个消费者消费
一个消费者可以消费多个分区
```

## 6. 协调组件

| 术语 | 说明 |
| :-- | :-- |
| Controller | 集群控制器，负责分区 Leader 选举和元数据管理 |
| Group Coordinator | 消费者组协调器，管理 Rebalance |
| Transaction Coordinator | 事务协调器，管理事务提交和回滚 |
| KRaft Controller | KRaft 模式下的控制器，用 KRaft 元数据协议替代 ZooKeeper |

四个组件分工不同：Controller 负责分区 Leader 选举与集群元数据；Group Coordinator 由某台 Broker 担任，负责消费者组的 Rebalance 与 Offset 提交；Transaction Coordinator 负责生产者事务的提交与回滚。KRaft Controller 不是第四个并列角色，而是 Controller 的另一种实现——早期 Controller 依赖 ZooKeeper，KRaft 模式用内置的 KRaft 元数据协议取代 ZooKeeper。

## 7. 消息格式

Kafka 0.11+ 采用 Record Batch 格式：一条 Batch 承载多条 Record，共享压缩、时间戳、Producer ID 等公共字段，减少存储与网络开销。完整的字节级布局见 [日志分段与索引](../../05-storage-internals/chapter-01-log-segment.md)。
