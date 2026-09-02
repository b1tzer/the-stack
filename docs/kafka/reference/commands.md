# Kafka 命令速查

## Topic 管理

```bash
# 创建 Topic
kafka-topics.sh --bootstrap-server localhost:9092 \
  --create --topic my-topic --partitions 6 --replication-factor 3

# 查看 Topic 列表
kafka-topics.sh --bootstrap-server localhost:9092 --list

# 查看 Topic 详情
kafka-topics.sh --bootstrap-server localhost:9092 \
  --describe --topic my-topic

# 修改分区（只能增加）
kafka-topics.sh --bootstrap-server localhost:9092 \
  --alter --topic my-topic --partitions 12

# 删除 Topic
kafka-topics.sh --bootstrap-server localhost:9092 \
  --delete --topic my-topic
```

## 生产者测试

```bash
# 控制台生产者
kafka-console-producer.sh --bootstrap-server localhost:9092 \
  --topic my-topic

# 带 Key 生产
kafka-console-producer.sh --bootstrap-server localhost:9092 \
  --topic my-topic --property "parse.key=true" --property "key.separator=:"
```

## 消费者测试

```bash
# 从头消费
kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic my-topic --from-beginning

# 带 Key 消费
kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic my-topic --from-beginning \
  --property "print.key=true" --property "key.separator=:"

# 指定消费者组
kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic my-topic --group my-group
```

## Consumer Group 管理

```bash
# 查看消费者组列表
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --list

# 查看消费者组详情
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --describe --group my-group

# 重置 offset
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --group my-group --topic my-topic --reset-offsets --to-earliest --execute
```

## 集群管理

```bash
# 查看 Broker 列表
kafka-broker-api-versions.sh --bootstrap-server localhost:9092

# 查看集群信息
kafka-metadata.sh --snapshot /path/to/metadata-log --cluster-id <id>
```
