# ACK 机制与可靠性保证

> ACK 机制是 Kafka 可靠性的基石。它控制消息写入多少副本后才算成功，直接决定了消息丢失的概率。本章从生产者、Broker、消费者三个维度讲清 Kafka 的端到端可靠性。

## 1. 端到端可靠性

消息从生产者到消费者，经过三个环节，每个环节都有可靠性配置：

```text
Producer → Broker → Consumer
   │          │          │
   ▼          ▼          ▼
  acks    副本机制    Offset 提交
```

| 环节 | 配置 | 作用 |
| :-- | :-- | :-- |
| 生产者 | `acks=all` | 消息写入所有 ISR 副本后才确认 |
| Broker | `min.insync.replicas=2` | ISR 至少 2 个副本，否则拒绝写入 |
| Broker | `unclean.leader.election.enable=false` | 禁止非 ISR 选举 |
| 消费者 | 手动提交 Offset | 处理完再提交，避免丢失 |

## 2. 三种 ACK 模式详解

### 2.1 acks=0

```text
Producer → Broker：发完即返回，不等待任何确认
```

| 维度 | 说明 |
| :-- | :-- |
| 可靠性 | 最低，消息可能丢失 |
| 吞吐量 | 最高 |
| 适用场景 | 日志收集、监控指标（允许丢失） |

### 2.2 acks=1

```text
Producer → Leader：写入本地日志
Leader → Producer：返回 ACK
（之后 Leader 宕机，Follower 未同步 → 数据丢失）
```

| 维度 | 说明 |
| :-- | :-- |
| 可靠性 | 中等，Leader 宕机可能丢数据 |
| 吞吐量 | 中等 |
| 适用场景 | 一般业务（可容忍极小概率丢失） |

### 2.3 acks=all

```text
Producer → Leader：写入本地日志
Leader → Follower1：Fetch 同步
Leader → Follower2：Fetch 同步
（所有 ISR 确认后）
Leader → Producer：返回 ACK
```

| 维度 | 说明 |
| :-- | :-- |
| 可靠性 | 最高（配合 min.insync.replicas） |
| 吞吐量 | 最低 |
| 适用场景 | 金融、订单等不能丢数据的场景 |

## 3. min.insync.replicas

```properties
min.insync.replicas=2
```

配合 `acks=all` 使用：如果 ISR 中的副本数 < `min.insync.replicas`，Broker 拒绝写入，返回 `NotEnoughReplicasException`。

```text
ISR = {Leader, F1, F2}（3 个）→ 正常写入
ISR = {Leader, F1}（2 个）→ 正常写入（刚好满足）
ISR = {Leader}（1 个）→ 拒绝写入（< min.insync.replicas）
```

> `min.insync.replicas=2` 保证至少有 2 个副本同步成功。即使 Leader 宕机，至少还有一个 Follower 有完整数据。

## 4. Unclean Leader 选举

当 ISR 为空时（所有副本都落后），是否从 OSR 中选举新 Leader？

```properties
unclean.leader.election.enable=false   # 推荐：禁止
```

| 策略 | 优势 | 风险 |
| :-- | :-- | :-- |
| 禁止 | 不丢数据 | 服务不可用直到 ISR 恢复 |
| 允许 | 服务可用 | OSR 副本可能丢数据 |

## 5. 消费者端可靠性

自动提交与手动提交的差异、自动提交丢消息的风险，见 [Offset 管理](../03-consumer/chapter-03-offset-management.md)。

## 6. 端到端可靠性配置

```properties
# 生产者
acks=all
enable.idempotence=true
retries=Integer.MAX_VALUE
min.insync.replicas=2

# Broker
unclean.leader.election.enable=false
default.replication.factor=3
min.insync.replicas=2

# 消费者
enable.auto.commit=false
isolation.level=read_committed  # 事务场景
```

## 7. 最佳实践

1. **acks=all + min.insync.replicas=2**：生产标配。
2. **禁用 Unclean Leader 选举**：宁可短暂不可用也不丢数据。
3. **手动提交 Offset**：处理完再提交，避免丢失。
4. **副本因子设为 3**：兼顾可靠性和存储开销。
5. **监控 UnderReplicatedPartitions**：该指标 > 0 说明有副本同步异常。
