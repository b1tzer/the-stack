# Rebalance 策略

> Rebalance 策略决定了分区如何分配给消费者。不同的策略在均衡性、迁移开销和实现复杂度上各有取舍。本章对比四种策略，并讲解静态成员机制。

## 1. 四种分配策略

| 策略 | Kafka 版本 | 特点 |
| :-- | :-- | :-- |
| Range | 0.8+ | 按范围分配，可能不均衡 |
| RoundRobin | 0.8+ | 轮询分配，更均衡 |
| Sticky | 0.11+ | 尽量保持原分配 |
| CooperativeSticky | 2.4+ | 协作式粘性，逐步迁移 |

## 2. Range 策略

按分区编号范围分配：

```text
分区: [0, 1, 2, 3, 4, 5]
消费者: [C0, C1]

分配结果:
C0: [0, 1, 2]  ← 前半部分
C1: [3, 4, 5]  ← 后半部分
```

多 Topic 时的问题：

```text
Topic A: [0, 1, 2]
Topic B: [0, 1, 2]
消费者: [C0, C1]

C0: [A-0, A-1, B-0, B-1]  → 4 个分区
C1: [A-2, B-2]            → 2 个分区（不均衡）
```

> Range 策略在单 Topic 时没问题，多 Topic 时可能导致分配不均衡。

## 3. RoundRobin 策略

把所有 Topic 的分区放在一起轮询：

```text
分区: [A-0, A-1, A-2, B-0, B-1, B-2]
消费者: [C0, C1]

分配结果:
C0: [A-0, A-2, B-1]  → 3 个分区
C1: [A-1, B-0, B-2]  → 3 个分区（均衡）
```

RoundRobin 的问题：Rebalance 时可能打乱原有分配，导致大量分区迁移。

## 4. Sticky 策略

在 RoundRobin 基础上增加「尽量保持原分配」的约束：

```text
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

Sticky 策略减少了不必要的分区迁移，降低 Rebalance 影响。

## 5. CooperativeSticky 策略

传统 Rebalance 是 Stop-the-World：所有消费者停止消费，重新分配，再恢复。

CooperativeSticky 是逐步迁移：

```text
第 1 轮 Rebalance：
1. 识别需要迁移的分区
2. 通知原消费者释放这些分区（停止消费这些分区）
3. 原消费者继续消费其他分区（不中断）

第 2 轮 Rebalance：
4. 新消费者获取迁移的分区
5. 其他分区不受影响
```

```java
props.put("partition.assignment.strategy",
    "org.apache.kafka.clients.consumer.CooperativeStickyAssignor");
```

| 维度 | 传统 Rebalance | CooperativeSticky |
| :-- | :-- | :-- |
| 消费中断 | 所有分区暂停 | 只有迁移的分区暂停 |
| 迁移开销 | 大（全部重分配） | 小（只迁移必要分区） |
| Rebalance 轮次 | 1 轮 | 2 轮 |
| 适用场景 | 小规模、低吞吐 | 大规模、高吞吐 |

## 6. 静态成员（Static Membership）

```java
props.put("group.instance.id", "consumer-" + instanceId);
```

### 6.1 动态成员 vs 静态成员

| 维度 | 动态成员 | 静态成员 |
| :-- | :-- | :-- |
| 标识 | Broker 分配的 Member ID | 客户端指定的 `group.instance.id` |
| 重启行为 | 触发 Rebalance | 在 `session.timeout.ms` 内不触发 |
| 适用场景 | 开发测试 | 生产部署 |

### 6.2 静态成员的工作原理

```text
Consumer-1（group.instance.id="consumer-1"）宕机
    │
    ▼
Coordinator 等待 session.timeout.ms（不是立即踢出）
    │
    ▼
Consumer-1 重启（相同的 group.instance.id）
    │
    ▼
Coordinator 识别为同一个成员，恢复原有分区分配
    │
    ▼
不触发 Rebalance
```

> 静态成员的核心价值：消费者短暂重启（如部署新版本）时，不会触发全局 Rebalance，其他消费者不受影响。

## 7. 策略选型

| 场景 | 推荐策略 |
| :-- | :-- |
| 单 Topic、简单场景 | Range 或 RoundRobin |
| 多 Topic、需要均衡 | RoundRobin |
| 高吞吐、减少迁移 | CooperativeSticky |
| 生产环境 | CooperativeSticky + 静态成员 |

## 8. 最佳实践

1. **生产环境使用 CooperativeSticky 策略**：减少 Rebalance 期间的消费中断。
2. **使用静态成员 ID**：部署时为每个实例分配固定的 `group.instance.id`。
3. **合理设置超时参数**：`session.timeout.ms` = 10s~30s，`heartbeat.interval.ms` = session.timeout / 3。
4. **监控 Rebalance 频率**：JMX 指标 `rebalance-rate-per-hour`，频繁 Rebalance 说明配置有问题。
