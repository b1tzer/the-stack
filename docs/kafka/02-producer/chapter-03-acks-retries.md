# ACK 机制与重试

> ACK 机制控制消息写入多少副本后才算成功，重试机制处理临时故障。两者共同决定了消息的可靠性。本章讲清三种 ACK 模式、幂等生产者原理，以及重试与顺序的关系。

## 1. 三种 ACK 模式

| acks | 说明 | 可靠性 | 吞吐量 |
| :-- | :-- | :-- | :-- |
| 0 | 不等确认，发完就忘 | 最低（可能丢消息） | 最高 |
| 1 | Leader 写入后确认 | 中（Leader 宕机可能丢） | 中 |
| all | ISR 全部写入后确认 | 最高 | 最低 |

### 1.1 acks=0

```text
Producer → Broker：发完即返回
不等待任何确认
```

适用场景：日志收集、监控指标等允许丢失的场景。

### 1.2 acks=1

```text
Producer → Leader：写入本地日志
Leader → Producer：返回 ACK
之后 Leader 宕机 → Follower 未同步 → 数据丢失
```

风险：Leader 写入后、Follower 同步前 Leader 宕机，数据丢失。

### 1.3 acks=all

```text
Producer → Leader：写入本地日志
Leader → Follower1：同步
Leader → Follower2：同步
Follower1 → Leader：确认
Follower2 → Leader：确认
Leader → Producer：所有 ISR 确认后返回 ACK
```

配合 `min.insync.replicas=2`，保证至少 2 个副本同步成功。

```properties
acks=all
min.insync.replicas=2   # ISR 至少 2 个副本
```

> `min.insync.replicas=2` + `acks=all` 是生产环境的标配。如果 ISR 只剩 1 个副本，Broker 拒绝写入（`NotEnoughReplicasException`），避免在可靠性不足时继续写入。

## 2. 幂等生产者

重试可能导致消息重复。幂等生产者通过 PID + Sequence Number 保证「恰好一次」写入。

### 2.1 原理

```text
Producer 启动 → InitProducerIdRequest → Broker 分配 PID
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

### 2.2 配置

```java
props.put("enable.idempotence", true);       // 开启幂等
props.put("acks", "all");                    // 必须
props.put("retries", Integer.MAX_VALUE);     // 无限重试
props.put("max.in.flight.requests.per.connection", 5);  // 允许 5 个在途请求
```

约束条件：

| 配置 | 要求 | 说明 |
| :-- | :-- | :-- |
| `acks` | 必须为 `all` | 否则无法保证幂等 |
| `retries` | > 0 | 否则幂等无意义 |
| `max.in.flight.requests.per.connection` | ≤ 5 | Kafka 内部重排序保证去重 |

## 3. 重试机制

### 3.1 配置

```java
props.put("retries", Integer.MAX_VALUE);
props.put("retry.backoff.ms", 100);          // 重试间隔
props.put("delivery.timeout.ms", 120000);    // 总超时 2 分钟
```

### 3.2 可重试异常

| 异常 | 说明 |
| :-- | :-- |
| `NotEnoughReplicasException` | ISR 副本不足 |
| `NetworkException` | 网络异常 |
| `LeaderNotAvailableException` | Leader 选举中 |
| `NotLeaderOrFollowerException` | 请求发到了非 Leader |

### 3.3 不可重试异常

| 异常 | 说明 |
| :-- | :-- |
| `RecordTooLargeException` | 消息过大 |
| `InvalidTopicException` | Topic 不存在 |
| `AuthorizationException` | 权限不足 |

## 4. 重试与顺序保证

当 `max.in.flight.requests.per.connection > 1` 时，重试可能导致消息乱序：

```text
发送 msg1 → 失败（重试中）
发送 msg2 → 成功
msg1 重试成功
结果：msg2 在 msg1 之前（乱序）
```

解决方案：

```java
// 方案1：关闭在途请求（性能差）
props.put("max.in.flight.requests.per.connection", 1);

// 方案2：开启幂等性（推荐）
props.put("enable.idempotence", true);
// 内部通过 Sequence Number 重排序，允许最多 5 个在途请求
```

## 5. 消息丢失与重复场景

| 场景 | 原因 | 解决方案 |
| :-- | :-- | :-- |
| 消息丢失 | acks=0/1，Leader 宕机 | acks=all + min.insync.replicas=2 |
| 重试重复 | 网络超时重试 | 幂等生产者 |
| 消费重复 | Offset 提交失败 | 幂等消费（业务去重） |

## 6. 回调中的异常处理

```java
producer.send(record, (metadata, exception) -> {
    if (exception != null) {
        if (exception instanceof RetriableException) {
            // 可重试异常，客户端会自动重试
            logger.warn("Retriable: {}", exception.getMessage());
        } else if (exception instanceof ProducerFencedException) {
            // 事务被抢占，必须关闭
            logger.error("Producer fenced");
            System.exit(1);
        } else {
            // 不可重试异常
            logger.error("Failed: {}", exception.getMessage());
        }
    } else {
        logger.info("Sent: partition={}, offset={}",
            metadata.partition(), metadata.offset());
    }
});
```

## 7. 最佳实践

1. **生产环境必须开启幂等**：`enable.idempotence=true`，几乎无性能损耗。
2. **不要设置 retries=0**：网络抖动是常态，重试是必要的。
3. **acks=all + min.insync.replicas=2**：生产标配。
4. **设置合理的 delivery.timeout.ms**：避免消息长时间阻塞。
5. **监控 failed-send-rate**：持续 > 0 说明有消息发送失败。
