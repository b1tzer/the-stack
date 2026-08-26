# 批量发送与压缩

## 1. 批量发送

```java
props.put("batch.size", 16384);      // 批量大小（字节）
props.put("linger.ms", 5);           // 等待时间（毫秒）
```

原理：消息先进入 RecordAccumulator，按分区聚合，达到 batch.size 或 linger.ms 后批量发送。

## 2. 压缩算法

| 算法 | 压缩比 | CPU | 推荐 |
|------|--------|-----|------|
| none | - | - | 默认 |
| gzip | 高 | 高 | 存储敏感 |
| snappy | 中 | 低 | 通用 |
| lz4 | 中 | 低 | 通用 |
| zstd | 高 | 中 | Kafka 2.1+ |

```java
props.put("compression.type", "lz4");
```

## 3. 端到端压缩

- 生产者压缩 → Broker 存储压缩数据 → 消费者解压
- Broker 无需解压，性能最优

## 4. 压缩算法深度对比

| 算法 | 压缩比 | 压缩速度 | 解压速度 | CPU 开销 | 适用场景 |
|------|--------|----------|----------|----------|----------|
| none | 1:1 | - | - | 无 | 低延迟场景 |
| gzip | 1:3~1:10 | 慢 | 慢 | 高 | 存储敏感，低吞吐 |
| snappy | 1:2~1:5 | 快 | 快 | 低 | 通用场景 |
| lz4 | 1:2~1:5 | 极快 | 极快 | 低 | 高吞吐场景 |
| zstd | 1:3~1:8 | 中 | 快 | 中 | Kafka 2.1+，平衡场景 |

## 5. 批量发送原理

```
消息 1 (分区 0) ──┐
消息 2 (分区 0) ──┤──► Deque<ProducerBatch> (分区 0)
消息 3 (分区 0) ──┘         │
                            ▼
消息 4 (分区 1) ──┐    达到 batch.size 或 linger.ms
消息 5 (分区 1) ──┘    │
                       ▼
                   Sender 线程取出
                       │
                       ▼
                   压缩 → 发送到 Broker
```

RecordAccumulator 为每个分区维护一个双端队列（Deque），队列中的每个元素是一个 ProducerBatch。当新消息到达时：
1. 如果当前批次未满，追加到尾部批次。
2. 如果当前批次已满，创建新批次。
3. 当批次大小 >= `batch.size` 或等待时间 >= `linger.ms` 时，Sender 线程取出发送。

## 6. 缓冲区管理

```java
props.put("buffer.memory", 67108864L);  // 64MB 缓冲区
props.put("max.block.ms", 60000);        // 缓冲区满时阻塞等待时间
```

当缓冲区耗尽时：
- `send()` 方法会阻塞，直到有空间或超时。
- 超时后抛出 `TimeoutException`。
- 监控指标 `buffer-available-bytes` 可判断缓冲区使用情况。

## 7. 端到端压缩最佳配置

```java
// 生产者：压缩消息
props.put("compression.type", "zstd");
props.put("batch.size", 65536);           // 64KB，更大的批次提升压缩比
props.put("linger.ms", 20);               // 等待更久收集更多消息

// Broker：保持压缩存储
// 不需要额外配置，Broker 默认不重新压缩

// 消费者：自动解压
// 不需要额外配置，消费者自动根据消息头解压
```

## 8. Producer 端 vs Broker 端压缩

| 特性 | Producer 端压缩 | Broker 端压缩 |
|------|----------------|---------------|
| 配置位置 | `compression.type` | `compression.type` |
| 性能影响 | 减少网络传输，增加 Producer CPU | 减少存储空间，增加 Broker CPU |
| 推荐 | ✅ 生产环境推荐 | 仅用于特殊场景 |

## 9. 最佳实践

1. **默认使用 lz4**：在大多数场景下，lz4 的压缩比和性能表现最均衡。
2. **存储敏感场景使用 zstd**：zstd 的压缩比接近 gzip，但 CPU 开销更低。
3. **增大 batch.size 配合压缩**：更大的批次意味着更好的压缩效果。
4. **避免在 Broker 端压缩**：Producer 端压缩 + 端到端传输是最优方案。
5. **监控 compression-rate-avg**：该指标显示平均压缩比，帮助评估压缩效果。
