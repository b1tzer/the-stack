# 副本机制

## 1. 副本角色

- Leader：处理读写请求
- Follower：同步 Leader 数据
- ISR：与 Leader 保持同步的副本集

## 2. ISR 机制

```properties
# ISR 最小副本数
min.insync.replicas=2

# 同步超时
replica.lag.time.max.ms=30000
```

## 3. Leader 选举

```properties
# 自动 Leader 平衡
auto.leader.rebalance.enable=true
leader.imbalance.per.broker.percentage=10
```

## 4. 数据同步

```
Producer → Leader → Follower1
                  → Follower2
                  → Follower3
```

- acks=all 时，需要 ISR 全部确认
- ISR 数量不足时，可能拒绝写入

## 5. 副本同步机制详解

```
Producer 发送消息到 Leader
    │
    ▼
Leader 写入本地日志
    │
    ▼
Follower 发送 Fetch 请求到 Leader
    │
    ├── Follower1 拉取成功 → 更新 LEO
    ├── Follower2 拉取成功 → 更新 LEO
    └── Follower3 拉取落后 → 移出 ISR
    │
    ▼
当 ISR 中所有副本都同步完成 → 更新 HW
    │
    ▼
Producer 收到 ACK
```

**关键概念**：
- **LEO (Log End Offset)**：每个副本的最新消息 Offset。
- **HW (High Watermark)**：ISR 中所有副本 LEO 的最小值，消费者只能读取 HW 之前的消息。

## 6. ISR 收缩与扩展

```properties
# 副本落后判定
replica.lag.time.max.ms=30000  # 30 秒未同步则移出 ISR

# ISR 最小副本数
min.insync.replicas=2  # ISR 中至少 2 个副本
```

**ISR 收缩的场景**：
- Follower 所在 Broker 负载过高，拉取速度变慢。
- 网络延迟导致 Follower 无法及时拉取。
- Follower 所在磁盘 I/O 瓶颈。

**监控 ISR 收缩**：
```bash
kafka-topics.sh --describe --topic my-topic --bootstrap-server localhost:9092
# 关注 Isr 字段是否与 Replicas 一致
```

## 7. Leader 选举策略

```properties
# 自动 Leader 平衡
auto.leader.rebalance.enable=true
leader.imbalance.per.broker.percentage=10  # 不均衡超过 10% 触发重平衡
```

**选举优先级**：
1. 优先从 ISR 中选举新 Leader。
2. 如果 `unclean.leader.election.enable=true`，可以从非 ISR 中选举（可能丢数据）。

```properties
# 禁止非 ISR 选举（推荐）
unclean.leader.election.enable=false
```

## 8. 副本分配策略

```bash
# 创建 Topic 时的副本分配
kafka-topics.sh --create --topic my-topic \
    --partitions 6 --replication-factor 3 \
    --bootstrap-server localhost:9092
```

分配规则：
- 同一分区的副本分布在不同 Broker 上。
- 使用 Rack Awareness 时，副本分布在不同机架上。
- 分区 Leader 尽量均匀分布在各 Broker 上。

## 9. 最佳实践

1. **副本因子设为 3**：兼顾可靠性和存储开销。
2. **min.insync.replicas = 2**：配合 `acks=all`，保证至少 2 个副本同步成功。
3. **禁用 Unclean Leader 选举**：`unclean.leader.election.enable=false`，避免数据丢失。
4. **监控 UnderReplicatedPartitions**：该指标大于 0 说明有副本同步异常。
5. **使用 Rack Awareness**：配置 `broker.rack`，让副本分布在不同机架，提高容灾能力。
