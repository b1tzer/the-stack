# 日志分段与索引

> Kafka 的存储核心是追加日志（Append-Only Log）。每个 Partition 是一个有序的、不可变的消息序列，物理上由多个日志段（Segment）文件组成。本章讲解日志段的结构、索引机制、清理策略，以及「顺序写入为什么这么快」。

## 1. 日志分段

每个 Partition 的数据存储在一组日志段文件中：

```text
topic-partition-0/
├── 00000000000000000000.log        # 第一个日志段（base offset = 0）
├── 00000000000000000000.index      # 偏移量索引
├── 00000000000000000000.timeindex  # 时间戳索引
├── 00000000000000001234.log        # 第二个日志段（base offset = 1234）
├── 00000000000000001234.index
├── 00000000000000001234.timeindex
└── 00000000000000005678.log        # 第三个日志段（活跃段，正在写入）
```

文件名 = 该段的 base offset（起始偏移量），20 位数字，左补零。

### 1.1 日志段结构

每个 `.log` 文件由一系列 Record Batch 组成：

```text
┌──────────────────────────────────┐
│ Record Batch 1                   │
│   base offset = 0               │
│   records: [msg0, msg1, msg2]   │
├──────────────────────────────────┤
│ Record Batch 2                   │
│   base offset = 3               │
│   records: [msg3, msg4]         │
├──────────────────────────────────┤
│ Record Batch 3                   │
│   base offset = 5               │
│   records: [msg5]               │
└──────────────────────────────────┘
```

### 1.2 日志段滚动条件

当以下任一条件满足时，当前日志段关闭，创建新段：

| 条件 | 配置 | 默认值 |
| :-- | :-- | :-- |
| 段大小超过阈值 | `log.segment.bytes` | 1 GB |
| 段时间超过阈值 | `log.roll.ms` / `log.roll.hours` | 7 天 |
| 索引文件满 | `log.index.size.max.bytes` | 10 MB |
| 时间戳超出范围 | — | 自动判断 |

## 2. 索引机制

### 2.1 偏移量索引

偏移量索引（`.index`）是 Offset → 物理文件位置的映射，但不是每个 Offset 都有记录——它是**稀疏索引**：

```text
.index 文件内容：
Offset=0    → Position=0
Offset=100  → Position=8192
Offset=200  → Position=16384
Offset=300  → Position=24576
...
```

索引密度由 `log.index.interval.bytes`（默认 4KB）控制：每写入 4KB 数据添加一条索引记录。

### 2.2 查找过程

```text
查找 Offset = 1234 的消息：

1. 定位日志段：二分查找所有段的 base offset，找到包含 1234 的段
2. 查索引：在 .index 中二分查找 ≤ 1234 的最大 Offset
   → 找到 Offset=1200, Position=8192
3. 顺序扫描：从 .log 文件的 Position=8192 开始顺序读取
   → 逐条比较 Offset，找到 1234
4. 返回消息数据
```

为什么用稀疏索引？

| 维度 | 稠密索引（每条消息一个索引） | 稀疏索引（每 4KB 一个索引） |
| :-- | :-- | :-- |
| 索引大小 | 大（与消息量成正比） | 小（可完全加载到内存） |
| 查找精度 | 精确定位 | 需要顺序扫描一小段 |
| 内存占用 | 高 | 低 |
| 查找速度 | O(log n) | O(log n) + O(顺序扫描) |

稀疏索引的权衡：索引文件小到可以完全放内存，查找时先二分定位到附近，再顺序扫描一小段（磁盘顺序读极快）。

### 2.3 时间戳索引

时间戳索引（`.timeindex`）是 Timestamp → Offset 的映射：

```text
.timeindex 文件内容：
Timestamp=1712500000 → Offset=0
Timestamp=1712500100 → Offset=100
Timestamp=1712500200 → Offset=200
```

用途：`offsetsForTimes()` API——根据时间戳查找对应的 Offset，用于按时间回溯消费。

## 3. 顺序写入为什么快

Kafka 的高吞吐核心在于追加写入（Append-Only）：

```text
传统消息队列（随机写入）：
  B+ 树 / 链表 → 随机磁盘 IO → 100 MB/s（HDD）

Kafka（顺序写入）：
  追加日志 → 顺序磁盘 IO → 600 MB/s（HDD）/ 3 GB/s（SSD）
```

| 维度 | 随机写入 | 顺序写入 |
| :-- | :-- | :-- |
| 磁盘 IO | 寻道 + 旋转延迟 | 连续写入，无寻道 |
| 性能（HDD） | ~100 MB/s | ~600 MB/s |
| 性能（SSD） | ~500 MB/s | ~3 GB/s |
| 操作系统优化 | 无 | 预读、合并写入 |

> 顺序写入的性能接近内存随机写入。这是 Kafka 用磁盘存储却能达到百万级 QPS 的根本原因。

## 4. 日志清理策略

### 4.1 删除策略（Delete）

按时间或大小删除整个日志段：

```properties
log.retention.hours=168          # 保留 7 天（默认）
log.retention.bytes=-1           # 不限制大小
log.retention.check.interval.ms=300000  # 每 5 分钟检查一次
```

删除的是整个日志段（不是单条消息），所以段越大，删除粒度越粗。

### 4.2 压缩策略（Compact）

保留每个 Key 的最新值，删除旧版本：

```text
压缩前：                      压缩后：
Key1: Value1 (offset 0)       Key1: Value2 (offset 2)
Key2: Value1 (offset 1)       Key2: Value2 (offset 4)
Key1: Value2 (offset 2)       Key3: Value1 (offset 3)
Key3: Value1 (offset 3)
Key2: Value2 (offset 4)
```

适用场景：

| 场景 | 说明 |
| :-- | :-- |
| 数据库 CDC | Debezium 捕获变更，Kafka 保留每个 Key 的最新状态 |
| 事件溯源 | 保留实体的最新状态，用于重建 |
| 配置变更 | 保留配置项的最新值 |

```properties
log.cleanup.policy=compact
log.cleaner.min.compaction.lag.ms=0
log.cleaner.delete.retention.ms=86400000  # 删除标记保留 24 小时
```

## 5. 最佳实践

1. **使用 SSD 存储**：索引查找和日志恢复时 SSD 表现更好。
2. **合理设置 log.segment.bytes**：太小导致频繁创建新段，太大影响清理效率。
3. **监控日志目录大小**：`kafka-log-dirs.sh --describe` 检查存储使用。
4. **CDC 场景用 Compact 策略**：`cleanup.policy=compact` 保留每个 Key 的最新值。
