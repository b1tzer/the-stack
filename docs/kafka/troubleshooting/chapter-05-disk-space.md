# 磁盘空间不足

> 磁盘空间不足会导致 Broker 拒绝写入，影响整个集群的可用性。本文讲清排查和解决方法。

## 1. 现象

```txt
WARN Shutdown broker because all log dirs in /var/kafka-logs have failed
ERROR Disk error, dir: /var/kafka-logs
```

## 2. 排查

### Step 1：检查磁盘使用率

```bash
df -h /var/kafka-logs

# Filesystem      Size  Used Avail Use% Mounted on
# /dev/sda1       500G  480G   20G  96% /var/kafka-logs
```

### Step 2：检查各 Topic 的磁盘占用

```bash
du -sh /var/kafka-logs/* | sort -rh | head -20
```

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
# 删除指定 Topic 的旧数据
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

`offset: -1` 表示删除所有数据。

### 调整保留策略

```bash
# 缩短保留时间
kafka-configs.sh --alter --entity-type topics --entity-name my-topic \
    --add-config retention.ms=259200000 \
    --bootstrap-server localhost:9092

# 保留 3 天（259200000ms = 3天）
```

### 长期方案

| 方案 | 说明 |
| :-- | :-- |
| 增加磁盘 | 扩容 Broker 的磁盘 |
| 使用 SSD | 更高的 I/O 性能和更大的容量 |
| 分散数据 | 增加 Broker，分散分区到更多节点 |
| 分层存储 | Kafka 3.0+ 支持将旧数据迁移到对象存储 |

## 4. 磁盘容量规划

```txt
磁盘容量 = 每日消息量 × 消息大小 × 保留天数 × 副本因子 × 1.2（余量）
```

## 5. 预防

- 监控磁盘使用率，设置告警阈值（如 > 80%）
- 合理配置保留策略，不要保留过长时间
- 定期检查大 Topic 的数据量
- 使用 `log.retention.bytes` 做每分区的大小限制
