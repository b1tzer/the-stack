# 消息丢失排查

> 消息从生产者到消费者经过三个环节，每个环节都可能丢数据。本文按环节逐一分析丢消息的原因和解决方案。

## 1. 现象

- 消费者处理的消息数量少于生产者发送的数量
- 下游系统缺少预期的数据
- 监控中发现生产端和消费端的计数不一致

## 2. 三个环节的丢消息场景

### 2.1 生产者 → Broker

| 场景 | 原因 | 解决方案 |
| :-- | :-- | :-- |
| acks=0 | 发完即返回，网络丢包无感知 | 改为 acks=all |
| acks=1 | Leader 写入后返回 ACK，Leader 宕机时 Follower 未同步 | 改为 acks=all |
| 发送异常未处理 | send() 的 Future 被忽略 | 检查回调或 .get() 返回值 |

```java
// 错误：忽略发送结果
producer.send(record);

// 正确：检查发送结果
producer.send(record, (metadata, exception) -> {
    if (exception != null) {
        logger.error("Send failed: {}", exception.getMessage());
    }
});
```

### 2.2 Broker 存储

| 场景 | 原因 | 解决方案 |
| :-- | :-- | :-- |
| 副本因子=1 | 单节点宕机，数据永久丢失 | default.replication.factor=3 |
| min.insync.replicas=1 | acks=all 但只有一个副本写入 | min.insync.replicas=2 |
| Unclean Leader 选举 | OSR 副本当选，丢失未同步数据 | unclean.leader.election.enable=false |
| 数据保留过期 | 消息被自动删除 | 合理配置 log.retention |

### 2.3 Broker → 消费者

| 场景 | 原因 | 解决方案 |
| :-- | :-- | :-- |
| 自动提交 Offset | 消息处理前 Offset 已提交，宕机后跳过 | enable.auto.commit=false |
| 手动提交时机不对 | 先提交再处理，处理失败时消息丢失 | 处理完再提交 |
| 消费者 Rebalance | 分区重新分配，未提交的 Offset 丢失 | Rebalance 监听器 + 手动提交 |

## 3. 排查步骤

### Step 1：确认是哪个环节

```bash
# 检查 Broker 侧的消息总量
kafka-run-class.sh kafka.tools.GetOffsetShell \
    --broker-list localhost:9092 --topic my-topic --time -1

# 对比生产者的发送计数
# 对比消费者的消费计数
```

### Step 2：检查生产端配置

```bash
# 检查 Topic 的副本配置
kafka-topics.sh --describe --topic my-topic --bootstrap-server localhost:9092

# 关注：
# - Replication Factor: 应为 3
# - ISR 列表: 应与副本数一致
```

### Step 3：检查消费端配置

```bash
# 查看消费者组的 Offset
kafka-consumer-groups.sh --describe --group my-group --bootstrap-server localhost:9092

# 关注：
# - CURRENT-OFFSET vs LOG-END-OFFSET: Lag 是否异常
# - 是否有分区的 CURRENT-OFFSET 为 -1（未提交）
```

### Step 4：检查 Broker 日志

```bash
grep -E "UncleanLeader|NotEnoughReplicas|DATA_LOSS" /var/kafka-logs/server.log
```

## 4. 防丢配置清单

```properties
# 生产者
acks=all
enable.idempotence=true
retries=Integer.MAX_VALUE
delivery.timeout.ms=120000

# Broker
default.replication.factor=3
min.insync.replicas=2
unclean.leader.election.enable=false

# 消费者
enable.auto.commit=false
isolation.level=read_committed  # 事务场景
```

## 5. 预防

- 上线前用 `kafka-producer-perf-test.sh` 和 `kafka-consumer-perf-test.sh` 做端到端计数对比
- 监控 `UnderReplicatedPartitions` 和 `UnderMinIsrPartitionCount`
- 消费者实现幂等处理，即使重复消费也不产生副作用
