# Rebalance 策略

## 1. Range 策略

按分区范围分配，可能导致不均衡。

## 2. RoundRobin 策略

轮询分配，更均衡，但可能打乱原有分配。

## 3. Sticky 策略

尽量保持原有分配，减少 Rebalance 影响。

## 4. CooperativeSticky 策略

协作式粘性，逐步迁移，避免 Stop-the-World。

```java
props.put("partition.assignment.strategy", 
    "org.apache.kafka.clients.consumer.CooperativeStickyAssignor");
```

## 5. 优化建议

1. 使用 CooperativeSticky 策略
2. 合理设置 session.timeout.ms
3. 及时处理消息，避免 poll 超时
4. 使用静态成员 ID

```java
props.put("group.instance.id", "consumer-1");  // 静态成员
```

## 6. Range 策略详解

```
分区: [0, 1, 2, 3, 4, 5]
消费者: [C0, C1]

分配结果:
C0: [0, 1, 2]  (前 3 个)
C1: [3, 4, 5]  (后 3 个)
```

**问题**：当多个 Topic 使用 Range 策略时，可能导致分配不均衡。例如 Topic A 和 Topic B 都有 3 个分区：
```
C0: [TopicA-0, TopicA-1, TopicB-0, TopicB-1]  → 4 个分区
C1: [TopicA-2, TopicB-2]                      → 2 个分区
```

## 7. RoundRobin 策略详解

```
分区: [T0-P0, T0-P1, T0-P2, T1-P0, T1-P1, T1-P2]
消费者: [C0, C1]

分配结果:
C0: [T0-P0, T0-P2, T1-P1]  → 3 个分区
C1: [T0-P1, T1-P0, T1-P2]  → 3 个分区
```

RoundRobin 策略会将所有 Topic 的分区放在一起轮询，分配更均衡。

## 8. Sticky 策略详解

Sticky 策略在 Rebalance 时尽量保持原有分配，只迁移必要的分区：

```
Rebalance 前:
C0: [P0, P1, P2]
C1: [P3, P4, P5]

C2 加入后 (RoundRobin):
C0: [P0, P3]    ← P1, P2 被迁走
C1: [P1, P4]    ← P3 被迁走
C2: [P2, P5]

C2 加入后 (Sticky):
C0: [P0, P1]    ← 只迁走 P2
C1: [P3, P4]    ← 保持不变
C2: [P2, P5]    ← 获得 P2 和 P5
```

## 9. CooperativeSticky 策略详解

传统 Rebalance 是 Stop-the-World：所有消费者停止消费，重新分配，再恢复。CooperativeSticky 是逐步迁移：

```
第 1 轮 Rebalance:
1. 识别需要迁移的分区
2. 通知原消费者释放分区（停止消费这些分区）
3. 原消费者继续消费其他分区（不中断）

第 2 轮 Rebalance:
4. 新消费者获取迁移的分区
5. 其他分区不受影响
```

```java
// 配置协作式粘性分配
props.put("partition.assignment.strategy", 
    "org.apache.kafka.clients.consumer.CooperativeStickyAssignor");
```

## 10. 静态成员（Static Membership）

```java
// 每个消费者实例使用固定的 group.instance.id
props.put("group.instance.id", "consumer-" + instanceId);
```

**优势**：
- 消费者重启后（在 `session.timeout.ms` 内），不会触发 Rebalance。
- 保持原有分区分配，减少不必要的迁移。

**注意**：
- `group.instance.id` 在组内必须唯一。
- 消费者主动离开组时，需要发送 LeaveGroup 请求。

## 11. 最佳实践

1. **生产环境使用 CooperativeSticky 策略**：减少 Rebalance 期间的消费中断。
2. **使用静态成员 ID**：部署时为每个实例分配固定的 `group.instance.id`。
3. **合理设置超时参数**：
   - `session.timeout.ms` = 10s~30s
   - `heartbeat.interval.ms` = session.timeout / 3
   - `max.poll.interval.ms` = 根据最大处理时间设置
4. **监控 Rebalance 频率**：使用 JMX 指标 `rebalance-rate-per-hour`，频繁 Rebalance 说明配置有问题。
