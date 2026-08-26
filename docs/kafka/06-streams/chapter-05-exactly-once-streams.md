# Streams Exactly Once

## 1. 配置

```java
Properties props = new Properties();
props.put("processing.guarantee", "exactly_once_v2");
```

## 2. 实现原理

- 幂等生产者
- 事务
- 原子性写入

## 3. 限制

- 必须使用 Kafka 作为 Source 和 Sink
- 性能有一定损耗

## 4. At Least Once vs Exactly Once

| 模式 | 配置 | 说明 |
|------|------|------|
| at_least_once | 默认 | 可能重复处理 |
| exactly_once_v2 | processing.guarantee | 精确一次 |

## 5. Exactly Once 实现原理

```
Kafka Streams Exactly Once 实现：

1. 每个 Stream Thread 有自己的 Producer 实例
2. 使用事务将以下操作原子化：
   - 读取 Source Topic 的 Offset
   - 写入中间 Topic 的消息
   - 写入 Sink Topic 的消息
   - 更新状态存储（Changelog Topic）

3. 事务流程：
   beginTransaction()
   ├── 读取消息
   ├── 处理消息
   ├── 写入输出 Topic
   ├── 更新状态存储
   ├── 提交消费 Offset
   commitTransaction()
```

## 6. Exactly Once vs At Least Once

| 特性 | at_least_once | exactly_once_v2 |
|------|---------------|------------------|
| 消息重复 | 可能重复 | 不重复 |
| 状态重复 | 可能重复更新 | 不重复更新 |
| 性能 | 高 | 中（事务开销） |
| 配置 | 默认 | `processing.guarantee=exactly_once_v2` |
| 适用场景 | 容忍重复 | 金融、计费等 |

## 7. 端到端 Exactly Once

```java
// Streams 应用配置
Properties props = new Properties();
props.put(StreamsConfig.APPLICATION_ID_CONFIG, "exactly-once-app");
props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(StreamsConfig.PROCESSING_GUARANTEE_CONFIG, "exactly_once_v2");

// 生产者配置（自动应用）
// enable.idempotence=true
// transactional.id={application-id}-{thread-id}
// acks=all

// 消费者配置（自动应用）
// isolation.level=read_committed
```

## 8. Exactly Once 的限制与注意事项

**限制**：
- 必须使用 Kafka 作为 Source 和 Sink（不能是外部系统）。
- 状态存储的 Changelog Topic 必须可用。
- 性能比 At Least Once 低 10-30%。

**注意事项**：
- 事务超时时间（`transaction.timeout.ms`）影响 Exactly Once 的可靠性。
- 长时间处理可能导致事务超时，建议将大批次拆分为小批次。
- 监控 `failed-stream-threads` 指标，及时处理异常。

## 9. 与外部系统的 Exactly Once

当需要与外部系统（如数据库）交互时，Kafka Streams 的 Exactly Once 无法覆盖：

```java
// 场景：写入 Kafka 和数据库
// Kafka Streams 只能保证 Kafka 到 Kafka 的 Exactly Once
// 写入数据库需要额外的幂等机制

KStream<String, String> stream = builder.stream("input");
stream.foreach((key, value) -> {
    // 幂等写入数据库（使用 UPSERT 或唯一约束）
    jdbcTemplate.update(
        "INSERT INTO events (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = ?",
        key, value, value
    );
});
```

## 10. 最佳实践

1. **金融/计费场景使用 exactly_once_v2**：数据一致性是首要考虑。
2. **监控事务提交延迟**：如果延迟过高，考虑减小批次大小或增加 Stream Thread 数。
3. **使用适当的重试策略**：`retries` 和 `retry.backoff.ms` 配置合理的重试行为。
4. **测试 Exactly Once 语义**：在测试环境中模拟 Broker 故障，验证数据一致性。
