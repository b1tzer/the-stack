# 数据保留策略

## 1. 时间保留

```properties
log.retention.hours=168        # 7天（默认）
log.retention.minutes=10080
log.retention.ms=604800000
```

## 2. 大小保留

```properties
log.retention.bytes=-1         # 不限制（默认）
log.segment.bytes=1073741824   # 1GB
```

## 3. 日志压缩

```properties
log.cleanup.policy=compact     # 压缩策略
log.cleaner.min.compaction.lag.ms=0
log.cleaner.max.compaction.lag.ms=9223372036854775807
```

适合场景：变更日志（Changelog），保留每个 Key 最新值。

## 4. 混合策略

```properties
log.cleanup.policy=delete,compact
```

## 5. 日志压缩详解

日志压缩（Log Compaction）保留每个 Key 的最新值，适用于变更日志场景：

```
原始日志（按时间顺序）：
Offset 0: Key=User:1, Value={name: "Alice", age: 25}
Offset 1: Key=User:2, Value={name: "Bob", age: 30}
Offset 2: Key=User:1, Value={name: "Alice", age: 26}  ← 更新
Offset 3: Key=User:3, Value={name: "Charlie", age: 35}
Offset 4: Key=User:2, Value={name: "Bob", age: 31}    ← 更新

压缩后：
Offset 2: Key=User:1, Value={name: "Alice", age: 26}
Offset 4: Key=User:2, Value={name: "Bob", age: 31}
Offset 3: Key=User:3, Value={name: "Charlie", age: 35}
```

**使用场景**：
- 数据库 CDC（变更数据捕获）：保留每行的最新状态。
- 配置变更日志：保留每个配置项的最新值。
- 用户状态：保留每个用户的最新状态。

## 6. 删除标记（Tombstone）

```java
// 发送删除标记
producer.send(new ProducerRecord<>("user-state", "user-123", null));
// null value 表示删除该 Key
```

删除标记的保留时间：
```properties
log.cleaner.delete.retention.ms=86400000  # 24 小时后物理删除
```

## 7. 保留策略配置详解

```properties
# 全局配置
log.retention.hours=168              # 默认 7 天
log.retention.bytes=-1               # 默认不限制大小

# Topic 级别配置（覆盖全局）
kafka-configs.sh --alter --entity-type topics --entity-name my-topic \
    --add-config retention.ms=86400000  # 1 天

# 段文件配置
log.segment.bytes=1073741824         # 1GB，段文件大小
log.segment.ms=604800000             # 7 天，段文件最大时间
```

## 8. 保留策略选择指南

| 场景 | 策略 | 配置 |
|------|------|------|
| 日志/事件 | 按时间删除 | `log.retention.hours=168` |
| 审计日志 | 按大小删除 | `log.retention.bytes=107374182400` (100GB) |
| 变更日志 | 压缩 | `log.cleanup.policy=compact` |
| 事件 + 变更日志 | 混合 | `log.cleanup.policy=delete,compact` |
| 永久保留 | 不删除 | `log.retention.bytes=-1, log.retention.ms=-1` |

## 9. 手动删除消息

```bash
# 创建删除计划文件
cat > delete-records.json << 'EOF'
{
  "partitions": [
    {"topic": "my-topic", "partition": 0, "offset": 1000}
  ],
  "version": 1
}
EOF

# 执行删除
kafka-delete-records.sh --offset-json-file delete-records.json \
    --bootstrap-server localhost:9092
```

## 10. 最佳实践

1. **根据业务需求设置保留时间**：不要使用默认的 7 天，根据数据重要性和存储成本调整。
2. **监控磁盘使用率**：设置告警，避免磁盘写满导致 Broker 宕机。
3. **使用 Topic 级别配置**：不同 Topic 设置不同的保留策略，而不是全局统一。
4. **CDC 场景使用 Compact 策略**：保留每个 Key 的最新值，避免历史数据堆积。
