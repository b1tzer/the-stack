# 副本机制

> Kafka 的副本机制保证数据不丢失。每个分区有多个副本分布在不同 Broker 上，Leader 处理读写，Follower 同步数据。ISR（In-Sync Replicas）是副本管理的核心概念。本章讲清 ISR 的工作原理、Leader 选举和生产配置。

## 1. 副本角色

| 角色 | 职责 | 数量 |
| :-- | :-- | :-- |
| Leader | 处理该分区的所有读写请求 | 每个分区 1 个 |
| Follower | 从 Leader 拉取数据同步，不处理客户端请求 | 0~N 个 |
| ISR | 与 Leader 保持同步的 Follower 集合 + Leader | 动态变化 |
| OSR | 落后于 Leader 的 Follower | 动态变化 |

```text
Partition 0 的副本分布：
  Broker 1: Leader（处理读写）
  Broker 2: Follower（同步数据）
  Broker 3: Follower（同步数据）

  ISR = {Broker1, Broker2, Broker3}（全部同步正常）
  OSR = {}（无落后副本）
```

## 2. LEO 与 HW

每个副本维护两个关键偏移量：

| 概念 | 全称 | 说明 |
| :-- | :-- | :-- |
| LEO | Log End Offset | 该副本日志末尾的下一条 Offset（即将写入的位置） |
| HW | High Watermark | ISR 中所有副本 LEO 的最小值（消费者可见的最大 Offset） |

```text
Leader LEO = 100（已写入到 offset 99，下一条是 100）
Follower1 LEO = 98（落后 2 条）
Follower2 LEO = 100（已同步）

HW = min(100, 98, 100) = 98
消费者只能读到 offset 0~97 的消息
```

> 消费者只能读到 HW 之前的消息。HW 以下的消息才是「已提交」的——这保证了消费者不会读到可能丢失的数据。

## 3. 副本同步流程

```text
1. Producer 发送消息到 Leader
2. Leader 写入本地日志，更新 LEO
3. Follower 发送 Fetch 请求到 Leader（每秒至少一次）
4. Leader 返回新消息给 Follower
5. Follower 写入本地日志，更新 LEO
6. Leader 更新 HW = min(所有 ISR 的 LEO)
7. HW 之前的消息对消费者可见
```

### 3.1 Fetch 请求

Follower 通过 Fetch 请求从 Leader 拉取数据：

```text
Follower → Leader：FetchRequest(partition=0, fetch_offset=95)
Leader → Follower：FetchResponse(records=[offset95, offset96, offset97])
```

Fetch 请求的双重作用：

| 作用 | 说明 |
| :-- | :-- |
| 数据同步 | Follower 拉取新消息 |
| 心跳 | Leader 通过 Fetch 请求判断 Follower 是否存活 |

## 4. ISR 动态调整

### 4.1 移出 ISR

当 Follower 超过 `replica.lag.time.max.ms`（默认 30 秒）没有发送 Fetch 请求，或 Fetch 进度落后太多，Leader 将其移出 ISR：

```text
正常：ISR = {Leader, F1, F2}
F2 变慢（30 秒没 Fetch）：ISR = {Leader, F1}（F2 移出）
```

### 4.2 加回 ISR

Follower 恢复 Fetch 且追上 Leader 的 HW 后，重新加入 ISR：

```text
F2 恢复同步、LEO ≥ HW：ISR = {Leader, F1, F2}（F2 加回）
```

### 4.3 ISR 收缩的危险

```text
ISR = {Leader}（只剩 Leader 一个）
acks=all → 等同于 acks=1
Leader 宕机 → 数据丢失
```

缓解措施：

```properties
min.insync.replicas=2   # ISR 至少 2 个副本，否则拒绝写入
```

## 5. Leader 选举

### 5.1 正常选举

Leader 宕机后，Controller 从 ISR 中选择新 Leader：

```text
ISR = {Leader(Broker1), F1(Broker2), F2(Broker3)}
Broker1 宕机 → Controller 从 ISR 中选 Broker2 为新 Leader
```

### 5.2 Unclean Leader 选举

ISR 为空时（所有副本都落后），是否从 OSR 中选举？

```properties
unclean.leader.election.enable=false   # 默认：禁止（安全但不可用）
unclean.leader.election.enable=true    # 允许（可用但可能丢数据）
```

| 策略 | 优势 | 风险 |
| :-- | :-- | :-- |
| 禁止 Unclean | 不丢数据 | 服务不可用直到 ISR 恢复 |
| 允许 Unclean | 服务可用 | OSR 中的副本可能丢数据 |

> 生产环境推荐 `unclean.leader.election.enable=false`，宁可短暂不可用也不要丢数据。

### 5.3 Leader 均衡

```properties
auto.leader.rebalance.enable=true
leader.imbalance.per.broker.percentage=10
```

当分区 Leader 分布不均衡（某 Broker 的 Leader 比例超过平均值 10%）时，自动触发 Leader 重分配。

## 6. 副本分配策略

创建 Topic 时的副本分配规则：

| 规则 | 说明 |
| :-- | :-- |
| 副本分散 | 同一分区的副本分布在不同 Broker 上 |
| Leader 均衡 | 分区 Leader 尽量均匀分布在各 Broker |
| Rack Awareness | 配置 `broker.rack`，副本分布在不同机架 |

```bash
kafka-topics.sh --create --topic my-topic \
    --partitions 6 --replication-factor 3 \
    --bootstrap-server localhost:9092
```

## 7. 配置参考

| 配置 | 默认值 | 建议 | 说明 |
| :-- | :-- | :-- | :-- |
| `replication.factor` | 1 | 3 | 副本因子 |
| `min.insync.replicas` | 1 | 2 | 最小 ISR 数 |
| `acks` | 1 | all | 生产者确认模式 |
| `replica.lag.time.max.ms` | 30000 | 30000 | 同步超时时间 |
| `unclean.leader.election.enable` | false | false | 禁止 Unclean 选举 |
| `auto.leader.rebalance.enable` | true | true | 自动 Leader 均衡 |

## 8. 最佳实践

1. **副本因子设为 3**：兼顾可靠性和存储开销。
2. **min.insync.replicas = 2**：配合 `acks=all`，保证至少 2 个副本同步成功。
3. **禁用 Unclean Leader 选举**：避免数据丢失。
4. **监控 UnderReplicatedPartitions**：该指标 > 0 说明有副本同步异常。
5. **使用 Rack Awareness**：副本分布在不同机架，提高容灾能力。
