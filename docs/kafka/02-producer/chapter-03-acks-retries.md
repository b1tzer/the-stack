# ACK 机制与重试

## 1. ACK 机制

| acks | 说明 | 可靠性 | 吞吐量 |
|------|------|--------|--------|
| 0 | 不等待确认 | 低 | 高 |
| 1 | Leader 确认 | 中 | 中 |
| all | ISR 全部确认 | 高 | 低 |

## 2. 幂等生产者

```java
props.put("enable.idempotence", true);  // 开启幂等
props.put("acks", "all");
props.put("retries", Integer.MAX_VALUE);
```

原理：PID + Sequence Number 去重。

## 3. 重试机制

```java
props.put("retries", 3);
props.put("retry.backoff.ms", 100);
```

## 4. 消息丢失与重复

| 场景 | 原因 | 解决 |
|------|------|------|
| 丢失 | acks=0/1，Leader 宕机 | acks=all |
| 重试重复 | 网络超时重试 | 幂等生产者 |
| 消费重复 | Offset 提交失败 | 幂等消费 |

## 5. 幂等生产者原理详解

幂等生产者通过 **Producer ID (PID)** 和 **Sequence Number** 实现去重：

```
Producer 启动 → InitProducerIdRequest → 分配 PID
    │
    ▼
每条消息附带 (PID, Sequence Number)
    │
    ▼
Broker 检查：当前 PID 的期望 Sequence 是否匹配
    │
    ├── 匹配 → 正常写入，期望 Sequence + 1
    │
    └── 不匹配 → DuplicateSequenceException，丢弃重复消息
```

**关键配置约束**：
- `acks=all`：必须，否则无法保证幂等性。
- `max.in.flight.requests.per.connection <= 5`：Kafka 内部通过队列重排序保证最多 5 个在途请求仍可去重。
- `retries > 0`：必须，否则幂等性无意义。

## 6. 重试机制详解

```java
props.put("retries", Integer.MAX_VALUE);
props.put("retry.backoff.ms", 100);
props.put("delivery.timeout.ms", 120000); // 总超时 2 分钟
```

重试触发条件：
- `NotEnoughReplicasException`：ISR 副本不足。
- `NetworkException`：网络异常。
- `LeaderNotAvailableException`：Leader 选举中。

**不会重试的情况**：
- `RecordTooLargeException`：消息过大，直接失败。
- `InvalidTopicException`：Topic 不存在。
- `AuthorizationException`：权限不足。

## 7. 重试与顺序保证

当 `max.in.flight.requests.per.connection > 1` 时，重试可能导致消息乱序。解决方案：

```java
// 方案1：关闭在途请求（性能差）
props.put("max.in.flight.requests.per.connection", 1);

// 方案2：开启幂等性（推荐）
props.put("enable.idempotence", true);
// 内部通过 Sequence Number 重排序，允许最多 5 个在途请求
```

## 8. 回调中的异常处理

```java
producer.send(record, (metadata, exception) -> {
    if (exception != null) {
        if (exception instanceof RetriableException) {
            // 可重试异常，Kafka 客户端会自动重试
            logger.warn("Retriable error: {}", exception.getMessage());
        } else if (exception instanceof ProducerFencedException) {
            // 事务被其他实例抢占，必须关闭 Producer
            logger.error("Producer fenced, shutting down");
            System.exit(1);
        } else {
            // 不可重试异常（如消息过大）
            logger.error("Non-retriable error: {}", exception.getMessage());
        }
    } else {
        logger.info("Sent to partition={}, offset={}", 
            metadata.partition(), metadata.offset());
    }
});
```

## 9. 最佳实践

1. **生产环境必须开启幂等性**：`enable.idempotence=true`，几乎没有性能损耗，但能避免重复消息。
2. **不要设置 retries=0**：除非你明确知道后果。网络抖动是常态，重试是必要的。
3. **设置合理的 delivery.timeout.ms**：避免消息长时间阻塞在缓冲区。默认 2 分钟，可根据业务调整。
4. **监控 failed-send-rate**：如果该指标持续大于 0，说明有消息发送失败。
