# 数据保留

> 数据保留策略决定了消息在 Kafka 中存多久、占多少磁盘空间。本章讲清删除策略和压缩策略，以及如何根据业务场景选择合适的保留方案。

## 1. 保留策略类型

| 策略 | 配置 | 说明 |
| :-- | :-- | :-- |
| 删除（Delete） | `log.cleanup.policy=delete` | 按时间或大小删除整个日志段 |
| 压缩（Compact） | `log.cleanup.policy=compact` | 保留每个 Key 的最新值 |
| 混合 | `log.cleanup.policy=delete,compact` | 先压缩，再按时间删除 |

## 2. 删除策略

### 2.1 按时间保留

```properties
log.retention.hours=168          # 保留 7 天（默认）
log.retention.minutes=...        # 更细粒度
log.retention.ms=...             # 最细粒度
```

### 2.2 按大小保留

```properties
log.retention.bytes=-1           # 不限制（默认）
log.retention.bytes=1073741824   # 每个分区最多保留 1GB
```

> `log.retention.bytes` 是每个分区的限制，不是整个 Topic。如果 Topic 有 10 个分区，总保留大小 = 10 × 1GB = 10GB。

### 2.3 删除的是日志段

Kafka 删除的是整个日志段（Segment），不是单条消息：

```text
Segment 0 (0~999)   → 已过期 → 整个删除
Segment 1 (1000~1999) → 已过期 → 整个删除
Segment 2 (2000~2999) → 未过期 → 保留
```

日志段越大，删除粒度越粗。默认 1GB 一个段，所以即使过期了也可能多保留一些数据。

## 3. 压缩策略

### 3.1 原理

保留每个 Key 的最新值，删除旧版本：

```text
压缩前：                      压缩后：
Key1: Value1 (offset 0)       Key1: Value3 (offset 4)  ← 最新
Key2: Value1 (offset 1)       Key2: Value2 (offset 3)  ← 最新
Key1: Value2 (offset 2)       Key3: Value1 (offset 5)  ← 唯一
Key2: Value2 (offset 3)
Key1: Value3 (offset 4)
Key3: Value1 (offset 5)
```

### 3.2 适用场景

| 场景 | 说明 |
| :-- | :-- |
| 数据库 CDC | Debezium 捕获变更，保留每个 Key 的最新状态 |
| 事件溯源 | 保留实体的最新状态 |
| 配置变更 | 保留配置项的最新值 |
| Session 存储 | 保留每个 Session 的最新数据 |

### 3.3 配置

```properties
log.cleanup.policy=compact
log.cleaner.min.compaction.lag.ms=0     # 最小压缩延迟
log.cleaner.delete.retention.ms=86400000 # 删除标记保留 24 小时
log.segment.bytes=1073741824             # 日志段大小
```

### 3.4 Tombstone（墓碑消息）

```java
// 发送 null value 的消息作为删除标记
producer.send(new ProducerRecord<>("topic", key, null));
```

墓碑消息在压缩后保留 `log.cleaner.delete.retention.ms` 时间，之后被清理。

## 4. 保留方案选型

| 场景 | 推荐策略 | 说明 |
| :-- | :-- | :-- |
| 日志收集 | Delete（按时间） | 保留 7~30 天 |
| 事件驱动 | Delete（按时间） | 保留业务需要的时间 |
| CDC | Compact | 保留每个 Key 的最新状态 |
| 事件溯源 | Compact + Delete | 压缩保留最新，按时间清理旧数据 |
| Session 存储 | Compact | 保留每个 Session 最新数据 |

## 5. 磁盘容量规划

```text
磁盘容量 = 每日消息量 × 消息大小 × 保留天数 × 副本因子 × 1.2（余量）

示例：
  每日 1 亿条消息，每条 1KB，保留 7 天，3 副本
  = 1亿 × 1KB × 7 × 3 × 1.2
  = 2.52 TB
```

## 6. 最佳实践

1. **日志场景用 Delete 策略**：按时间保留，7~30 天。
2. **CDC 场景用 Compact 策略**：保留每个 Key 的最新状态。
3. **监控磁盘使用率**：`kafka-log-dirs.sh --describe` 检查各 Broker 存储。
4. **合理规划保留时间**：保留越长，磁盘成本越高。
5. **log.retention.bytes 做兜底**：防止单分区数据无限增长。
