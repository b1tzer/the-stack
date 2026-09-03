# 生产者内部机制

> 生产者看起来只是一个 `send()` 调用，但背后发生的事情远比你想象的复杂。消息从 Java 对象变成磁盘上的字节，中间经过了序列化、分区选择、批量聚合、网络发送四个阶段。每个阶段都有吞吐和延迟的权衡。

## 1. 发送流程全貌

```txt
Producer.send(record)
    │
    ▼
拦截器（ProducerInterceptor）    ← 可选：添加 Header、记录日志
    │
    ▼
序列化器（Serializer）           ← Key/Value 从 Java 对象 → byte[]
    │
    ▼
分区器（Partitioner）            ← 决定消息去哪个分区
    │
    ▼
RecordAccumulator                ← 按分区聚合到 batch
    │
    ▼
Sender 线程                      ← 独立线程，从 Accumulator 取 batch 发送到 Broker
    │
    ▼
Broker 写入 Leader → 副本同步 → 返回 ACK
```

关键设计：**Sender 是独立线程**。`send()` 调用不会直接发网络请求——它把消息放进 RecordAccumulator 的缓冲区就返回了。真正的网络发送由 Sender 线程异步完成。这个设计让 `send()` 的延迟极低（只是内存操作），同时 Sender 可以攒批发送，提高网络效率。

## 2. 序列化：为什么要用 Schema

Kafka Broker 只认 `byte[]`。生产者发送的 Java 对象必须先序列化成字节数组。

最简单的做法是 `StringSerializer`——把 JSON 字符串转成字节。但这有三个问题：

**无结构校验**：生产者今天写 `amount: 100`（int），明天改成 `amount: "100"`（string），消费者 `Integer.parseInt` 直接挂掉。Broker 不会拦。

**体积浪费**：JSON 每条消息都带字段名，20 个字段的消息有 40% 的字节是字段名。

**无版本管理**：谁改了字段？什么时候改的？没有记录。

所以生产环境推荐用 Avro/Protobuf + Schema Registry。消息只带 4 字节 Schema ID，Schema 定义存在 Registry 里。详见 [Schema 与序列化](./chapter-06-schema-and-serialization.md)。

## 3. 分区选择：消息去哪

分区器决定消息去哪个分区。详见 [分区与 Offset](./chapter-01-partition-and-offset.md) §4。

这里补充一个生产者特有的细节：**粘性分区**。

Kafka 2.4 之前，无 Key 的消息默认用 RoundRobin——每条消息轮询到不同分区。问题在于：如果你发 100 条消息到 10 个分区，每条消息各自一个 batch，每个 batch 只有 1 条消息。1 个请求发 1 条消息，网络开销巨大，压缩比也极差。

粘性分区的改进：同一个 batch 内的消息全部发到同一个分区，batch 满了再切换。100 条消息可能只需要 10 个 batch（每个 batch 10 条），网络请求减少 10 倍。

## 4. RecordAccumulator：批量聚合的核心

RecordAccumulator 是生产者内部的"蓄水池"。它为每个分区维护一个双端队列（Deque），队列中的每个元素是一个 ProducerBatch。

```txt
消息到达 → 按分区路由 → 追加到对应分区的队列
    │
    ▼
队列尾部的 batch 未满 → 追加到当前 batch
队列尾部的 batch 已满 → 创建新 batch
    │
    ▼
batch 达到 batch.size 或等待超过 linger.ms → Sender 线程取出发送
```

`batch.size` 和 `linger.ms` 是一对"吞吐 vs 延迟"的旋钮：

**`batch.size`**：batch 的字节大小上限。调大 → 单批更大、压缩比更高、网络请求更少，但首条消息等待更久。

**`linger.ms`**：batch 的等待时间上限。调大 → 等更久攒更多消息，但每条消息的发送延迟上限更高。

两者是"谁先到谁先发"的关系：batch 满了立刻发，等够了也发。低延迟场景调小两者，高吞吐场景调大两者。

### 缓冲区溢出

RecordAccumulator 有一个总大小限制（`buffer.memory`，默认 32MB）。如果生产者发送速度持续超过 Broker 接受速度，缓冲区会满。此时 `send()` 会阻塞，等待缓冲区释放。如果等待超过 `max.block.ms`，抛出 `TimeoutException`。

这是 Kafka 生产者的背压机制——它不会无限占用内存，而是通过阻塞来降速。

## 5. 压缩：在哪里压缩、怎么选算法

压缩发生在 **Sender 线程取出 batch 发送时**，不是消息到达时。这意味着压缩的是整个 batch，而不是单条消息——batch 越大，压缩比越高。

Kafka 支持 5 种压缩算法：

| 算法 | 核心特点 |
| :-- | :-- |
| none | 不压缩，最低延迟 |
| gzip | 压缩比最高，但 CPU 开销大 |
| snappy | 速度和压缩比均衡 |
| lz4 | 压缩速度最快，通用推荐 |
| zstd | 压缩比接近 gzip，速度接近 lz4 |

选择的核心权衡是 **CPU vs 带宽**：

- 带宽充裕、CPU 紧张 → 不压缩或 snappy
- 带宽紧张、CPU 充裕 → zstd（最高压缩比）
- 不确定 → lz4（最安全的默认选择）

压缩是端到端的：生产者压缩 → Broker 存储压缩数据 → 消费者解压。Broker 通常不解压，只做字节转发。所以压缩的 CPU 开销由生产者和消费者分担，Broker 不受影响。

详见 [压缩权衡](../performance/chapter-04-compression-tradeoff.md)。

## 6. 异常处理

`send()` 的回调中，异常分为两类：

**可重试异常**（`RetriableException`）：网络抖动、Leader 选举中、ISR 副本不足。客户端会自动重试。

**不可重试异常**：消息过大（`RecordTooLargeException`）、Topic 不存在（`InvalidTopicException`）、权限不足（`AuthorizationException`）。重试也没用，需要修复根本问题。

**`ProducerFencedException`**：事务被另一个同 `transactional.id` 的实例抢占。必须立刻关闭 Producer，不能重试。

幂等生产者的重试不会导致重复消息，详见 [ACK 与幂等](./chapter-05-ack-and-idempotence.md)。

## 7. 关闭生产者

`producer.close()` 不只是释放资源——它会等待所有未完成的 `send()` 调用完成（包括重试）。如果不调用 `close()`，正在途中的消息可能丢失。

带超时的 `close(Duration.ofSeconds(30))` 在超时后强制关闭，适用于不能无限等待的场景。
