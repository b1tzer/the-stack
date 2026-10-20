# Kafka 命令速查

以下命令以 Kafka 自带的 Shell 脚本为例，连接地址使用 `localhost:9092`，执行前请替换为实际集群的 Bootstrap Server 地址。KRaft 专用命令会单独标注。

## Topic 管理

```bash
# 创建 Topic
kafka-topics.sh --bootstrap-server localhost:9092 \
  --create --topic my-topic --partitions 6 --replication-factor 3

# 查看 Topic 列表
kafka-topics.sh --bootstrap-server localhost:9092 --list

# 查看 Topic 详情（分区、副本、Leader、ISR 等）
kafka-topics.sh --bootstrap-server localhost:9092 \
  --describe --topic my-topic

# 增加分区数；不能通过该命令减少分区
# 注意：增加分区可能改变按 Key 计算的分区映射，不会重分布历史消息
kafka-topics.sh --bootstrap-server localhost:9092 \
  --alter --topic my-topic --partitions 12

# 删除 Topic：会删除该 Topic 的数据，执行前确认操作对象
kafka-topics.sh --bootstrap-server localhost:9092 \
  --delete --topic my-topic
```

## 生产者测试

```bash
# 控制台生产者：每行输入一条消息
kafka-console-producer.sh --bootstrap-server localhost:9092 \
  --topic my-topic

# 带 Key 生产，输入格式为 key:value
kafka-console-producer.sh --bootstrap-server localhost:9092 \
  --topic my-topic \
  --property "parse.key=true" --property "key.separator=:"
```

启用 `parse.key` 后，控制台生产者按 `key.separator` 指定的分隔符解析 Key 和消息体。例如输入 `user-1:hello`，Key 为 `user-1`，消息体为 `hello`。

## 消费者测试

```bash
# 无可用位点时从最早的可用消息开始；已有有效位点时从已提交位点继续
kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic my-topic --from-beginning

# 消费时同时打印 Key 和消息体
kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic my-topic --from-beginning \
  --property "print.key=true" --property "key.separator=:"

# 指定消费者组；起始位置取决于已提交位点及 auto.offset.reset 配置
kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic my-topic --group my-group
```

## Consumer Group 管理

```bash
# 查看消费者组列表
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --list

# 查看消费者组的位点、消费进度和 Lag
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --describe --group my-group
```

重置位点前，先停止该消费者组的消费者实例，并检查预览结果。`--to-earliest` 将位点重置到各分区最早的可用位置，执行后消费者可能重新读取大量历史消息。

```bash
# 先预览将要重置的位点
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --group my-group --topic my-topic --reset-offsets --to-earliest

# 确认消费者实例已停止并检查预览结果后，执行位点重置
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --group my-group --topic my-topic --reset-offsets --to-earliest --execute
```

## 集群管理

```bash
# 查看可连接 Broker 支持的 API 版本
kafka-broker-api-versions.sh --bootstrap-server localhost:9092

# KRaft 模式：查看 Controller Quorum 状态
kafka-metadata-quorum.sh --bootstrap-server localhost:9092 describe --status

# KRaft 模式：读取元数据快照并进入交互式 Shell
# --snapshot 接收的是具体快照文件路径，替换为实际快照文件
kafka-metadata-shell.sh --snapshot /path/to/metadata-snapshot
```
