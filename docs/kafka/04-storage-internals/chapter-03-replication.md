# 副本机制

> Kafka 的副本机制保证了数据的高可用。理解 ISR（In-Sync Replicas）是理解 Kafka 可靠性的关键。

## 1. 副本结构

```text
Topic: orders (replication-factor=3)

Partition 0:
  Leader (Broker 1)    ← 所有读写
  Follower (Broker 2)  ← 从 Leader 同步
  Follower (Broker 3)  ← 从 Leader 同步
```

## 2. ISR（In-Sync Replicas）

ISR 是与 Leader 保持同步的副本集合。

```text
ISR = {Leader, Follower1, Follower2}

如果 Follower2 同步落后太多（replica.lag.time.max.ms = 30s）：
  ISR = {Leader, Follower1}  ← Follower2 被踢出
  Follower2 追上后重新加入 ISR
```

### ISR 的意义

- **acks=all 时**：需要 ISR 中所有副本确认才算写入成功
- **Leader 故障时**：新 Leader 只从 ISR 中选举
- ISR 越大，可靠性越高，但写入延迟也越高

## 3. Leader 选举

```text
Leader (Broker 1) 故障
  → Controller 从 ISR 中选择新 Leader
  → 新 Leader = Broker 2
  → Producer/Consumer 自动切换到新 Leader
```

### unclean.leader.election.enable

| 值 | 行为 | 风险 |
|------|------|------|
| false（默认） | 只从 ISR 中选举 | ISR 为空时分区不可用 |
| true | 可以从非 ISR 中选举 | 可能丢失数据 |

**生产环境必须设为 false**。

## 4. 副本同步流程

```text
1. Follower 向 Leader 发送 Fetch 请求
2. Leader 返回从 Follower 当前 offset 开始的消息
3. Follower 写入本地日志，更新 offset
4. 重复 1-3

Leader 维护每个 Follower 的 LEO（Log End Offset）
  → 所有副本中最小的 LEO = HW（High Watermark）
  → Consumer 只能读到 HW 之前的消息
```

## 5. HW（High Watermark）

```text
Leader LEO = 100
Follower1 LEO = 98
Follower2 LEO = 95

HW = min(100, 98, 95) = 95

Consumer 只能读到 offset < 95 的消息
```

HW 保证了 Consumer 不会读到未同步到所有副本的消息。

## 6. 可靠性配置

```properties
# Broker 端
default.replication.factor=3
min.insync.replicas=2
unclean.leader.election.enable=false

# Producer 端
acks=all
retries=Integer.MAX_VALUE
enable.idempotence=true
```

### 配置组合

| acks | min.insync.replicas | 可靠性 | 性能 |
|------|-------------------|--------|------|
| 1 | 1 | 低（Leader 崩溃丢数据） | 最高 |
| all | 1 | 中（ISR 只有 Leader 时退化为 acks=1） | 高 |
| all | 2 | 高（至少 2 副本确认） | 中 |
| all | 3 | 最高（所有副本确认） | 低 |
