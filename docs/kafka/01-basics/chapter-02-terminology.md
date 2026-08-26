# 核心术语

## 1. 核心概念

| 术语 | 说明 |
|------|------|
| Broker | Kafka 服务器节点 |
| Topic | 消息主题，逻辑分类 |
| Partition | 分区，Topic 的物理分片 |
| Offset | 消息在分区中的偏移量 |
| Producer | 生产者，发送消息 |
| Consumer | 消费者，接收消息 |
| Consumer Group | 消费者组，组内竞争消费 |

## 2. 副本相关

| 术语 | 说明 |
|------|------|
| Replica | 副本，分区的备份 |
| Leader | 主副本，处理读写 |
| Follower | 从副本，同步 Leader 数据 |
| ISR | In-Sync Replicas，同步副本集 |
| AR | Assigned Replicas，所有副本 |

## 3. 消息格式

```
┌─────────────────┐
│ Offset (8字节)   │
├─────────────────┤
│ Message Size    │
├─────────────────┤
│ CRC             │
├─────────────────┤
│ Timestamp       │
├─────────────────┤
│ Key (可选)       │
├─────────────────┤
│ Value           │
└─────────────────┘
```

## 4. 协调组件

| 术语 | 说明 |
|------|------|
| Controller | 集群控制器，负责分区 Leader 选举和元数据管理 |
| Group Coordinator | 消费者组协调器，管理消费者组的 Rebalance |
| Transaction Coordinator | 事务协调器，管理事务的提交和回滚 |
| KRaft Controller | KRaft 模式下的控制器，替代 ZooKeeper |

## 5. 生产者相关术语

| 术语 | 说明 |
|------|------|
| RecordAccumulator | 消息累加器，按分区聚合消息后批量发送 |
| Sender | 发送线程，从 RecordAccumulator 取出批量消息发送到 Broker |
| ACK | 确认机制，控制消息写入多少副本后才算成功 |
| Idempotent Producer | 幂等生产者，通过 PID + Sequence Number 保证不重复 |
| Transactional Producer | 事务生产者，支持跨分区原子写入 |

## 6. 消费者相关术语

| 术语 | 说明 |
|------|------|
| Rebalance | 消费者组重平衡，分区重新分配给消费者 |
| Heartbeat | 心跳，消费者向 Group Coordinator 发送存活信号 |
| Poll | 拉取，消费者从 Broker 获取消息 |
| Commit | 提交 Offset，标记已消费到的位置 |
| Lag | 消费延迟，最新 Offset 与已提交 Offset 的差值 |

## 7. 消息格式详解

Kafka 消息（Record）由 Record Header 和 Record Body 组成。在 0.11+ 版本中引入了 Record Batch 概念：

```
┌─────────────────────────────────┐
│         Record Batch            │
│  ┌───────────────────────────┐  │
│  │ Base Offset (8字节)        │  │
│  │ Batch Length (4字节)       │  │
│  │ Partition Leader Epoch     │  │
│  │ Magic (1字节, v2=2)       │  │
│  │ CRC (4字节)               │  │
│  │ Attributes (2字节)         │  │
│  │ Last Offset Delta         │  │
│  │ First Timestamp           │  │
│  │ Max Timestamp             │  │
│  │ Producer ID (8字节)        │  │
│  │ Producer Epoch            │  │
│  │ Base Sequence             │  │
│  │ Record Count              │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │ Record 1: Key + Value     │  │
│  │ Record 2: Key + Value     │  │
│  │ ...                       │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

## 8. 最佳实践

1. **理解 Offset 的含义**：Offset 是分区内消息的唯一标识，从 0 开始递增。它是消费进度管理的基础。
2. **关注 ISR 动态变化**：ISR 集合会随网络和负载变化，监控 ISR 收缩是保证可靠性的关键。
3. **合理使用 Key**：Key 不仅用于分区路由，还用于日志压缩（Log Compaction）场景下标识消息身份。
