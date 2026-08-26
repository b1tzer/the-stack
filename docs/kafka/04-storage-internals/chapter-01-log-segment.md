# 日志分段与索引

## 1. 日志分段

```
topic-partition-0/
├── 00000000000000000000.log    # 第一个日志段
├── 00000000000000000000.index  # 偏移量索引
├── 00000000000000000000.timeindex  # 时间戳索引
├── 00000000000000001234.log    # 第二个日志段
├── 00000000000000001234.index
└── 00000000000000001234.timeindex
```

## 2. 索引结构

- 偏移量索引：Offset → 文件位置
- 时间戳索引：Timestamp → Offset

## 3. 日志清理策略

```properties
# 删除策略（默认）
log.retention.hours=168
log.retention.bytes=-1

# 压缩策略
log.cleanup.policy=compact
```

## 4. 日志压缩

- 保留每个 Key 的最新值
- 适合变更日志（Changelog）

## 5. 日志段管理

每个日志段由三个文件组成：
- `.log`：存储实际消息数据。
- `.index`：稀疏偏移量索引，将 Offset 映射到文件物理位置。
- `.timeindex`：时间戳索引，将时间戳映射到 Offset。

```bash
# 查看日志段详情
kafka-dump-log.sh --files /var/kafka-logs/my-topic-0/00000000000000000000.index
```

## 6. 索引查找过程

```
查找 Offset = 1234 的消息:

1. 在 .index 中二分查找 ≤ 1234 的最大 Offset
   → 找到 Offset=1200, Position=8192

2. 从 .log 文件的 Position=8192 开始顺序扫描
   → 逐条比较 Offset，找到 1234

3. 返回消息数据
```

**稀疏索引的优势**：
- 索引文件小，可以完全加载到内存。
- 顺序扫描速度快（磁盘顺序读取性能接近内存）。
- `log.index.interval.bytes`（默认 4KB）控制索引密度。

## 7. 日志清理策略详解

### 7.1 删除策略（Delete）

```properties
log.retention.hours=168          # 按时间保留（7天）
log.retention.bytes=-1           # 按大小保留（-1 表示不限制）
log.retention.check.interval.ms=300000  # 检查间隔（5分钟）
```

### 7.2 压缩策略（Compact）

```
原始日志:
Key1: Value1  (offset 0)
Key2: Value1  (offset 1)
Key1: Value2  (offset 2)  ← 更新 Key1
Key3: Value1  (offset 3)
Key2: Value2  (offset 4)  ← 更新 Key2

压缩后:
Key1: Value2  (offset 2)
Key2: Value2  (offset 4)
Key3: Value1  (offset 3)
```

```properties
log.cleanup.policy=compact
log.cleaner.min.compaction.lag.ms=0
log.cleaner.delete.retention.ms=86400000  # 删除标记保留 24 小时
```

## 8. 日志段滚动条件

日志段在以下条件下会滚动（创建新段）：
- 当前段大小超过 `log.segment.bytes`（默认 1GB）。
- 当前段的最大时间戳超过 `log.roll.ms`。
- 索引文件满。
- 使用了带时间戳的消息且时间戳超出当前段范围。

## 9. 最佳实践

1. **使用 SSD 存储**：虽然 Kafka 主要是顺序写入，但 SSD 在索引查找和日志恢复时表现更好。
2. **合理设置 log.segment.bytes**：太小会导致频繁创建新段，太大会影响日志清理效率。
3. **监控日志目录大小**：使用 `kafka-log-dirs.sh --describe` 检查各 Broker 的存储使用情况。
4. **Topic 使用 Compact 策略**：对于变更日志（如数据库 CDC），使用 `cleanup.policy=compact` 保留每个 Key 的最新值。
