# 日志分段与索引

> 每个 Partition 落到磁盘上是一组分段文件与索引。本章从磁盘布局出发，追到 `LogSegment` / `OffsetIndex` 的字段与调用链，解释「为什么按 offset 查一条消息只需要一次二分加一小段顺序扫描」。

## 1. 磁盘布局

一个 Partition 对应一个目录，目录内以「分段」为单位分文件。以 `orders-0` 为例：

```text
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
├── leader-epoch-checkpoint           ← (epoch, startOffset) 记录
├── partition.metadata                ← topic id、格式版本
```

文件名的 20 位数字是该段的 base offset，左补零；同一段的三类文件共用同一个 base offset 作为文件名前缀。

分段与索引背后是一组固定的类，都位于 `storage/src/main/java/org/apache/kafka/storage/internals/log/`：

| 抽象 | 类 | 职责 |
| :-- | :-- | :-- |
| 分区日志（本地+远程视图） | `UnifiedLog` | 对外的 Partition 日志抽象 |
| 本地日志 | `LocalLog` | 只处理本地段的追加、读取、恢复 |
| 单个分段 | `LogSegment` | 管一组 `.log` + `.index` + `.timeindex` + `.txnindex` |
| 段的数据文件 | `FileRecords` | 对 `.log` 的字节读写与 `sendfile` 传输 |
| 偏移量索引 | `OffsetIndex` | offset → 文件位置 |
| 时间戳索引 | `TimeIndex` | timestamp → offset |
| 事务索引 | `TransactionIndex` | 记录已中止事务的 offset 范围 |

`UnifiedLog` 内部按 base offset 维护一个跳表（`LogSegments`）保存全部段；末尾的段被称为 active segment，只有它可写。

