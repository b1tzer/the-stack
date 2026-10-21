# 磁盘空间不足

> 磁盘空间不足会导致 Broker 拒绝写入，影响整个集群的可用性。本文讲清排查和解决方法。

## 1. 现象

```txt
WARN Shutdown broker because all log dirs in /var/kafka-logs have failed
ERROR Disk error, dir: /var/kafka-logs
```

## 2. 排查

### Step 1：检查磁盘使用率与 inode

```bash
# 检查块空间
df -h /var/kafka-logs

# Filesystem      Size  Used Avail Use% Mounted on
# /dev/sda1       500G  480G   20G  96% /var/kafka-logs

# 检查 inode（inode 耗尽同样会导致无法写入）
df -i /var/kafka-logs
```

同时确认 `log.dirs` 各挂载点是否在线。磁盘挂载异常时，仅查看目录占用不足以定位问题。

### Step 2：定位磁盘占用来源

```bash
du -sh /var/kafka-logs/* | sort -rh | head -20
```

`du -sh /var/kafka-logs/*` 统计的是该目录下的直接子项。分区日志目录通常以 `topic-partition` 命名（如 `my-topic-0`），因此一个子目录对应一个分区而非整个 Topic，需汇总同一 Topic 各分区占用后再判断。

### Step 3：检查保留策略

```bash
kafka-configs.sh --describe --entity-type topics --entity-name my-topic \
    --bootstrap-server localhost:9092

# 关注：
# - retention.ms: 保留时间
# - retention.bytes: 保留大小
```

## 3. 解决方案

### 临时清理

```bash
# 按分区删除指定 offset 之前的记录
kafka-delete-records.sh --offset-json-file offsets.json \
    --bootstrap-server localhost:9092
```

`offsets.json` 格式：

```json
{
  "partitions": [
    {"topic": "my-topic", "partition": 0, "offset": -1}
  ],
  "version": 1
}
```

`offset` 表示删除该分区「该 offset 之前」的所有记录。`offset: -1` 是特殊值，表示以当前 high watermark 为删除边界，把该分区的逻辑起始 offset 推进到该位置；它不删除所有副本上的物理文件，也不保证调用后分区立刻没有可读记录。该操作按分区逐一执行，不会立即释放磁盘文件，实际空间回收仍受日志段清理周期影响。执行前需确认目标分区与 offset，并评估对消费的影响。

### 调整保留策略

```bash
# 缩短保留时间
kafka-configs.sh --alter --entity-type topics --entity-name my-topic \
    --add-config retention.ms=259200000 \
    --bootstrap-server localhost:9092

# 保留 3 天（259200000ms = 3天）
```

调整保留策略后，磁盘空间不会立即释放。按时间保留策略清理时，Kafka 以日志段（segment）为单位判断，通常要等整个日志段都超过保留时间才会被删除，回收速度受日志段滚动和清理周期（`log.retention.check.interval.ms`）影响。

### 长期方案

| 方案 | 说明 |
| :-- | :-- |
| 增加磁盘 | 扩容 Broker 的磁盘 |
| 使用 SSD | 提升 I/O 性能，需结合容量需求和成本评估 |
| 分散数据 | 增加 Broker，分散分区到更多节点 |
| 分层存储 | Kafka 3.6 以 Early Access 引入 Tiered Storage，3.9 起 Production Ready；将旧数据迁到对象存储，需自行提供 RemoteStorageManager 实现 |

## 4. 磁盘容量规划

```txt
磁盘容量 = 每日消息条数 × 消息大小 × 保留天数 × 副本因子 × 1.2（余量）
```

该公式是粗略估算，默认消息未压缩、流量稳定。实际规划应以实测压缩后的日志增长率计算各副本存储需求，并额外预留日志段清理延迟、分区分布不均、扩缩容和故障恢复期间的空间余量，最终通过 Broker 的实际磁盘增长数据校准。

## 5. 预防

- 监控磁盘使用率，设置告警阈值（如 > 80%）
- 合理配置保留策略，不要保留过长时间
- 定期检查大 Topic 的数据量
- 使用 `log.retention.bytes`（Broker 级每分区默认值，Topic 可用 `retention.bytes` 覆盖）做日志大小限制，注意它限制的是日志保留量，不是整个文件系统的硬容量上限
