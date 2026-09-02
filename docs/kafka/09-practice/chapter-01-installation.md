# 安装部署与环境配置

> 本文给出两套启动方案：单机 Docker Compose（最快验证）与 KRaft 集群（生产推荐）。先讲清两者的取舍，再给可复制的命令。

## 1. 先选部署模式

Kafka 有两种元数据管理模式，选择决定后续所有配置：

| 模式 | 依赖 | 适用 |
| :-- | :-- | :-- |
| ZooKeeper | 需额外部署 ZK 集群 | 存量环境、需兼容旧工具链 |
| KRaft | 无外部依赖，元数据由 Raft 组管理 | 新项目默认选择 |

KRaft 取代 ZooKeeper 的原因见 [整体架构](../01-basics/chapter-03-architecture.md) 的元数据管理一节，本文不再重复。结论只有一句：**新环境直接用 KRaft**。单机验证用 §2 的 Docker Compose 最快，生产集群用 §3 的命令。

## 2. Docker Compose 快速启动（单机验证）

单机验证用 ZK 模式的 Compose 最简——它把 ZooKeeper 和 Kafka 打包成两个容器，一条命令拉起。生产环境不要沿用这个 YAML，原因见 §1。

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

这段 YAML 里最容易被忽略的是 `KAFKA_ADVERTISED_LISTENERS`。Kafka 区分「监听地址」和「广播地址」两个概念：

```text
listeners            → Broker 实际监听的地址（容器内）
advertised.listeners → 返回给客户端的地址（容器外）
```

客户端拿到 `advertised.listeners` 后要能连上 Broker。这里填 `localhost:9092`，因为客户端在宿主机访问；若填成 `kafka:9092`，宿主机无法解析 `kafka` 这个容器内域名，连接会失败。这是 Compose 启动后客户端连不上的最常见原因。

`KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false"` 关闭自动建 Topic，避免 Topic 名拼错时悄悄创建出多余 Topic。

## 3. KRaft 模式（生产推荐）

KRaft 不需要 ZooKeeper，但启动前要先「格式化」——生成集群元数据，等价于 ZK 模式下手动初始化 ZooKeeper 节点：

```bash
# 1. 生成集群唯一标识（Cluster ID）
KAFKA_CLUSTER_ID=$(kafka-storage.sh random-uuid)

# 2. 用 Cluster ID 格式化存储目录，写入初始元数据
kafka-storage.sh format -t $KAFKA_CLUSTER_ID -c kraft/server.properties

# 3. 启动
kafka-server-start.sh kraft/server.properties
```

`format` 的 `-t` 参数就是上一步生成的 Cluster ID。KRaft 用 Raft 日志保存元数据，格式化这一步把 Cluster ID 和初始元数据写进 `log.dirs`，后续启动才有依据。**同一集群的每个节点必须用同一个 Cluster ID 格式化**，否则各节点元数据不一致，无法组成集群。

## 4. 验证安装

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

最后一条命令的两个参数都有明确作用：

- `--from-beginning`：消息在消费者启动前就已写入，默认 `auto.offset.reset=latest` 会跳过已有消息，必须显式从头读。
- `--max-messages 1`：读到 1 条就退出；否则控制台消费者会一直阻塞等待新消息，命令不会返回。
