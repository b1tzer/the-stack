# 消息丢失排查

> 消息丢失的排查需要按环节逐一检查。本文是一个实操排查指南。

## 1. 现象

- 消费者处理的消息数量少于生产者发送的数量
- 下游系统缺少预期的数据

## 2. 排查步骤

### Step 1：确认丢失环节

```bash
# Broker 侧消息总量
kafka-run-class.sh kafka.tools.GetOffsetShell \
    --broker-list localhost:9092 --topic my-topic --time -1

# 对比生产者发送计数和消费者消费计数
```

- Broker 数量 = 生产者发送量 → 问题在消费端
- Broker 数量 < 生产者发送量 → 问题在生产端

### Step 2：检查生产端

```bash
kafka-topics.sh --describe --topic my-topic --bootstrap-server localhost:9092
```

检查项：

| 检查项 | 正常值 | 异常值 |
| :-- | :-- | :-- |
| Replication Factor | ≥ 3 | 1 |
| ISR 列表长度 | = 副本数 | < 副本数 |
| min.insync.replicas | ≥ 2 | 1 |

### Step 3：检查消费端

```bash
kafka-consumer-groups.sh --describe --group my-group --bootstrap-server localhost:9092
```

检查项：

| 检查项 | 正常 | 异常 |
| :-- | :-- | :-- |
| CURRENT-OFFSET | 递增 | -1（未提交） |
| enable.auto.commit | false | true |

### Step 4：检查 Broker 日志

```bash
grep -E "UncleanLeader|NotEnoughReplicas" /var/kafka-logs/server.log
```

## 3. 快速修复

```properties
# 生产者
acks=all
enable.idempotence=true

# Broker
default.replication.factor=3
min.insync.replicas=2
unclean.leader.election.enable=false

# 消费者
enable.auto.commit=false
```

详见 [消息丢失](../reliability/chapter-01-message-loss.md)。
