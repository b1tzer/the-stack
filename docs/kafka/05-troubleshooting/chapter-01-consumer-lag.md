# 消费者 Lag 过大

> 消费者 Lag 是生产速度与消费速度的差值。Lag 持续增长意味着消费者跟不上生产者，最终可能导致消息积压和延迟。

## 1. 现象

```bash
kafka-consumer-groups.sh --describe --group my-group --bootstrap-server localhost:9092

# GROUP    TOPIC    PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
# my-group my-topic 0          1000            50000           49000
# my-group my-topic 1          2000            48000           46000
```

Lag 持续增长，消费者处理速度跟不上生产速度。

## 2. 快速判断

```txt
Lag 稳定（不增长）→ 消费速度跟得上，不需要处理
Lag 缓慢增长      → 消费速度略低于生产速度，优化消费者
Lag 快速增长      → 消费速度远低于生产速度，紧急扩容
```

## 3. 逐步排查

### Step 1：确认是单分区还是全局

```bash
kafka-consumer-groups.sh --describe --group my-group --bootstrap-server localhost:9092
```

- 单分区 Lag 高 → 该分区的数据倾斜或处理逻辑有问题
- 所有分区 Lag 高 → 消费者整体处理能力不足

### Step 2：检查消费者数量 vs 分区数

```bash
# 消费者数
kafka-consumer-groups.sh --describe --group my-group --bootstrap-server localhost:9092 | grep -c "consumer-"

# 分区数
kafka-topics.sh --describe --topic my-topic --bootstrap-server localhost:9092 | grep "PartitionCount"
```

消费者数 < 分区数 → 增加消费者可以提升并行度。

### Step 3：检查消费者处理速度

```java
// 在消费者中添加处理耗时日志
long start = System.currentTimeMillis();
processRecord(record);
long cost = System.currentTimeMillis() - start;
if (cost > 100) {
    logger.warn("Slow processing: {}ms for offset={}", cost, record.offset());
}
```

常见慢处理原因：

| 原因 | 排查方式 |
| :-- | :-- |
| 外部调用阻塞（DB、HTTP） | 检查消费者日志中的超时和慢查询 |
| GC 停顿 | `jstat -gc <pid> 1000` |
| 消息处理逻辑复杂 | 分析处理函数的耗时分布 |

### Step 4：检查 Fetch 参数

```java
// Fetch 参数是否过于保守
props.put("fetch.min.bytes", 1);           // 默认 1，每次 Fetch 都返回
props.put("fetch.max.wait.ms", 500);       // 默认 500ms
props.put("max.poll.records", 500);        // 默认 500，可以调大
```

## 4. 解决方案

| 方案 | 适用场景 | 操作 |
| :-- | :-- | :-- |
| 增加消费者数 | 消费者数 < 分区数 | 增加消费者实例 |
| 增加分区数 | 分区数太少限制并行度 | 扩展分区（注意 Key 路由变化） |
| 优化处理逻辑 | 处理函数耗时长 | 异步化、批量处理、减少外部调用 |
| 调大 max.poll.records | 单次 poll 拉取太少 | 调大到 1000~5000 |
| 调大 fetch.min.bytes | Fetch 请求太频繁 | 调大到 64KB |

## 5. 预防

- 监控 `records-lag-max` JMX 指标，设置告警阈值（如 > 10000）
- 消费者处理逻辑尽量轻量，外部调用异步化
- 合理设置分区数，预留并行度空间