来源：[apache/kafka storage 模块](https://github.com/apache/kafka/tree/trunk/storage/src/main/java/org/apache/kafka/storage/internals/log)、[DeepWiki: Log Management and Storage](https://deepwiki.com/apache/kafka/2.4-remote-storage-and-tiered-storage)

## 2. `.log` 文件里存的是什么：RecordBatch v2

`.log` 不是「一条条消息」，而是「一批批 RecordBatch」。Kafka 0.11 起使用 v2 格式（`magic = 2`），KIP-98 引入，包含幂等与事务所需字段。一批的头部固定 61 字节，后面跟变长 `Record[]`：

```text
偏移(字节)  长度  字段                       说明
  0        8    baseOffset                该批第一条消息的绝对 offset
  8        4    batchLength               从 partitionLeaderEpoch 到末尾的字节数
 12        4    partitionLeaderEpoch      KIP-101：Broker 收到时写入
 16        1    magic                     固定 2
 17        4    crc                       CRC-32C（Castagnoli）
 21        2    attributes                低 3 位=压缩算法（0 none/1 gzip/2 snappy/3 lz4/4 zstd）
                                          bit 3=timestampType, bit 4=isTransactional
                                          bit 5=isControlBatch, bit 6=hasDeleteHorizonMs
 23        4    lastOffsetDelta           该批最后一条相对 baseOffset 的偏移
 27        8    baseTimestamp             该批第一条时间戳
 35        8    maxTimestamp              该批最大时间戳
 43        8    producerId                KIP-98
 51        2    producerEpoch             KIP-98
 53        4    baseSequence              KIP-98
 57        4    recordCount               该批消息数
 61        …    records[]                 变长记录数组
```

字节偏移量在 `DefaultRecordBatch` 中以常量形式定义：`BASE_OFFSET_OFFSET = 0`、`LENGTH_OFFSET = 8`、`PARTITION_LEADER_EPOCH_OFFSET = 12`、`MAGIC_OFFSET = 16`、`CRC_OFFSET = 17`、`ATTRIBUTES_OFFSET = 21` …… 与上表一致。

来源：[Kafka 3.7 官方 Message Format](https://kafka.apache.org/37/implementation/message-format)、[DefaultRecordBatch.java](https://github.com/apache/kafka/blob/trunk/clients/src/main/java/org/apache/kafka/common/record/DefaultRecordBatch.java)

CRC 覆盖 attributes 之后的所有字节，位置在 magic 之后，因此客户端解析 CRC 前必须先读 magic 决定格式。`partitionLeaderEpoch` 不参与 CRC 计算——它由 Broker 在收到 Produce 请求时才写入，若纳入 CRC 每次都要重算，代价过高。

批内的每条 `Record` 使用 varint 编码，只存相对量：

```text
length          varint
attributes      int8    （目前未用）
timestampDelta  varlong  相对 baseTimestamp
offsetDelta    varint    相对 baseOffset
keyLength       varint
key             bytes
valueLength     varint
value           bytes
headers[]       Header 数组（KIP-82，0.11 引入）
```

同批内共享 producerId / baseTimestamp / baseOffset，每条只写增量，压缩比明显高于逐条独立编码。

## 3. 分段何时滚动

`UnifiedLog#roll` 决定是否创建新段，触发条件如下（对应 topic 配置项与 broker 默认项）：

| 条件 | Topic 配置 | 默认值 |
| :-- | :-- | :-- |
| 当前段字节数超过阈值 | `segment.bytes` / `log.segment.bytes` | 1073741824（1 GiB） |
| 当前段存活时间超过阈值 | `segment.ms` / `log.roll.ms` / `log.roll.hours` | 7 天 |
| 索引文件写满 | `segment.index.bytes` / `log.index.size.max.bytes` | 10485760（10 MiB） |
| 追加消息的相对 offset 无法用 int32 表示 | — | 硬性上限 |

最后一条是隐性上限：`OffsetIndex` 的相对 offset 用 4 字节存储，一个段内的相对 offset 不能超过 `Integer.MAX_VALUE`。这也是 `log.segment.bytes` 默认 1 GiB 的隐含约束——即使把它调到 100 GiB，也会因这条限制提前滚动。

来源：[Kafka 4.1 Topic Configs](https://kafka.apache.org/41/configuration/topic-configs)、[Red Hat Streams for Apache Kafka 3.0 Broker Config](https://docs.redhat.com/de/documentation/red_hat_streams_for_apache_kafka/3.0/html/kafka_configuration_properties/broker-configuration-properties-str)

## 4. 稀疏索引：一次二分加一小段顺序扫描

Kafka 的索引只在写入若干字节后追加一条，不是每条消息都建。默认每 `log.index.interval.bytes = 4096` 字节写一条索引项。

来源：[Kafka 4.1 Topic Configs: index.interval.bytes](https://kafka.apache.org/41/configuration/topic-configs)

### 4.1 索引条目结构

`OffsetIndex` 与 `TimeIndex` 都是 `AbstractIndex` 的子类，各自定义条目大小：

| 索引 | 条目结构 | 大小 |
| :-- | :-- | :-- |
| `OffsetIndex` | 4 字节 relative offset + 4 字节 physical position | 8 字节 |
| `TimeIndex` | 8 字节 timestamp + 4 字节 relative offset | 12 字节 |

用「相对 offset」而不是绝对 offset，是为了把每个条目控制在 8 字节内——绝对 offset 是 int64 要 8 字节，而相对 offset 用 int32 就够（因为段内相对 offset 不超过 int32，见 §3）。

`AbstractIndex#toRelative` 直接给出这条约束：

```java
// storage/.../log/AbstractIndex.java  等价 Scala 版
private def toRelative(offset: Long): Option[Int] = {
  val relativeOffset = offset - baseOffset
  if (relativeOffset < 0 || relativeOffset > Int.MaxValue) None
  else Some(relativeOffset.toInt)
}
```

来源：[apache/kafka OffsetIndex/AbstractIndex 源码](https://github.com/apache/kafka/blob/trunk/storage/src/main/java/org/apache/kafka/storage/internals/log/OffsetIndex.java)

### 4.2 索引文件使用 mmap

索引文件通过 `MappedByteBuffer` 映射进进程虚拟地址空间：

```java
// AbstractIndex 关键字段与派生量
protected MappedByteBuffer mmap;
protected int _entries    = mmap.position() / entrySize();
protected int _maxEntries = mmap.limit()    / entrySize();
public boolean isFull()   { return _entries >= _maxEntries; }
```

好处只有一条：查索引不再走 read/write 系统调用，直接按虚地址访问。索引本身一般只有几 MB，冷启动时首次访问触发缺页把整个索引搬进 Page Cache，之后近乎内存速度。段滚动时先按 `log.index.size.max.bytes` 预分配空间，滚动后再截断到实际大小。

### 4.3 查找过程

以「查 offset = 1234 的消息」为例：

```text
1. 定位段：在 UnifiedLog 的 LogSegments 跳表里二分，找到 base offset ≤ 1234 的段
2. 查 OffsetIndex：把 1234 - baseOffset 作为目标相对 offset，二分查最大的 ≤ target 条目
   → 假设命中 (relativeOffset = 34, position = 8192)
3. 在 FileRecords 里从 position = 8192 开始顺序扫描 RecordBatch
   → 每读一批，比较 baseOffset + lastOffsetDelta 是否覆盖 1234
4. 命中后按 offsetDelta 定位到具体记录返回
```

顺序扫描的长度上界就是索引密度：默认 4096 字节内一定能找到目标。这是稀疏索引的核心权衡——索引小到能整块常驻内存，代价是每次查找末尾拖一小段顺序扫描；而顺序扫描落在同一个 Page Cache 页里，几乎不产生额外磁盘 IO。

`OffsetIndex#lookup` 的返回类型是 `OffsetPosition(baseOffset + relativeOffset, physical)`：

```java
// storage/.../log/OffsetIndex.java
protected OffsetPosition parseEntry(ByteBuffer buffer, int n) {
    return new OffsetPosition(
        baseOffset() + relativeOffset(buffer, n),
        physical(buffer, n));
}
private int relativeOffset(ByteBuffer buffer, int n) { return buffer.getInt(n * entrySize()); }
private int physical      (ByteBuffer buffer, int n) { return buffer.getInt(n * entrySize() + 4); }
```

### 4.4 二分查找的 Page Cache 优化

裸二分对 Page Cache 不友好：每次访问的中点会跳到全然不同的页，冷索引时首次访问触发大量缺页。Kafka 把索引切成 `warmArea` 与 `coldArea` 两段分别二分——热区常驻同一批页，命中率显著更高。这个改进见 `AbstractIndex#indexSlotRangeFor` 中 `warmEntries` 的处理，社区侧的分析见 [How Kafka's Index Uses Binary Search and Cache-Friendly Optimizations](https://www.besthub.dev/articles/how-kafka-s-index-uses-binary-search-and-cache-friendly-optimizations-1630035de0c0)。

### 4.5 `TimeIndex` 的额外约束

按时间戳查 offset 时，`TimeIndex#lookup` 返回「时间戳 ≤ 目标的最大条目」的 offset，再拿这个 offset 走 §4.3 的流程。由于生产者可能乱序追加（同批内 `maxTimestamp` 不一定单调递增），`TimeIndex` 在 append 时只写入「严格大于上一个已索引时间戳」的项——这也是同样的 4 KiB 数据量下 `.timeindex` 条目通常少于 `.index` 的原因。

## 5. 分段的追加与读取入口

写路径：

```text
Producer → ReplicaManager#appendRecords
        → Partition#appendRecordsToLeader
        → UnifiedLog#appendAsLeader
             ├─ LogValidator：校验 magic / CRC / 幂等 sequence
             ├─ ProducerStateManager：更新 PID/epoch/sequence
             ├─ LocalLog#append → LogSegment#append
             │       ├─ FileRecords#append（写 .log）
             │       ├─ 累计 bytesSinceLastIndexEntry ≥ indexIntervalBytes 时
             │       │   OffsetIndex#append / TimeIndex#maybeAppend
             │       └─ 更新 maxTimestampSoFar
             └─ 更新 LEO、必要时唤醒 delayed fetch
```

读路径的关键仍在 `LogSegment#read`：先走 §4 的索引定位起点，再交给 `FileRecords` 从该 position 起返回一段字节。走到网络层时，无 SSL 情况下 `FileRecords#writeTo` 直接调用 `FileChannel.transferTo`（sendfile），这一段在 [Page Cache 与零拷贝](./chapter-02-page-cache.md) 展开。

## 6. 一句话小结

- Partition 目录 = 一组 `LogSegment`；每段 = `.log` + `.index` + `.timeindex` + `.txnindex`。
- `.log` 里是 v2 `RecordBatch`，头部 61 字节固定字段承担压缩、事务、幂等、leader epoch 语义。
- 索引 mmap 到内存，条目存相对量以省空间，用二分（分热/冷区）加短程顺序扫描定位消息。
- 段的滚动上限最终由 `OffsetIndex` 的 int32 相对偏移天花板兜底。

清理策略（`delete` / `compact`）见 [数据保留](../06-reliability/chapter-04-data-retention.md)；写入落盘与消费者读取如何借力 Page Cache，见 [Page Cache 与零拷贝](./chapter-02-page-cache.md)。
