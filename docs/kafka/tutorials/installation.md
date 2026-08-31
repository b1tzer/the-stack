# 安装部署与环境配置

## Docker Compose 快速启动

```yaml
version: '3'
services:
  zookeeper:
    image: confluentinc/cp-zookeeper:7.6.0
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
    ports:
      - "2181:2181"

  kafka:
    image: confluentinc/cp-kafka:7.6.0
    depends_on:
      - zookeeper
    ports:
      - "9092:9092"
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false"
```

```bash
docker-compose up -d
```

## KRaft 模式（无 ZooKeeper）

```bash
# 生成集群 UUID
KAFKA_CLUSTER_ID=$(kafka-storage.sh random-uuid)

# 格式化存储目录
kafka-storage.sh format -t $KAFKA_CLUSTER_ID -c kraft/server.properties

# 启动
kafka-server-start.sh kraft/server.properties
```

## 验证安装

```bash
# 创建测试 Topic
kafka-topics.sh --bootstrap-server localhost:9092 \
  --create --topic test --partitions 1 --replication-factor 1

# 生产消息
echo "hello kafka" | kafka-console-producer.sh \
  --bootstrap-server localhost:9092 --topic test

# 消费消息
kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic test --from-beginning --max-messages 1
```
