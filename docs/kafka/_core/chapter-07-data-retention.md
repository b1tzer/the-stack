# 数据保留

> Kafka 的消息不会因为被消费就删除。它一直在那里，直到保留策略把它清理掉。这个设计让 Kafka 支持"回溯消费"——消费者可以随时重置 Offset 重新读取历史数据。但"一直存着"显然不现实，磁盘终究会满。所以 Kafka 需要一套策略来决定"什么时候删、怎么删"。

## 1. 为什么消费不删除消息

传统消息队列（如 RabbitMQ）的模型是：消费者确认（ACK）后，消息从队列中移除。这在"一对一"消费场景下没问题。

但 Kafka 支持多个消费者组独立消费同一个 Topic。Group A 消费了消息，Group B 还没消费——如果 Group A 消费完就删，Group B 就读不到了。

所以 Kafka 的设计是：**消息的生命周期由保留策略决定，与消费无关**。消费只影响 Offset 的推进，不影响消息的存储。

## 2. 删除策略

Kafka 删除的最小单位是**日志段（Segment）**，不是单条消息。一个 Partition 的日志由多个 Segment 文件组成，每个 Segment 有一个时间戳范围和大小。当整个 Segment 超过保留阈值时，整个文件被删除。

### 按时间保留

```properties
log.retention.hours=168    # 保留 7 天（默认）
```

Broker 定期检查每个 Segment 的最大时间戳。如果当前时间 - Segment 最大时间戳 > `log.retention.hours`，删除整个 Segment。

### 按大小保留

```properties
log.retention.bytes=-1     # 不限制（默认）
log.retention.bytes=1073741824  # 每个分区最多保留 1GB
```

注意是**每个分区**的限制，不是整个 Topic。Topic 有 10 个分区，每个分区保留 1GB，总保留 10GB。

### 为什么删除的是 Segment 而不是单条消息

如果要删除单条消息，你需要在文件中找到这条消息的位置，把它标记为已删除或重写文件。这在追加日志的存储模型下代价极高——你不能原地修改文件（追加日志的"不可变"原则）。

分段后，删除变成了"删文件"——零拷贝开销，操作系统直接回收磁盘空间。代价是删除粒度较粗：默认 1GB 一个 Segment，即使只有一条消息过期，也要等整个 Segment 过期才能删。

## 3. 压缩策略：保留每个 Key 的最新值

删除策略是"按时间/大小删"，适用于日志收集、事件驱动等场景。但有些场景需要保留每个实体的最新状态：

- 数据库 CDC（变更数据捕获）：每个 Key 的最新行
- 配置中心：每个配置项的最新值
- 用户 Session：每个 Session 的最新数据

压缩策略（`log.cleanup.policy=compact`）保留每个 Key 的最新值，删除旧版本：

```txt
压缩前：                      压缩后：
Key1: Value1 (offset 0)       Key1: Value3 (offset 4)  ← 最新
Key2: Value1 (offset 1)       Key2: Value2 (offset 3)  ← 最新
Key1: Value2 (offset 2)       Key3: Value1 (offset 5)  ← 唯一
Key2: Value2 (offset 3)
Key1: Value3 (offset 4)
Key3: Value1 (offset 5)
```

压缩后的 Topic 像一个持久化的 HashMap——每个 Key 只保留最新的一条消息。

### 墓碑消息（Tombstone）

怎么删除一个 Key？发送一条 Value 为 `null` 的消息：

```java
producer.send(new ProducerRecord<>("topic", key, null));
```

这条 null-value 消息就是"墓碑"。压缩过程中，它会删除该 Key 的所有旧版本。墓碑消息本身保留 `log.cleaner.delete.retention.ms`（默认 24 小时）后被清理。

## 4. 混合策略

```properties
log.cleanup.policy=delete,compact
```

先压缩（保留每个 Key 的最新值），再按时间删除旧数据。适用于需要"保留最新状态，但也不要无限增长"的场景，如事件溯源。

## 5. 磁盘容量规划

```txt
磁盘容量 = 每日消息量 × 消息大小 × 保留天数 × 副本因子 × 1.2（余量）
```

示例：每日 1 亿条消息，每条 1KB，保留 7 天，3 副本：

```txt
1亿 × 1KB × 7 × 3 × 1.2 = 2.52 TB
```

磁盘空间不足的排查见 [磁盘空间不足](../troubleshooting/chapter-05-disk-space.md)。
