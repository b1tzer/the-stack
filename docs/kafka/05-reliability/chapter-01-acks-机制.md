# ACK 机制

## 1. acks 配置

| acks | 说明 | 可靠性 | 吞吐量 |
|------|------|--------|--------|
| 0 | 不等待确认 | 低 | 高 |
| 1 | Leader 确认 | 中 | 中 |
| all | ISR 全部确认 | 高 | 低 |

## 2. 数据丢失场景

```properties
# acks=1 时
Leader 写入成功 → 返回确认 → Leader 宕机 → Follower 未同步 → 数据丢失

# 解决：acks=all + min.insync.replicas=2
```

## 3. 配置建议

```properties
# 高可靠配置
acks=all
min.insync.replicas=2
retries=Integer.MAX_VALUE
enable.idempotence=true
```

## 4. ACK 机制工作原理

```
acks=0:
Producer → 发送 → Broker（不等待确认）→ 完成
风险：消息可能丢失（网络故障、Broker 宕机）

acks=1:
Producer → 发送 → Leader 写入 → 返回 ACK → 完成
风险：Leader 宕机后，未同步到 Follower 的消息丢失

acks=all:
Producer → 发送 → Leader 写入 → ISR 全部同步 → 返回 ACK → 完成
保障：只要 ISR 中有 1 个存活，消息就不会丢失
```

## 5. min.insync.replicas 详解

```properties
# 场景：3 个 Broker，副本因子 3，min.insync.replicas=2

# 正常情况：ISR = [Broker1, Broker2, Broker3]
# acks=all → 3 个副本都同步成功 → 返回 ACK

# Broker3 宕机：ISR = [Broker1, Broker2]
# acks=all → 2 个副本同步成功 → 返回 ACK（仍然可用）

# Broker2 也宕机：ISR = [Broker1]
# ISR 数量 < min.insync.replicas → 拒绝写入！
# 抛出 NotEnoughReplicasException
```

## 6. 数据丢失场景与解决方案

| 场景 | 原因 | 解决方案 |
|------|------|----------|
| Leader 宕机丢数据 | acks=1，Follower 未同步 | acks=all + min.insync.replicas=2 |
| 消费者丢数据 | 自动提交，处理前崩溃 | 手动提交 Offset |
| Unclean Leader 选举 | 非 ISR 成为 Leader | unclean.leader.election.enable=false |
| 网络分区 | ISR 收缩到 0 | 监控 ISR，设置合理的超时 |

## 7. 完整的高可靠配置

```properties
# 生产者
acks=all
retries=Integer.MAX_VALUE
enable.idempotence=true
max.in.flight.requests.per.connection=5

# Broker
min.insync.replicas=2
unclean.leader.election.enable=false
replication.factor=3
default.replication.factor=3

# 消费者
enable.auto.commit=false
isolation.level=read_committed
```

## 8. 可靠性 vs 性能权衡

| 配置 | 可靠性 | 吞吐量 | 延迟 |
|------|--------|--------|------|
| acks=0 | 最低 | 最高 | 最低 |
| acks=1 | 中 | 中 | 中 |
| acks=all + min.insync.replicas=1 | 高 | 中 | 中 |
| acks=all + min.insync.replicas=2 | 最高 | 较低 | 较高 |

## 9. 最佳实践

1. **生产环境使用 acks=all + min.insync.replicas=2**：这是平衡可靠性和性能的最佳配置。
2. **禁用 Unclean Leader 选举**：宁可服务不可用，也不要数据丢失。
3. **监控 NotEnoughReplicasException**：频繁出现说明集群容量不足。
4. **定期检查副本分布**：使用 `kafka-reassign-partitions.sh` 确保副本均匀分布。
