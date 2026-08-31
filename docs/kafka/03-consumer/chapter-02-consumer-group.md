# 消费者组

> Consumer Group 是 Kafka 实现"竞争消费"和"广播消费"的核心机制。

## 1. Consumer Group 的工作原理

```text
Consumer Group: order-service
  ├── Consumer 1 → Partition 0
  ├── Consumer 2 → Partition 1
  └── Consumer 3 → Partition 2

每个 Partition 只分配给组内一个 Consumer
一个 Consumer 可以消费多个 Partition
```

### 两种消费模式

| 模式 | Consumer Group 数量 | 效果 |
|------|-------------------|------|
| 竞争消费 | 1 个 Group | 每条消息只被一个 Consumer 处理 |
| 广播消费 | N 个 Group | 每条消息被 N 个 Consumer 处理 |

## 2. Partition 分配策略

### Range（默认）

```text
Partitions: [0, 1, 2, 3, 4, 5]
Consumers: [C1, C2]

C1: [0, 1, 2]
C2: [3, 4, 5]
```

### RoundRobin

```text
Partitions: [0, 1, 2, 3, 4, 5]
Consumers: [C1, C2]

C1: [0, 2, 4]
C2: [1, 3, 5]
```

### Sticky

Rebalance 时尽量保持原有分配，减少不必要的 Partition 迁移。

### CooperativeSticky（推荐）

增量式 Rebalance，不需要停止所有 Consumer。

## 3. Consumer Group 的限制

- **Consumer 数量 ≤ Partition 数量**：多余的 Consumer 会闲置
- **一个 Partition 只能被一个 Consumer 消费**：保证 Partition 内有序
- **增加 Consumer 会触发 Rebalance**

## 4. Group Coordinator

```text
Consumer Group → Group Coordinator（某个 Broker）
  ├── 管理 Consumer 成员列表
  ├── 处理 Rebalance
  └── 管理 Offset
```

## 5. 最佳实践

1. **Consumer 数量 = Partition 数量**：最大化并行
2. **使用 CooperativeSticky**：减少 Rebalance 影响
3. **设置合理的 session.timeout.ms**：避免网络抖动导致误判
4. **手动提交 Offset**：更可靠的消费语义
5. **处理 Rebalance 回调**：在 onPartitionsRevoked 中提交 Offset
