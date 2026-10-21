# 消费者 Lag 过大

> 消费者 Lag 是消费组已提交（或当前消费）位置与分区日志末端位置之间的记录数差值，表示某一时刻积压的消息量。生产速率与消费速率的差值决定 Lag 的变化趋势，当生产持续快于消费时 Lag 增长，最终可能导致消息积压和延迟。

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
Lag 较低且稳定 → 通常无需干预，但仍需满足业务延迟要求
Lag 较高但稳定 → 消费能力仅与生产速率持平，评估积压消化时间与业务时效性
Lag 持续增长   → 消费能力低于生产负载，定位是处理能力不足、分区倾斜还是其他瓶颈
```

## 3. 逐步排查

### Step 1：确认是单分区还是全局

```bash
kafka-consumer-groups.sh --describe --group my-group --bootstrap-server localhost:9092
```

- 单分区 Lag 高 → 优先检查该分区的数据倾斜、处理耗时或分区分配是否均衡
- 所有分区 Lag 高 → 优先检查生产速率是否突增、下游是否变慢、是否发生 Rebalance，或消费者整体处理能力

### Step 2：检查消费者数量 vs 分区数

```bash
# 消费者数（--members 按成员列出，每行一个消费者实例）
kafka-consumer-groups.sh --describe --members --group my-group --bootstrap-server localhost:9092

# 分区数（--describe 输出第一行含 PartitionCount 字段）
kafka-topics.sh --describe --topic my-topic --bootstrap-server localhost:9092 | grep "PartitionCount"
```

消费者数 < 分区数 → 存在未分配分区时，增加消费者可能提升并行度；但若瓶颈在下游服务或处理逻辑，扩容不一定带来吞吐提升。

### Step 3：检查消费者处理速度

```java
// 在消费者中添加处理耗时日志
long start = System.nanoTime();
processRecord(record);
long cost = (System.nanoTime() - start) / 1_000_000;
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
props.put("fetch.min.bytes", 1);           // 默认 1，数据不足时最多等 fetch.max.wait.ms
props.put("fetch.max.wait.ms", 500);       // 默认 500ms
props.put("max.poll.records", 500);        // 默认 500，可以调大
```

调大 `max.poll.records` 会拉长单批处理时间，一旦两次 `poll()` 的间隔超过 `max.poll.interval.ms`（默认 5 分钟），消费者会被移出消费组并触发 Rebalance，反而加剧积压。调整该参数前应先确认单批处理耗时，而不是单纯追求一次拉取更多消息。

## 4. 解决方案

| 方案 | 适用场景 | 操作 |
| :-- | :-- | :-- |
| 增加消费者数 | 消费者数 < 分区数 | 增加消费者实例 |
| 增加分区数 | 分区数太少限制并行度 | 扩展分区（注意 Key 路由变化） |
| 优化处理逻辑 | 处理函数耗时长 | 异步化、批量处理、减少外部调用 |
| 调大 max.poll.records | 单次 poll 拉取太少 | 调大到 1000~5000（参考值，需结合单批耗时与 Rebalance 验证） |
| 调大 fetch.min.bytes | Fetch 请求太频繁 | 调大到 64KB |

积压消化时间用净消化速率（消费速率 − 生产速率）估算，仅当消费能力持续高于输入速率时积压才会下降。参数调优与吞吐权衡见 [吞吐调优](../04-performance/chapter-02-throughput-tuning.md)；消费组成员、Rebalance 与 Offset 提交机制见 [消费者组](../02-core/chapter-03-consumer-group.md) 和 [分区与 Offset](../02-core/chapter-01-partition-and-offset.md)。

## 5. 预防

- 监控 `records-lag-max` JMX 指标（消费者客户端侧的最大分区 Lag，不等于消息年龄或端到端延迟），结合消费速率与业务 SLA 设置告警，避免使用不区分吞吐的固定阈值
- 消费者处理逻辑尽量轻量，外部调用异步化
- 合理设置分区数，预留并行度空间
