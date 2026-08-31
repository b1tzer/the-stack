# ACK 与重试

> ACK 机制决定了 Producer 如何确认消息已被 Broker 接收。重试机制决定了发送失败后的恢复策略。

## 1. acks 参数

| 值 | 含义 | 可靠性 | 吞吐量 |
|------|------|--------|--------|
| 0 | 发送即忘，不等确认 | 最低 | 最高 |
| 1 | Leader 写入成功即确认 | 中 | 高 |
| all | ISR 中所有副本确认 | 最高 | 最低 |

```java
props.put("acks", "all");
```

### acks=0

```text
Producer ──发送──▶ Broker（不等确认）
```

- 最快，但消息可能丢（Leader 崩溃前未持久化）
- 适用于日志收集等可容忍丢失的场景

### acks=1

```text
Producer ──发送──▶ Leader 写入 ──确认──▶ Producer
```

- Leader 崩溃时，未同步到 Follower 的消息丢失
- 大多数场景的默认选择

### acks=all

```text
Producer ──发送──▶ Leader + ISR 所有副本确认 ──确认──▶ Producer
```

- 最可靠，但延迟最高
- 需要配合 `min.insync.replicas >= 2`

## 2. 重试机制

```java
props.put("retries", 100);
props.put("retry.backoff.ms", 100);
```

### 可重试的异常

| 异常 | 原因 | 可重试 |
|------|------|--------|
| NotLeaderForPartition | Leader 变更 | ✅ |
| LeaderNotAvailable | Leader 不可用 | ✅ |
| RequestTimedOut | 请求超时 | ✅ |
| NotEnoughReplicas | ISR 副本不足 | ✅ |
| RecordTooLarge | 消息太大 | ❌ |
| InvalidTopicException | Topic 无效 | ❌ |

### 幂等生产者

```java
props.put("enable.idempotence", true);
```

开启幂等后，即使重试也不会产生重复消息。Kafka 为每条消息分配 Producer ID + Sequence Number，Broker 自动去重。

## 3. 最佳实践

1. **acks=all + min.insync.replicas=2**：可靠性和性能的平衡
2. **开启幂等**：`enable.idempotence=true`
3. **设置合理的重试次数**：10-100
4. **处理不可重试异常**：记录日志，人工处理
5. **设置 delivery.timeout.ms**：总超时（包含重试时间）
