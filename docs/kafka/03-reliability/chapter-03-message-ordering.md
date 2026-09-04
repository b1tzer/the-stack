# 消息顺序

> 消息顺序是很多业务场景的硬性要求。Kafka 保证单分区内有序，但不保证跨分区有序。本文讲清顺序保证的边界、破坏顺序的场景，以及如何在业务层保证全局有序。

## 1. Kafka 的顺序保证

| 维度 | 顺序保证 |
| :-- | :-- |
| 单分区内 | 严格有序（写入顺序 = 读取顺序） |
| 跨分区 | 无序 |
| 全局有序 | 不保证（需要特殊处理） |

单分区内有序的根源是存储结构：每个分区是一条独立的追加日志（append-only log），消息按到达顺序写到日志末尾，同一个分区里的偏移量单调递增、天然有序。详见 [分区与 Offset](../02-core/chapter-01-partition-and-offset.md)。

跨分区为什么无序：不同的分区是相互独立的日志，各自记录自己的偏移量，Kafka 不维护任何跨分区的全局序号或全局时钟。两个分区的"第 100 条"之间没有先后关系，消费者按分区拉取、按分区处理，跨分区消息到达消费者的先后就不受控制。

## 2. 破坏顺序的场景

### 2.1 重试导致乱序

```txt
发送 msg1 → 失败（重试中）
发送 msg2 → 成功
msg1 重试成功
结果：msg2 在 msg1 之前（乱序）
```

解决方案：开启幂等生产者，内部通过 Sequence Number 重排序。

```java
props.put("enable.idempotence", true);
props.put("max.in.flight.requests.per.connection", 5);  // 允许 5 个在途请求，内部保证顺序
```

**重排序是怎么做到的**：幂等生产者给每条消息分配单调递增的 Sequence Number。Broker 收到 `Seq=N+1` 时，如果 `Seq=N` 还没到，就把 `N+1` 暂存到重排序缓冲区，等 `N` 到达后再按顺序写入。这保证了 Broker 侧落盘的顺序始终与发送顺序一致，重试的旧消息会被缓冲区"顶回正确的位置"。

代价是缓冲区有容量上限——对应 `max.in.flight.requests.per.connection ≤ 5`。超过 5 个在途请求就超出重排能力，顺序保证失效。完整的重排序机制见 [ACK 与幂等](../02-core/chapter-05-ack-and-idempotence.md) §3。

### 2.2 分区扩展导致乱序

有 Key 的消息在分区扩展后 rehash，同一 Key 的消息可能路由到新分区：

```txt
扩展前：Key=A 的消息全部到 Partition 0（有序）
扩展后：Key=A 的消息部分到 Partition 0，部分到 Partition 3（无序）
```

机制在于分区路由公式。默认分区器对 Key 取哈希再对分区数取模：`partition = hash(key) % 分区数`。分区数从 4 扩到 6 后，`hash(A) % 4` 和 `hash(A) % 6` 的结果可能不同，原本恒等于 0 的 Key=A 现在可能落到分区 3。同一个 Key 的消息被拆到两个分区，两个分区的消息各自有序、但合在一起失去了全局顺序。

这也是为什么 Kafka 的分区数一旦上线就很难调整——扩分区会破坏"同 Key 到同分区"的顺序保证。规划分区数的考量见 [分区数量规划](../04-performance/chapter-03-partition-sizing.md)。

### 2.3 消费者侧乱序

Rebalance 期间，分区重新分配，同一分区的消息可能被不同消费者先后处理，导致处理顺序与消息顺序不一致。

更常见的乱序来自**多线程消费**：

```java
// ❌ 单线程 poll，多线程并行处理：处理完成顺序 ≠ 消息顺序
while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    executor.submit(() -> process(records));  // 提交线程池
}
```

`poll()` 是单线程的，拉取顺序确实有序；但把消息丢给线程池后，线程调度、处理耗时各不相同，处理完成的顺序与消息顺序脱钩。如果处理结果还要写回下游并依赖顺序，就会出问题。

解法不是让 Kafka 背锅，而是把"顺序"这件事收敛到业务层——按 Key 分组、每个 Key 用独立的单线程处理队列（见 §3.3）。

## 3. 保证顺序的方案

### 3.1 单分区内有序（最简单）

```java
// 同一业务实体的消息用相同的 Key
new ProducerRecord<>("orders", orderId, event);
```

适用场景：同一订单的状态变更、同一用户的行为日志。

### 3.2 全局有序（牺牲性能）

```java
// 只用 1 个分区
kafka-topics.sh --create --topic ordered-topic --partitions 1 --replication-factor 3
```

| 维度 | 说明 |
| :-- | :-- |
| 优点 | 严格全局有序 |
| 缺点 | 只能用 1 个消费者，无并行度 |
| 适用场景 | 吞吐量低、顺序要求极高 |

### 3.3 业务层排序（推荐）

不依赖 Kafka 的顺序保证，在消费端按业务时间戳排序：

```java
TreeMap<Long, List<ConsumerRecord>> sorted = new TreeMap<>();
for (ConsumerRecord record : records) {
    sorted.computeIfAbsent(record.timestamp(), k -> new ArrayList<>()).add(record);
}
```

这段代码只能算"排序的骨架"，直接用有两个坑：

**坑 1：`record.timestamp()` 是生产者时钟，不是事件真实发生时间**。如果消息来自多个生产者，各自时钟有偏差，按这个时间戳排序会把"实际后发生"的消息排到前面。可靠的做法是让消息体里带业务时间（`eventTime`），排序用 `eventTime` 而不是 `timestamp()`。

**坑 2：单靠排序解决不了"乱序到达"**。乱序消息可能延迟很久才到，TreeMap 无法判断"到底还有没有更早的消息没来"。正确做法是引入**事件时间窗口 + 水印（watermark）**：等窗口内的消息都到齐（或超过等待时间）再一起处理。这套机制本质上是流处理框架（Flink / Spark Streaming）在做的，Kafka 本身不提供。

所以业务层排序的正确姿势是：**Kafka 只负责按 Key 把消息送到同一分区，真正的全局有序交给流处理框架的事件时间机制**。Kafka 能承诺的边界到此为止。

## 4. 方案选型

| 方案 | 顺序保证 | 吞吐量 | 复杂度 |
| :-- | :-- | :-- | :-- |
| 单分区 | 全局有序 | 低（无并行） | 低 |
| 多分区 + 相同 Key | 局部有序 | 高 | 低 |
| 业务层排序 | 最终有序 | 高 | 中 |

> 大多数业务只需要「同一实体有序」，不需要全局有序。用 Key 路由到同一分区是最优方案。
