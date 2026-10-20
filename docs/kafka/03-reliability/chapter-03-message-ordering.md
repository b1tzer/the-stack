# 消息顺序

> 消息顺序是很多业务场景的硬性要求。Kafka 保证单分区内有序，但不保证跨分区有序。本文讲清顺序保证的边界、破坏顺序的场景，以及如何在业务层保证全局有序。

## 1. Kafka 的顺序保证

| 维度 | 顺序保证 |
| :-- | :-- |
| 单分区内 | 严格有序（按 Offset 顺序） |
| 跨分区 | 无序 |
| 全局有序 | 不保证（需要特殊处理） |

单分区内有序的根源是存储结构：每个分区是一条独立的追加日志（append-only log），消息按到达顺序写到日志末尾，同一个分区里的偏移量单调递增、天然有序。详见 [分区与 Offset](../02-core/chapter-01-partition-and-offset.md#partition-ordering)。

注意这里的「有序」是日志顺序，不是业务顺序：它不保证生产者业务事件实际发生的先后（多个生产者的时钟与并发发送会打乱产生顺序），也不保证消费者并行处理后的完成顺序。这两个边界分别见 §2.1 与 §2.3。

跨分区为什么无序：不同的分区是相互独立的日志，各自记录自己的偏移量，Kafka 不维护任何跨分区的全局序号或全局时钟。两个分区的"第 100 条"之间没有先后关系，消费者按分区拉取、按分区处理，跨分区消息到达消费者的先后就不受控制。

## 2. 破坏顺序的场景

### 2.1 重试导致乱序

```txt
发送 msg1 → 失败（重试中）
发送 msg2 → 成功
msg1 重试成功
结果：msg2 在 msg1 之前（乱序）
```

这个乱序的前提是**未开启幂等、且同一连接上允许多个在途请求**——此时消息可以并行发送，失败的消息重试期间，后续消息已先写入，重试成功后就排到了新消息后面。开启幂等后，即使有在途请求，顺序也由序列号校验保证。

解决方案：开启[幂等生产者](../02-core/chapter-05-ack-and-idempotence.md#idempotent-producer)，内部通过 (PID, 分区级 Sequence Number) 做重复检测与顺序校验（`max.in.flight.requests` 保证顺序的原理见该章 [max.in.flight 限制](../02-core/chapter-05-ack-and-idempotence.md#max-in-flight)）。

```java
props.put("enable.idempotence", true);
props.put("max.in.flight.requests.per.connection", 5);  // 幂等模式在途请求上限 5，配合序列号校验保证顺序
```

**顺序是怎么保证的**：幂等生产者给每条消息分配单调递增的 (PID, 分区级 Sequence Number)。Broker 按序列号校验写入：序列号与期望值一致就正常写入；比期望值小，Broker 结合生产者 epoch 与近期批次元数据判断是否为重试的重复批次，重复则跳过；比期望值大，说明中间有消息缺失，视为乱序并拒绝写入（抛出 `OutOfOrderSequenceException`）。

这套校验依赖 `max.in.flight.requests.per.connection ≤ 5`：这是启用幂等时的客户端硬约束，若在开启幂等的同时把该参数配到 5 以上，客户端会抛 `ConfigException` 拒绝启动（关闭幂等则不受此限）。它和 Broker 端为每个生产者保留的批次元数据窗口配套——在途请求不超过 5，Broker 保留的元数据才能覆盖在途请求，从而可靠识别重复与乱序。完整的机制见 [ACK 与幂等](../02-core/chapter-05-ack-and-idempotence.md) §3。

### 2.2 分区扩展导致乱序

有 Key 的消息在分区扩展后，[Key 路由](../02-core/chapter-01-partition-and-offset.md#partition-routing)的取模结果会变（`hash(key) % 分区数`），同一 Key 的消息可能路由到新分区：

```txt
扩展前：Key=A 的消息全部到 Partition 0（有序）
扩展后：Key=A 的消息部分到 Partition 0，部分到 Partition 3（无序）
```

机制在于分区路由公式。默认分区器对 Key 取哈希再对分区数取模：`partition = hash(key) % 分区数`（原理示意，实际是 murmur2 哈希后取正再取模）。分区数从 4 扩到 6 后，`hash(A) % 4` 和 `hash(A) % 6` 的结果可能不同，原本恒等于 0 的 Key=A 现在可能落到分区 3。同一个 Key 的消息被拆到两个分区，两个分区的消息各自有序、但合在一起失去了全局顺序。

这也是为什么 Kafka 的分区数一旦上线就很难调整——扩分区会破坏"同 Key 到同分区"的顺序保证。规划分区数的考量见 [分区数量规划](../04-performance/chapter-03-partition-sizing.md)。

### 2.3 消费者侧乱序

[Rebalance](../02-core/chapter-03-consumer-group.md#rebalance) 会改变分区所有权，把分区从旧消费者转到新消费者。单纯 Rebalance 本身不会改变消息在日志里的顺序；乱序的真正来源是——旧消费者手里可能还有正在处理的异步任务，在它没处理完时，新消费者已经拿到分区并处理了后续消息，两边的处理完成顺序偏离日志顺序。至于旧消费者处理过但没提交位点、导致新消费者重复消费同一批消息，那是「重复」而非「乱序」，属于另一个问题。

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

同一业务实体的消息用相同的 Key 作为分区键（Key 路由原理见 [分区与 Offset](../02-core/chapter-01-partition-and-offset.md#partition-routing)），这样同一实体总是落到同一分区，天然有序：

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
| 优点 | 单分区日志严格有序 |
| 缺点 | 同一消费者组内该分区只分配给一个消费者，且该消费者需单线程顺序处理，无并行度 |
| 适用场景 | 吞吐量低、顺序要求极高 |

单分区只解决了「日志有序」。它仍然要求所有参与排序的消息都进入这一个分区，生产端保证发送顺序、消费端按顺序处理；如果消费端拿到消息后丢给线程池并行处理，日志有序也救不了处理完成顺序（见 §2.3）。

### 3.3 业务层排序（推荐）

不依赖 Kafka 的顺序保证，在消费端按业务时间戳排序：

```java
TreeMap<Long, List<ConsumerRecord>> sorted = new TreeMap<>();
for (ConsumerRecord record : records) {
    sorted.computeIfAbsent(record.timestamp(), k -> new ArrayList<>()).add(record);
}
```

这段代码只是「单批次排序」的骨架，直接用有两个坑：

**坑 1：`record.timestamp()` 不是事件真实发生时间**。它受 `message.timestamp.type` 影响，可能是生产者提供的 CreateTime，也可能是 Broker 追加日志时写入的 LogAppendTime，两者都不等于业务事件真正发生的时间。如果消息来自多个生产者，各自时钟有偏差，按这个时间戳排序会把"实际后发生"的消息排到前面。可靠的做法是让消息体里显式带业务时间（`eventTime`），排序用 `eventTime` 而不是 `timestamp()`。不过 `eventTime` 若来自不同机器的本地时钟，仍可能有时钟偏差；要求严格业务顺序时，业务序列号比时间戳更可靠。

**坑 2：单靠排序解决不了"乱序到达"**。乱序消息可能延迟很久才到，TreeMap 无法判断"到底还有没有更早的消息没来"。正确做法是引入**事件时间窗口 + 水印（watermark）**：等水印推进到窗口结束时间（或超过等待时间）再触发计算。注意水印只是事件时间进度的估计，不是"窗口内消息已到齐"的证明，迟到事件仍可能在触发后到达，如何处理取决于框架的迟到策略。这套机制本质上是流处理框架（Flink / Spark Streaming）在做的，Kafka 本身不提供。

所以业务层排序的正确姿势是：**Kafka 只负责按 Key 把消息送到同一分区（前提是分区数不变，见 §2.2）；允许一定乱序的业务，用流处理框架的事件时间机制（窗口 + 水印 + 迟到策略）处理；要求严格全局顺序的业务，只能用业务序列号 + 缺号等待、超时、补偿策略自己兜底**。Kafka 和流处理框架都不承诺严格的全局有序。

## 4. 方案选型

| 方案 | 顺序保证 | 吞吐量 | 复杂度 |
| :-- | :-- | :-- | :-- |
| 单分区 | 日志全局有序 | 低（无并行） | 低 |
| 多分区 + 相同 Key | 局部有序 | 高 | 低 |
| 业务层排序 | 规则内有序 | 高 | 中 |

> 大多数业务只需要「同一实体有序」，不需要全局有序。用 Key 路由到同一分区是最优方案。
