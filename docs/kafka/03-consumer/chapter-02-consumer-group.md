# 消费者组与 Rebalance

## 1. 消费者组

- 同一组内，每个分区只被一个消费者消费
- 不同组之间，独立消费
- 消费者数量 > 分区数：多余消费者空闲

## 2. Rebalance 触发条件

- 消费者加入/离开组
- Topic 分区数变化
- 消费者心跳超时

## 3. Rebalance 策略

| 策略 | 说明 |
|------|------|
| Range | 按范围分配 |
| RoundRobin | 轮询分配 |
| Sticky | 粘性分配，尽量保持原分配 |
| CooperativeSticky | 协作式粘性，逐步迁移 |

```java
props.put("partition.assignment.strategy", 
    "org.apache.kafka.clients.consumer.CooperativeStickyAssignor");
```

## 4. Rebalance 影响

- 消费暂停
- 可能重复消费
- 尽量避免频繁 Rebalance

## 5. Rebalance 完整流程

```
1. Consumer 加入组 → JoinGroup Request → Group Coordinator
2. Coordinator 选出 Group Leader（第一个加入的 Consumer）
3. Coordinator 收集所有成员信息，发送给 Leader
4. Leader 根据分配策略计算分区分配方案
5. Leader 发送 SyncGroup Request（带分配方案）给 Coordinator
6. Coordinator 将分配方案分发给每个成员
7. 每个成员知道自己的分区，开始消费
```

## 6. 心跳机制详解

```java
props.put("heartbeat.interval.ms", 3000);   // 心跳间隔（推荐 session.timeout 的 1/3）
props.put("session.timeout.ms", 45000);      // 会话超时
props.put("max.poll.interval.ms", 300000);   // 最大 poll 间隔
```

**两个超时的作用**：
- `session.timeout.ms`：心跳超时，判定消费者是否存活。
- `max.poll.interval.ms`：两次 poll() 之间的最大间隔，处理时间过长会导致 Rebalance。

## 7. 消费者组状态机

```
         JoinGroup
Empty ──────────► PreparingRebalance ──► Stable
                    ▲                      │
                    │    Rebalance          │
                    └───────────────────────┘

PreparingRebalance → CompletingRebalance → Stable
```

| 状态 | 说明 |
|------|------|
| Empty | 组已创建但无成员 |
| PreparingRebalance | 正在收集成员，等待 JoinGroup |
| CompletingRebalance | Leader 已分配，等待 SyncGroup |
| Stable | 分配完成，正常消费 |
| Dead | 组已关闭 |

## 8. 消费者 Lag 监控

```bash
# 查看消费者 Lag
kafka-consumer-groups.sh --describe --group my-group --bootstrap-server localhost:9092

# 输出示例
# GROUP    TOPIC     PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
# my-group my-topic  0          1000            1500            500
# my-group my-topic  1          2000            2500            500
```

```java
// Java API 获取 Lag
Map<TopicPartition, Long> endOffsets = consumer.endOffsets(partitions);
Map<TopicPartition, Long> committed = consumer.committed(partitions);
for (TopicPartition tp : partitions) {
    long endOffset = endOffsets.get(tp);
    long currentOffset = committed.get(tp) != null ? committed.get(tp).offset() : 0;
    long lag = endOffset - currentOffset;
    System.out.printf("Partition %d: Lag = %d%n", tp.partition(), lag);
}
```

## 9. 最佳实践

1. **消费者数 ≤ 分区数**：超出的消费者会空闲，浪费资源。
2. **使用 CooperativeSticky 策略**：避免 Stop-the-World 式的 Rebalance。
3. **设置合理的 session.timeout.ms**：太短会导致频繁 Rebalance，太长会导致故障检测慢。
4. **监控 Lag**：Lag 持续增长说明消费能力不足，需要增加消费者或优化处理逻辑。
