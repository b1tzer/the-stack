# 核心术语

> Kafka 的术语体系是理解其架构的基础。本章系统梳理核心概念，并解释它们之间的关系。

## 1. 存储模型

| 术语 | 说明 |
| :-- | :-- |
| Broker | Kafka 服务器节点，负责存储消息和处理请求 |
| Topic | 消息的逻辑分类，类似数据库的「表」 |
| Partition | Topic 的物理分片，是并行和扩展的基本单位 |
| Segment | Partition 内的日志段文件，每个 Segment 对应一个 `.log` 文件 |
| Offset | 消息在分区内的唯一标识，从 0 开始递增 |

存储层级关系：

```text
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

## 2. 副本机制

| 术语 | 说明 |
| :-- | :-- |
| Replica | 分区的副本，分布在不同 Broker 上 |
| Leader | 主副本，处理该分区的所有读写请求 |
| Follower | 从副本，从 Leader 同步数据，不处理客户端请求 |
| ISR | In-Sync Replicas，与 Leader 保持同步的副本集合 |
| AR | Assigned Replicas，分区的所有副本（ISR + OSR） |
| OSR | Out-of-Sync Replicas，落后于 Leader 的副本 |

ISR 的动态变化：

```text
正常：ISR = {Leader, Follower1, Follower2}
Follower2 变慢：ISR = {Leader, Follower1}（Follower2 被移出）
Follower2 恢复：ISR = {Leader, Follower1, Follower2}（重新加入）
```

> ISR 是 Kafka 可靠性的核心。acks=all 表示消息必须写入所有 ISR 副本才算成功。ISR 收缩意味着可靠性下降，需要监控。

## 3. 生产者

| 术语 | 说明 |
| :-- | :-- |
| Producer | 生产者，发送消息到 Topic |
| RecordAccumulator | 消息累加器，按分区聚合消息到内存缓冲区 |
| Sender | 发送线程，从累加器取出批量消息发送到 Broker |
| Batch | 批量，多条消息打包成一个请求发送 |
| ACK | 确认机制：0=不等确认、1=Leader确认、all=ISR全部确认 |
| Idempotent Producer | 幂等生产者，通过 PID + Sequence Number 去重 |

生产者内部流程：

```text
send() → 拦截器 → 序列化 → 分区器 → RecordAccumulator → Sender → Broker
                                                                      ↓
                                                              ACK 返回
```

## 4. 消费者

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

```text
Topic 有 3 个分区
Consumer Group 有 2 个消费者

分配方案：
  Consumer1 → Partition 0, Partition 1
  Consumer2 → Partition 2

一个分区只能被组内一个消费者消费
一个消费者可以消费多个分区
```

## 5. 协调组件

| 术语 | 说明 |
| :-- | :-- |
| Controller | 集群控制器，负责分区 Leader 选举和元数据管理 |
| Group Coordinator | 消费者组协调器，管理 Rebalance |
| Transaction Coordinator | 事务协调器，管理事务提交和回滚 |
| KRaft Controller | KRaft 模式下的控制器，替代 ZooKeeper |

## 6. 消息格式

Kafka 0.11+ 使用 Record Batch 格式：

```text
┌─────────────────────────────────┐
│         Record Batch            │
│  Base Offset (8字节)             │
│  Batch Length (4字节)            │
│  Partition Leader Epoch          │
│  Magic (1字节, v2=2)            │
│  CRC32C (4字节)                 │
│  Attributes (2字节)              │
│  Last Offset Delta              │
│  First Timestamp / Max Timestamp │
│  Producer ID (8字节)             │
│  Producer Epoch                  │
│  Base Sequence                   │
│  Record Count                    │
│  ─────────────────────────────  │
│  Record 1: Key + Value + Headers│
│  Record 2: Key + Value + Headers│
│  ...                            │
└─────────────────────────────────┘
```

Record Batch 的设计价值：批量处理多条消息、共享公共字段（压缩、时间戳、Producer ID）、减少存储开销。

