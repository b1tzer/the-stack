# 数据保留

> Kafka 的消息不会因为被消费就删除。它一直在那里，直到保留策略把它清理掉。这个设计让 Kafka 支持"回溯消费"——消费者可以随时重置 Offset 重新读取历史数据。但"一直存着"显然不现实，磁盘终究会满。所以 Kafka 需要一套策略来决定"什么时候删、怎么删"。

## 1. 为什么消费不删除消息

传统消息队列（如 RabbitMQ）的模型是：消费者确认（ACK）后，消息从队列中移除。这在"一对一"消费场景下没问题。

但 Kafka 支持多个消费者组独立消费同一个 Topic。Group A 消费了消息，Group B 还没消费——如果 Group A 消费完就删，Group B 就读不到了。

所以 Kafka 的设计是：**消息的生命周期由保留策略决定，与消费无关**。消费只影响 Offset 的推进，不影响消息的存储。

## 2. 删除策略

在 delete 保留策略下，Kafka 删除的最小单位是**日志段（Segment）**，不是单条消息。一个 Partition 的日志由多个 Segment 文件组成，每个 Segment 有一个时间戳范围和大小。当整个 Segment 超过保留阈值时，整个文件被删除。

### 按时间保留

```properties
log.retention.hours=168    # 保留 7 天（默认）
```

Broker 定期检查每个 Segment 的最大时间戳，达到保留条件的日志段会被删除。删除并非时间一到立即执行，而是由后台清理线程定期触发；时间戳语义受 `message.timestamp.type` 配置影响。

### 按大小保留

```properties
log.retention.bytes=-1     # 不限制（默认）
log.retention.bytes=1073741824  # 每个分区最多保留 1GB
```

注意是**每个分区**的限制，不是整个 Topic。Topic 有 10 个分区，每个分区保留 1GB，总保留 10GB。

### 为什么删除的是 Segment 而不是单条消息

如果要删除单条消息，你需要在文件中找到这条消息的位置，把它标记为已删除或重写文件。这在追加日志的存储模型下代价极高——你不能原地修改文件（追加日志的"不可变"原则）。

分段后，删除变成了"删文件"——无需重写日志文件，删除操作主要针对日志段文件及其关联索引。代价是删除粒度较粗：默认滚动阈值约 1 GiB 一个 Segment，即使其中只有一条消息超过保留期限，也要等整个日志段满足删除条件后一起删除。

## 3. 压缩策略：保留每个 Key 的最新值

删除策略是"按时间/大小删"，适用于日志收集、事件驱动等场景。但有些场景需要保留每个实体的最新状态：

- 数据库 CDC（变更数据捕获）：每个 Key 的最新行
- 配置中心：每个配置项的最新值
- 用户 Session：每个 Session 的最新数据

压缩策略（`cleanup.policy=compact`）保留每个 Key 的最新值，删除旧版本：

```txt
压缩前：                      压缩后：
Key1: Value1 (offset 0)       Key1: Value3 (offset 4)  ← 最新
Key2: Value1 (offset 1)       Key2: Value2 (offset 3)  ← 最新
Key1: Value2 (offset 2)       Key3: Value1 (offset 5)  ← 唯一
Key2: Value2 (offset 3)
Key1: Value3 (offset 4)
Key3: Value1 (offset 5)
```

压缩收敛后，Topic 像一个持久化的 HashMap——每个 Key 只保留最新的一条消息。但压缩由后台 Cleaner 异步执行，活跃段不参与压缩，同一 Key 的多个历史版本可能暂时共存，不能把压缩日志等同于实时更新的 KV 存储。

### 墓碑消息（Tombstone）

怎么删除一个 Key？发送一条 Value 为 `null` 的消息：

```java
producer.send(new ProducerRecord<>("topic", key, null));
```

这条 null-value 消息就是"墓碑"。Cleaner 处理到该墓碑时，会清理该 Key 的所有旧版本。墓碑至少按配置的保留窗口（`log.cleaner.delete.retention.ms`，默认 24 小时）保留，超过窗口后可能在后续压缩中被清理。

## 4. 混合策略

```properties
cleanup.policy=delete,compact
```

`delete` 与 `compact` 两种策略同时生效，而不是严格串行的"先压缩、再删除"。压缩保留每个 Key 的最新值，按时间/大小删除则可能移除包含最新 Key 的整个日志段，因此混合策略无法保证最新状态无限期保留。适用于只需在有限保留窗口内保留最新状态、同时限制存储增长的场景。

## 5. 磁盘容量规划

```txt
磁盘容量 = 每日消息量 × 消息大小 × 保留天数 × 副本因子 × 1.2（余量）
```

示例：每日 1 亿条消息，每条 1KB，保留 7 天，3 副本：

```txt
1亿 × 1KB × 7 × 3 × 1.2 = 2.52 TB
```

这是粗略估算，1KB 按平均消息大小计算，实际磁盘占用还受压缩率、批次开销、索引文件、分区负载不均等因素影响。

磁盘空间不足的排查见 [磁盘空间不足](../05-troubleshooting/chapter-05-disk-space.md)。
