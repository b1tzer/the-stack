# 日志分段与索引

> 每个 Partition 落到磁盘上是一组分段文件与索引。本文是字节级参考，面向需要深入底层的读者。

## 磁盘布局

一个 Partition 对应一个目录，目录内以「分段」为单位分文件：

```txt
orders-0/
├── 00000000000000000000.log          ← 消息数据文件（FileRecords）
├── 00000000000000000000.index        ← 偏移量索引（OffsetIndex）
├── 00000000000000000000.timeindex    ← 时间戳索引（TimeIndex）
├── 00000000000000000000.snapshot     ← 生产者状态快照（幂等/事务）
├── 00000000000000000000.txnindex     ← 已中止事务范围（TransactionIndex）
├── 00000000000000001234.log
├── 00000000000000001234.index
├── 00000000000000001234.timeindex
├── 00000000000000005678.log          ← 当前活跃段
├── leader-epoch-checkpoint
├── partition.metadata
```

文件名的 20 位数字是该段的 base offset，左补零。

## 类关系

| 抽象 | 类 | 职责 |
| :-- | :-- | :-- |
| 分区日志 | `UnifiedLog` | 对外的 Partition 日志抽象 |
| 本地日志 | `LocalLog` | 只处理本地段的追加、读取、恢复 |
| 单个分段 | `LogSegment` | 管一组 `.log` + `.index` + `.timeindex` + `.txnindex` |
| 段的数据文件 | `FileRecords` | 对 `.log` 的字节读写与 sendfile 传输 |
| 偏移量索引 | `OffsetIndex` | offset → 文件位置 |
| 时间戳索引 | `TimeIndex` | timestamp → offset |
| 事务索引 | `TransactionIndex` | 记录已中止事务的 offset 范围 |

来源：[apache/kafka storage 模块](https://github.com/apache/kafka/tree/trunk/storage/src/main/java/org/apache/kafka/storage/internals/log)

## 索引条目结构

| 索引 | 条目结构 | 大小 |
| :-- | :-- | :-- |
| `OffsetIndex` | 4 字节 relative offset + 4 字节 physical position | 8 字节 |
| `TimeIndex` | 8 字节 timestamp + 4 字节 relative offset | 12 字节 |

用「相对 offset」而不是绝对 offset，是为了把每个条目控制在 8 字节内。

## 稀疏索引

Kafka 的索引只在写入若干字节后追加一条，不是每条消息都建。默认每 `log.index.interval.bytes = 4096` 字节写一条索引项。

### 查找过程

以「查 offset = 1234 的消息」为例：

```txt
1. 定位段：在 UnifiedLog 的 LogSegments 跳表里二分，找到 base offset ≤ 1234 的段
2. 查 OffsetIndex：把 1234 - baseOffset 作为目标相对 offset，二分查最大的 ≤ target 条目
   → 假设命中 (relativeOffset = 34, position = 8192)
3. 在 FileRecords 里从 position = 8192 开始顺序扫描 RecordBatch
   → 每读一批，比较 baseOffset + lastOffsetDelta 是否覆盖 1234
4. 命中后按 offsetDelta 定位到具体记录返回
```

顺序扫描的长度上界就是索引密度：默认 4096 字节内一定能找到目标。

### mmap 优化

索引文件通过 `MappedByteBuffer` 映射进进程虚拟地址空间，查索引不再走 read/write 系统调用。

## 分段滚动条件

| 条件 | Topic 配置 | 默认值 |
| :-- | :-- | :-- |
| 当前段字节数超过阈值 | `segment.bytes` | 1 GiB |
| 当前段存活时间超过阈值 | `segment.ms` | 7 天 |
| 索引文件写满 | `segment.index.bytes` | 10 MiB |
| 追加消息的相对 offset 无法用 int32 表示 | — | 硬性上限 |

来源：[Kafka 4.1 Topic Configs](https://kafka.apache.org/41/configuration/topic-configs)
