# 吞吐调优

> Kafka 的性能取决于生产者、Broker、消费者三端的参数配合。本文给出高吞吐和低延迟两种场景的调优方案。

## 1. 调优原则

```txt
吞吐 ↑ = 延迟 ↑ + 批量 ↑ + 压缩 ↑
延迟 ↓ = 吞吐 ↓ + 批量 ↓ + 实时性 ↑
```

不存在"又快又延迟低"的方案。调优前先明确目标：是要最大吞吐，还是最低延迟。

## 2. 生产者调优

| 参数 | 高吞吐 | 低延迟 | 说明 |
| :-- | :-- | :-- | :-- |
| `batch.size` | 65536（64KB） | 16384（16KB） | 批次越大，压缩比越高 |
| `linger.ms` | 20~100 | 0 | 等待越久批次越满 |
| `compression.type` | lz4 或 zstd | none | 压缩减少网络传输 |
| `buffer.memory` | 67108864（64MB） | 33554432（32MB） | 缓冲区越大，越不容易阻塞 |
| `acks` | 1（吞吐优先） | all（可靠性优先） | acks=1 不等 Follower 确认 |
| `max.in.flight.requests.per.connection` | 5 | 1 | 多个在途请求提升吞吐 |

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

```java
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

| 参数 | 推荐值 | 说明 |
| :-- | :-- | :-- |
| `num.network.threads` | 8~16 | 网络线程数 |
| `num.io.threads` | 16~32 | I/O 线程数 |
| `socket.send.buffer.bytes` | 1048576 | Socket 发送缓冲区 |
| `socket.receive.buffer.bytes` | 1048576 | Socket 接收缓冲区 |
| `log.flush.interval.messages` | 默认 | 一般不需要调整，让操作系统管理刷盘 |

## 5. 多线程消费

```java
// 方案1：多消费者实例（推荐）
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

// 方案2：单消费者 + 线程池（注意顺序问题）
ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
ExecutorService executor = Executors.newFixedThreadPool(10);
for (ConsumerRecord<String, String> record : records) {
    executor.submit(() -> processMessage(record));
}
// 方案2 破坏了处理顺序，需要等一批全部处理完再提交 Offset
```

## 6. 性能瓶颈分析

```txt
消费延迟 = 处理延迟 + 网络延迟 + Rebalance 延迟

处理延迟：消息处理耗时、外部调用阻塞、GC 停顿
网络延迟：Broker 到消费者的网络带宽、Fetch 批量大小
Rebalance 延迟：频繁的消费者加入/离开
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
