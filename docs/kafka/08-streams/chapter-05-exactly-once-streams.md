# Streams Exactly Once

> Streams 的端到端 Exactly Once 用 `processing.guarantee=exactly_once_v2` 开启。它用 Kafka 事务协调「输出 Topic 写入、状态 Changelog 写入、输入位点提交」的原子提交，而不是让读取操作与本地状态存储本身直接参与事务。事务机制（PID、Epoch、Coordinator、read_committed）不在本文展开——见 [ACK 与幂等 §4 事务](../02-core/chapter-05-ack-and-idempotence.md#transactions) 与 [Exactly Once 语义](../03-reliability/chapter-04-exactly-once.md)。本文只讲 Streams 侧的配置、语义边界和限制。

## 1. 配置

```java
Properties props = new Properties();
props.put(StreamsConfig.APPLICATION_ID_CONFIG, "exactly-once-app");
props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(StreamsConfig.PROCESSING_GUARANTEE_CONFIG, "exactly_once_v2");
```

`exactly_once_v2` 由 KIP-447 引入，要求 Kafka Broker 版本不低于 2.5。

设为 `exactly_once_v2` 后，Streams 会自动应用：

```txt
生产者：enable.idempotence=true、acks=all，事务发送输出与状态变更；transactional.id 由 Streams 内部生成（格式是实现细节）
消费者：isolation.level=read_committed
提交频率：commit.interval.ms 默认值从 30s 调整为 100ms
```

## 2. 事务覆盖范围

每个 Stream Thread 有自己的 Producer 实例。开启 EOS 后，一次 Kafka 事务把以下内容原子化：

- 输出 Topic 的写入（含中间 Topic 与 Sink Topic）
- 开启日志记录的状态存储所对应的 Changelog 写入
- 输入位点的提交

处理流程：

```txt
处理输入记录
  ├── 更新本地状态存储
  │     └── 写入状态 Changelog
  ├── 写入输出 Topic
  └── 提交输入位点
        │
        ▼
    Kafka 事务提交
```

本地状态更新不等于事务已经提交：本地 RocksDB 等存储的变更发生在事务提交之前，EOS 并不直接回滚本地存储。发生故障时，Streams 通过状态恢复与事务提交语义恢复到一致的处理结果。此外，并非所有状态存储都开启日志记录，没有 Changelog 的状态存储不参与上述事务写入。

语义边界与消费-生产事务一致：保证的是 Kafka 内部「输出消息 + 状态 Changelog + 消费位点」的原子提交，不保证业务代码只执行一次，也不会让外部副作用自动变成恰好一次。

## 3. 与 At Least Once 对比

| 特性 | at_least_once（默认） | exactly_once_v2 |
| :-- | :-- | :-- |
| Kafka 输出 | 故障恢复后可能产生重复的已提交输出 | 对 read_committed 消费者，避免同一处理结果因重试而重复提交 |
| 状态变更效果 | 故障恢复后可能重复反映同一输入记录的处理效果 | 与输出、输入位点保持原子提交的一致 |
| 性能 | 事务开销较低 | 需要事务协调与提交，实际吞吐量与延迟需按目标拓扑压测 |
| 配置 | 默认 | `processing.guarantee=exactly_once_v2` |
| 适用场景 | 容忍重复 | 金融、计费等 |

> 注意：EOS 保证的是已提交结果的原子一致，不是处理代码物理上只执行一次。故障后处理逻辑可能重新执行，只是未提交的事务输出不会被 read_committed 消费者读取；使用 read_uncommitted 的消费者仍可能读到已中止事务中的记录。

## 4. 限制与注意事项

**限制**：

- EOS 的原子提交只覆盖 Kafka 内部的输入、输出与状态处理，不覆盖外部系统的读写。
- 开启日志记录的状态存储，其 Changelog Topic 必须可用。
- 事务会增加协调与提交开销（见上表）。

**注意事项**：

- 事务必须在 Broker 允许的超时时间内完成。处理耗时过长会导致事务中止并触发重试，应结合单次处理耗时、`commit.interval.ms` 与 Broker 的 `transaction.max.timeout.ms` 检查 `transaction.timeout.ms` 配置。
- 生产环境应保证事务状态日志、消费位点及相关 Topic 具有适当的副本与最小同步副本配置。启用 EOS 不意味着可以忽略集群的持久性与可用性配置。
- 监控 `failed-stream-threads` 指标，结合应用日志与具体异常定位 Stream Thread 异常退出原因。

## 5. 与外部系统的 Exactly Once

`exactly_once_v2` 只覆盖 Kafka 事务管理范围内的输出与状态处理。通过 `foreach`、自定义 Processor 等方式直接写数据库时，数据库提交与 Kafka 事务互不协调：数据库写入已成功、而对应的 Kafka 输入位点未能提交时，相关记录可能被重新处理，数据库操作也会再次执行。

```java
// 只有在 id 是稳定的业务键、且重复执行不会产生额外业务副作用时，
// UPSERT 才能实现所需的幂等效果。此数据库写入不受 Kafka 事务保护。

KStream<String, String> stream = builder.stream("input");
stream.foreach((key, value) -> {
    jdbcTemplate.update(
        "INSERT INTO events (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = ?",
        key, value, value
    );
});
```

跨 Kafka 与数据库的一致性需要单独设计幂等、去重或跨系统协调机制（如事务 Outbox、消费端幂等、可靠 CDC），不在本文展开。
