# 吞吐调优

> Kafka 的性能取决于生产者、Broker、消费者三端的参数配合。本文给出高吞吐和低延迟两种场景的调优方案。

## 1. 调优原则

```txt
吞吐和延迟多数情况下此消彼长：更大的批次、更激进的压缩通常推高吞吐，也增加等待与压缩开销。
但这不是固定关系，解除锁竞争、减少网络往返、改善分区分布，也可能同时提高吞吐并降低延迟。
```

调优前先明确目标：是要最大吞吐，还是最低延迟。本文各表中的具体数值都是起始测试值，需按实际负载实测调整，不是无条件适用的生产推荐值。

## 2. 生产者调优

| 参数 | 高吞吐 | 低延迟 | 说明 |
| :-- | :-- | :-- | :-- |
| `batch.size` | 65536（64KB） | 16384（16KB） | 更大批次可能改善压缩比，取决于消息内容与压缩算法 |
| `linger.ms` | 20~100 | 0 | 等待越久批次越满 |
| `compression.type` | lz4 或 zstd | none | 压缩减少网络传输 |
| `buffer.memory` | 67108864（64MB） | 33554432（32MB） | 缓冲区越大，越不容易阻塞 |
| `acks` | all | 1 | 可靠性参数，见下方说明 |
| `max.in.flight.requests.per.connection` | 5 | 1 | 多个在途请求提升吞吐 |

`acks` 是可靠性参数，不是性能开关。它决定生产者等待哪一级确认，对吞吐和延迟的影响取决于副本同步与网络条件，不能简单归入高吞吐或低延迟。

- `acks=all`：等待当前 ISR 中的副本确认。持久性还取决于 `min.insync.replicas`、副本同步状态和故障条件，并非绝对不丢消息。这是 Kafka 3.0 及以上的默认值。
- `acks=1`：只等 Leader 确认，延迟更低，但 Leader 宕机且副本未同步时会丢消息。
- `acks=0`：不等待确认，延迟最低，发送即视为成功，不保证送达。

幂等生产者（Kafka 3.0 起默认启用）只消除重试导致的重复写入，不单独保证端到端恰好一次，也不无条件保证不丢消息；它的作用范围不能与 `acks` 的持久性保证混淆。启用幂等生产者时 `acks` 必须为 `all`，`max.in.flight.requests.per.connection` 不能超过 5。

低延迟场景允许牺牲可靠性时可降为 `acks=1`；高吞吐场景通常保留 `acks=all`，靠批量与压缩摊薄确认开销。

### 高吞吐配置

```java
props.put("batch.size", 65536);
props.put("linger.ms", 50);
props.put("compression.type", "lz4");
props.put("buffer.memory", 67108864L);
props.put("acks", "all");
props.put("max.in.flight.requests.per.connection", 5);
```

### 低延迟配置

`acks=1` 与默认启用的幂等生产者不能直接组合，需先关闭幂等，否则配置校验会失败或导致幂等性被自动关闭。

```java
props.put("enable.idempotence", false);
props.put("batch.size", 16384);
props.put("linger.ms", 0);
props.put("compression.type", "none");
props.put("acks", "1");
```

## 3. 消费者调优

| 参数 | 高吞吐 | 低延迟 | 说明 |
| :-- | :-- | :-- | :-- |
| `fetch.min.bytes` | 65536（64KB） | 1 | 最小拉取字节数 |
| `fetch.max.wait.ms` | 500 | 100 | 最大等待时间 |
| `max.partition.fetch.bytes` | 1048576（1MB） | 524288（512KB） | 单分区最大拉取 |
| `max.poll.records` | 1000~5000 | 100 | 单次 poll 最大记录数 |

### 高吞吐配置

```java
props.put("fetch.min.bytes", 65536);
props.put("fetch.max.wait.ms", 500);
props.put("max.partition.fetch.bytes", 1048576);
props.put("max.poll.records", 2000);
```

## 4. Broker 调优

| 参数 | 起始测试值 | 说明 |
| :-- | :-- | :-- |
| `num.network.threads` | 8~16 | 网络线程数 |
| `num.io.threads` | 16~32 | I/O 线程数 |
| `socket.send.buffer.bytes` | 1048576 | Socket 发送缓冲区 |
| `socket.receive.buffer.bytes` | 1048576 | Socket 接收缓冲区 |
| `log.flush.interval.messages` | 默认 | 一般不需要调整，让操作系统管理刷盘 |

## 5. 多线程消费

```java
// 方案1：多消费者实例（推荐）
// 每个实例独占一个 KafkaConsumer。并行度上限等于 topic 分区数，
// 实例数超过分区数后，多余的实例不再增加并行度。
// 若 processMessage 抛异常，线程会在此中断、不会执行后面的 commitSync；
// 更需避免的是捕获异常后仍照常提交整个批次。业务处理失败时应停止推进
// 提交位置，不能越过失败记录。
for (int i = 0; i < 10; i++) {
    new Thread(() -> {
        KafkaConsumer<String, String> consumer = createConsumer();
        consumer.subscribe(Arrays.asList("topic"));
        while (true) {
            ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
            for (ConsumerRecord<String, String> record : records) {
                processMessage(record);
            }
            consumer.commitSync();
        }
    }).start();
}

// 方案2：单消费者 + 线程池（示意代码，不完整）
// KafkaConsumer 非线程安全，只能由消费线程独占调用，工作线程只做业务处理。
// 需用有界队列施加背压，并按分区提交：某分区的提交位置只能推进到
// 已成功处理的连续记录之后，不能越过尚未完成的任务。
ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
ExecutorService executor = Executors.newFixedThreadPool(10);
for (ConsumerRecord<String, String> record : records) {
    executor.submit(() -> processMessage(record));
}
// 上面省略了等待任务完成与按分区连续提交 Offset 的逻辑，不可直接用于生产
```

## 6. 性能瓶颈分析

```txt
调优闭环：先建立基线（吞吐、端到端延迟分位数、CPU/网络/磁盘、消费者 Lag），
再识别瓶颈在哪一端，然后单变量调整一个参数并复测，最后在峰值负载下验证。

排查消费瓶颈时先区分三类指标，它们单位不同、不能相加：

端到端延迟：消息从生产到业务处理完成的耗时（时间单位）
消费者 Lag：消费位置与日志末端的差距（位置差，不是时间，需结合速率分析影响）
处理与调度耗时：分别观察 Fetch、业务处理、提交、Rebalance 各自的耗时，它们不是同一层级，不能直接相加

处理慢：消息处理耗时、外部调用阻塞、GC 停顿
网络慢：Broker 到消费者的带宽、请求延迟；Fetch 批量大小只是可调参数，不是网络瓶颈本身
Rebalance：频繁的消费者加入/离开
```

瓶颈定位命令：

```bash
# 磁盘 I/O
iostat -x 1

# CPU 和内存
vmstat 1

# GC 状态
jstat -gc <kafka-pid> 1000

# Kafka 指标
kafka-run-class.sh kafka.tools.JmxTool \
    --object-name "kafka.server:type=BrokerTopicMetrics,name=MessagesInPerSec" \
    --jmx-url service:jmx:rmi:///jndi/rmi://localhost:9999/jmxrmi
```
