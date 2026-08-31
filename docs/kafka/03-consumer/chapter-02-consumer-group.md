# 消费者组

> 消费者组是 Kafka 消费模型的核心。同组内竞争消费（每个分区只被一个消费者消费），不同组独立消费（发布/订阅）。本章讲清消费者组的工作原理、Rebalance 机制和 Lag 监控。

## 1. 消费者组模型

```text
Topic 有 3 个分区

Consumer Group A（2 个消费者）：
  Consumer A1 → Partition 0, Partition 1
  Consumer A2 → Partition 2

Consumer Group B（3 个消费者）：
  Consumer B1 → Partition 0
  Consumer B2 → Partition 1
  Consumer B3 → Partition 2

Group A 和 Group B 独立消费，各自维护 Offset
```

核心规则：

| 规则 | 说明 |
| :-- | :-- |
| 一个分区只能被组内一个消费者消费 | 保证组内不重复消费 |
| 一个消费者可以消费多个分区 | 分区数 > 消费者数时 |
| 消费者数 > 分区数 | 多余的消费者空闲 |
| 不同组独立消费 | 天然支持发布/订阅 |

## 2. Group Coordinator

每个消费者组有一个 Group Coordinator（Broker 节点），负责管理组的生命周期：

```text
Consumer → Group Coordinator：
  JoinGroup：加入组
  SyncGroup：获取分配方案
  Heartbeat：报告存活
  LeaveGroup：主动离开
  OffsetCommit：提交消费进度
```

Coordinator 选择：`hash(group.id) % __consumer_offsets 分区数` → 该分区的 Leader Broker 就是 Coordinator。

## 3. Rebalance 流程

### 3.1 触发条件

| 条件 | 说明 |
| :-- | :-- |
| 消费者加入 | 新消费者加入组 |
| 消费者离开 | 消费者宕机或主动离开 |
| 心跳超时 | `session.timeout.ms` 内没有心跳 |
| poll 超时 | `max.poll.interval.ms` 内没有调用 poll |
| 分区数变化 | Topic 分区数增加 |

### 3.2 完整流程

```text
1. Consumer 发送 JoinGroup Request → Coordinator
2. Coordinator 收集所有成员信息
3. Coordinator 选出 Group Leader（第一个加入的 Consumer）
4. Coordinator 把成员信息发送给 Leader
5. Leader 根据分配策略计算分区分配方案
6. Leader 发送 SyncGroup Request（带分配方案）→ Coordinator
7. Coordinator 把分配方案分发给每个成员
8. 每个成员知道自己的分区，开始消费
```

### 3.3 Rebalance 期间的影响

| 影响 | 说明 |
| :-- | :-- |
| 消费暂停 | 所有消费者停止消费，等待重新分配 |
| 可能重复消费 | 重新分配后从已提交的 Offset 开始，之前处理完但未提交的消息会重复 |
| 端到端延迟增加 | Rebalance 耗时 + 消费恢复时间 |

## 4. 心跳机制

```java
props.put("heartbeat.interval.ms", 3000);   // 心跳间隔
props.put("session.timeout.ms", 45000);      // 会话超时
props.put("max.poll.interval.ms", 300000);   // 最大 poll 间隔
```

两个超时的区别：

| 参数 | 检测目标 | 超时后果 |
| :-- | :-- | :-- |
| `session.timeout.ms` | 心跳超时 | 消费者被踢出组，触发 Rebalance |
| `max.poll.interval.ms` | poll 间隔过长 | 消费者被踢出组，触发 Rebalance |

> `heartbeat.interval.ms` 应设为 `session.timeout.ms` 的 1/3。例如 `session.timeout.ms=30000`，则 `heartbeat.interval.ms=10000`。

## 5. 消费者组状态机

```text
Empty → JoinGroup → PreparingRebalance → SyncGroup → CompletingRebalance → Stable
                    ▲                                                       │
                    └───────────────── Rebalance ──────────────────────────┘
```

| 状态 | 说明 |
| :-- | :-- |
| Empty | 组已创建但无成员 |
| PreparingRebalance | 正在收集成员，等待 JoinGroup |
| CompletingRebalance | Leader 已分配，等待 SyncGroup |
| Stable | 分配完成，正常消费 |
| Dead | 组已关闭 |

## 6. Lag 监控

### 6.1 命令行查看

```bash
kafka-consumer-groups.sh --describe --group my-group --bootstrap-server localhost:9092

# 输出
# GROUP    TOPIC    PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
# my-group my-topic 0          1000            1500            500
# my-group my-topic 1          2000            2500            500
```

### 6.2 Java API

```java
Map<TopicPartition, Long> endOffsets = consumer.endOffsets(partitions);
Map<TopicPartition, OffsetAndMetadata> committed = consumer.committed(partitions);

for (TopicPartition tp : partitions) {
    long endOffset = endOffsets.get(tp);
    long currentOffset = committed.get(tp) != null ? committed.get(tp).offset() : 0;
    long lag = endOffset - currentOffset;
    System.out.printf("Partition %d: Lag = %d%n", tp.partition(), lag);
}
```

### 6.3 Lag 的含义

| Lag | 含义 | 处理 |
| :-- | :-- | :-- |
| 稳定（不增长） | 消费速度跟得上 | 正常 |
| 缓慢增长 | 消费速度略低于生产速度 | 优化消费者或增加实例 |
| 快速增长 | 消费速度远低于生产速度 | 紧急扩容 |

## 7. 最佳实践

1. **消费者数 ≤ 分区数**：超出的消费者空闲，浪费资源。
2. **使用 CooperativeSticky 策略**：减少 Rebalance 期间的消费中断。
3. **设置合理的超时参数**：太短导致频繁 Rebalance，太长导致故障检测慢。
4. **监控 Lag**：Lag 持续增长说明消费能力不足。
5. **使用静态成员 ID**：减少不必要的 Rebalance。
