# Kafka 概览

> Kafka 是什么、为什么快、用在哪——这三个问题的答案构成了理解 Kafka 的起点。本章从设计哲学出发，讲清 Kafka 的核心优势与适用场景。

## 1. 什么是 Kafka

Apache Kafka 是分布式流处理平台，由 LinkedIn 开发，2011 年开源。它的本质是一个**分布式追加日志系统**——消息只能追加写入，不能修改，消费者按偏移量顺序读取。

```text
Producer → [消息0][消息1][消息2][消息3]... → Consumer
           ──────── 追加日志（Partition）────────
```

Kafka 的三重身份：

| 身份 | 说明 |
| :-- | :-- |
| 消息队列 | 发布/订阅模式，解耦生产者和消费者 |
| 存储系统 | 持久化到磁盘，支持回溯消费 |
| 流处理平台 | Kafka Streams 实时处理数据流 |

## 2. 为什么 Kafka 这么快

Kafka 的吞吐量可达百万级 QPS，核心原因有四个：

### 2.1 顺序写入

Kafka 把消息追加到日志文件末尾，磁盘顺序写入的性能接近内存随机写入：

```text
顺序写入：600 MB/s（HDD）/ 3 GB/s（SSD）
随机写入：100 MB/s（HDD）/ 500 MB/s（SSD）
```

传统消息队列用 B+ 树或链表管理消息，写入是随机的。Kafka 用追加日志，写入是顺序的——这是吞吐量差距的根本原因。

### 2.2 零拷贝（Zero Copy）

传统方式读取磁盘数据发送到网络需要 4 次拷贝：

```text
磁盘 → 内核缓冲区 → 用户缓冲区 → Socket 缓冲区 → 网卡
       （DMA拷贝）   （CPU拷贝）   （CPU拷贝）    （DMA拷贝）
```

Kafka 使用 Linux 的 `sendfile()` 系统调用，跳过用户态：

```text
磁盘 → 内核缓冲区 → 网卡
       （DMA拷贝）  （DMA拷贝）
```

零拷贝减少了 2 次 CPU 拷贝和 2 次上下文切换，吞吐量提升 2~3 倍。

### 2.3 批量发送

生产者不是每条消息都发一次网络请求，而是攒够一批再发：

```text
单条发送：1000 条消息 = 1000 次网络请求
批量发送：1000 条消息 = 10 次网络请求（每批 100 条）
```

批量减少了网络往返次数、TCP 握手开销、Broker 端的写入次数。

### 2.4 页缓存（Page Cache）

Kafka 不在 JVM 堆内管理消息数据，而是依赖操作系统的页缓存：

```text
写入：消息 → 页缓存 → 异步刷盘
读取：页缓存命中 → 直接返回（不访问磁盘）
```

页缓存的优势：利用操作系统的空闲内存做缓存，读取未落盘的消息时直接从内存返回，速度接近纯内存系统。

## 3. 核心能力

| 能力 | 说明 |
| :-- | :-- |
| 消息队列 | 发布/订阅模式，解耦生产者和消费者 |
| 流处理 | Kafka Streams 实时处理数据流 |
| 数据管道 | Kafka Connect 连接不同系统 |
| 持久化 | 消息写入磁盘，支持长期保留 |
| 水平扩展 | 分区机制，加 Broker 即可扩容 |

## 4. 与 RabbitMQ/RocketMQ 对比

| 特性 | Kafka | RabbitMQ | RocketMQ |
| :-- | :-- | :-- | :-- |
| 吞吐量 | 极高（百万级） | 中等（万级） | 高（十万级） |
| 延迟 | 毫秒级 | 微秒级 | 毫秒级 |
| 消息模型 | 发布/订阅 | 队列/发布订阅 | 队列/发布订阅 |
| 消息回溯 | ✅ | ❌ | ✅ |
| 流处理 | ✅ Streams | ❌ | ❌ |
| 消息堆积 | 不影响性能 | 性能下降 | 影响较小 |
| 适用场景 | 日志/大数据/事件驱动 | 业务消息 | 电商/金融 |

选型决策树：

```text
需要消息队列
  ├─ 高吞吐 + 大数据生态 → Kafka
  ├─ 业务消息 + 复杂路由 → RabbitMQ
  ├─ 金融级事务 + 低延迟 → RocketMQ
  └─ 多租户 + 存储分离 → Pulsar
```

## 5. 使用场景

| 场景 | 说明 | 代表用户 |
| :-- | :-- | :-- |
| 日志收集 | 应用日志 → Kafka → ELK | LinkedIn、Netflix |
| 事件驱动 | 服务间异步通信 | Uber、Airbnb |
| 数据管道 | MySQL → Debezium → Kafka → 数仓 | 大多数数据团队 |
| 流式处理 | Kafka → Flink/Streams → 结果 | 实时风控、推荐 |
| 指标监控 | 应用指标 → Kafka → Prometheus | 运维监控 |

## 6. 设计哲学

Kafka 的核心设计理念是**将持久化、高吞吐和分布式统一起来**：

| 设计 | 说明 | 效果 |
| :-- | :-- | :-- |
| 追加写入 | 消息只能追加到日志末尾 | 顺序写入 O(1)，吞吐量极高 |
| 分区并行 | Topic 分成多个 Partition | 水平扩展，并行消费 |
| 消费组隔离 | 不同消费组独立消费 | 天然支持发布/订阅 |
| 存储计算分离 | Kafka 只存储，不关心消费逻辑 | 消费者可随时回溯 |
| Pull 模型 | 消费者主动拉取消息 | 消费者控制速率，不会被打爆 |

## 7. 版本演进

| 版本 | 里程碑 |
| :-- | :-- |
| 0.8 | 引入副本机制 |
| 0.10 | 引入 Kafka Streams |
| 0.11 | 引入事务和 Exactly Once 语义 |
| 2.0 | 引入 AdminClient API |
| 2.8 | 引入 KRaft（早期预览） |
| 3.3 | KRaft 生产就绪 |
| 3.7 | ZooKeeper 模式正式弃用通知 |
| 4.0 | 默认 KRaft，移除 ZooKeeper |

> 新项目直接使用 KRaft 模式，避免 ZooKeeper 的运维复杂度。KRaft 用 Raft 协议管理元数据，去掉了外部依赖，部署更简单、扩展更容易。

## 8. 快速体验

```bash
# 启动 Kafka（KRaft 模式）
kafka-storage.sh random-uuid
kafka-storage.sh format -t $(kafka-storage.sh random-uuid) -c config/kraft/server.properties
kafka-server-start.sh config/kraft/server.properties

# 创建 Topic
kafka-topics.sh --create --topic test --partitions 3 --replication-factor 1 --bootstrap-server localhost:9092

# 生产消息
kafka-console-producer.sh --topic test --bootstrap-server localhost:9092

# 消费消息
kafka-console-consumer.sh --topic test --from-beginning --bootstrap-server localhost:9092
```

## 9. 最佳实践

1. **生产环境至少 3 个 Broker**：保证高可用，支持副本因子为 3。
2. **合理规划分区数**：分区数 = 期望的消费者并发数，分区一旦创建只能增加不能减少。
3. **使用 KRaft 模式**：新项目直接使用 KRaft，避免 ZooKeeper。
4. **监控消费者 Lag**：这是衡量系统健康度的关键指标。
