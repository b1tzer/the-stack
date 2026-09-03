# Kafka 是什么

> Kafka 是分布式流处理平台，本质是一个可持久化、可回溯、高吞吐的分布式追加日志。本文建立 Kafka 的全貌认知：它是什么、架构怎么分层、核心组件如何协同。

## 1. 一句话定义

Apache Kafka 是分布式流处理平台，由 LinkedIn 开发，2011 年开源。它的本质是一个**分布式追加日志系统**——消息只能追加写入，不能修改，消费者按偏移量顺序读取。

```txt
Producer → [消息0][消息1][消息2][消息3]... → Consumer
           ──────── 追加日志（Partition）────────
```

Kafka 的三重身份：

| 身份 | 说明 |
| :-- | :-- |
| 消息队列 | 发布/订阅模式，解耦生产者和消费者 |
| 存储系统 | 持久化到磁盘，支持回溯消费 |
| 流处理平台 | Kafka Streams 实时处理数据流 |

## 2. 架构全景：两层结构

Kafka 集群由「数据面」和「控制面」两层构成：

![Kafka 整体架构](/kafka/01-basics-chapter-03-architecture.svg)

| 层次 | 组成 | 职责 |
| :-- | :-- | :-- |
| 数据面 | Producer、Broker、Consumer | 消息的实际生产、存储、消费 |
| 控制面 | Controller / 元数据层（KRaft / ZooKeeper） | 分区 Leader 选举、元数据管理、副本协调 |

一个关键事实：**控制面不处理任何业务消息**。它做的事是让数据面「知道该往哪发、从哪读」。消息本身只流经数据面，但数据面每走一步都要向控制面「问路」。

## 3. 核心组件

![Kafka 核心组件全景图](/kafka/01-basics-chapter-02-terminology.svg)

### 3.1 存储模型

消息的存储遵循一条层级链：**Topic → Partition → Segment → RecordBatch**。

| 组件 | 说明 | 为什么需要它 |
| :-- | :-- | :-- |
| Broker | Kafka 服务器节点 | 消息存储和请求处理的物理载体 |
| Topic | 消息的逻辑分类 | 让不同业务的数据隔离 |
| Partition | Topic 的物理分片 | 并行读写和水平扩展的基本单位 |
| Segment | Partition 内的日志段文件 | 控制删除粒度和索引大小 |
| Offset | 消息在分区内的唯一标识 | 消费者按 Offset 顺序读取，支持回溯 |

一个 Topic 被拆成多个 Partition，每个 Partition 是一条独立的追加日志。这个拆分带来两个直接结果：

| 结果 | 含义 |
| :-- | :-- |
| **并行度** | 一个 Topic 有几个分区，就能被几个消费者并行消费 |
| **顺序性** | 顺序只在单个分区内保证，跨分区无序 |

Partition 是 Kafka 水平扩展和并行的最小单位——单台 Broker 的吞吐存在上限，消息量超过单机上限时，唯一的出路是把数据拆开，分散到多台 Broker 并行写入、并行读取。

### 3.2 副本机制

节点可能宕机，所以每个 Partition 要复制出多个副本（Replica），分布在不同 Broker 上：

| 角色 | 说明 |
| :-- | :-- |
| Leader | 主副本，处理该分区的所有读写请求 |
| Follower | 从副本，从 Leader 同步数据，不处理客户端请求 |
| ISR | In-Sync Replicas，与 Leader 保持同步的副本集合 |

**读写都只走 Leader**——Follower 不接收客户端读写，它只从 Leader 拉数据，作为高可用的备份。这样设计的原因：一个分区若允许多个副本同时接写，写入顺序就会分叉；Follower 若接读，又可能返回尚未同步的旧数据。让 Leader 独占读写，是最简单的一致性方案。

ISR 是 Kafka 可靠性的核心。副本落后于 Leader 超过 `replica.lag.time.max.ms`（默认 30 秒）会被移出 ISR，追上后重新加入。`acks=all` 表示消息必须写入所有 ISR 副本才算成功。

### 3.3 消息的旅程

**写入：Producer → 分区 Leader**

```txt
Producer 根据元数据定位「目标分区 Leader 所在 Broker」
    │
    ▼
发送请求到该 Broker
    │
    ▼
Leader 写入本地日志，副本异步同步
    │
    ▼
按 acks 策略向 Producer 确认
```

**读取：Consumer ← 分区 Leader**

```txt
Consumer 发起 Fetch 请求
    │
    ▼
请求发往分区 Leader
    │
    ▼
Broker 从日志读取，经 sendfile() 零拷贝返回
    │
    ▼
Consumer 反序列化、处理、提交 Offset
```

Producer 和 Consumer 都只与分区 Leader 打交道，Follower 是为高可用而存在的备份。

### 3.4 控制面：谁在支撑数据面

Producer 和 Consumer 凭什么知道「目标分区的 Leader 在哪台 Broker」？靠的是一份由 Controller 统一维护、持续广播到全集群的元数据。这就是控制面存在的根本原因：分布式系统里，客户端不可能自己记住所有分区的 Leader 位置，必须有一个权威源统一管理并对外提供。

早期 Controller 依赖 ZooKeeper，Kafka 4.0 起用内置的 KRaft 元数据协议取代 ZooKeeper，不再需要单独维护 ZooKeeper 集群。

## 4. 为什么快

Kafka 的高吞吐来自四个机制：

| 机制 | 原理 | 效果 |
| :-- | :-- | :-- |
| 顺序写入 | 消息追加到日志文件末尾 | 顺序磁盘写比随机写快 1000 倍 |
| 零拷贝 | `sendfile()` 跳过用户态，数据从内核缓冲区直达网卡 | 减少 CPU 拷贝和上下文切换 |
| 批量发送 | 消息攒批再发 | 减少网络往返与 TCP 开销 |
| 页缓存 | 消息写入操作系统页缓存而非 JVM 堆 | 读取未落盘消息时直接从内存返回 |

深度解析见 [为什么 Kafka 这么快](../04-performance/chapter-01-why-kafka-is-fast.md)。

## 5. 性能参考

Benchmark 数据依赖消息大小、压缩、副本因子、硬件与网络，只能作为上界参考。

| 场景 | 吞吐量 | 来源 |
| :-- | :-- | :-- |
| 单生产者，无副本 | 82 万条/秒 | [LinkedIn 2014](https://engineering.linkedin.com/kafka/benchmarking-apache-kafka-2-million-writes-second-three-cheap-machines) |
| 3 生产者，3 副本异步 | 202 万条/秒 | 同上 |
| 端到端延迟 | 中位 2ms，p99 3ms | 同上 |
| Kafka 峰值吞吐 | 605 MB/s | [Confluent 2020](https://www.confluent.io/blog/kafka-fastest-messaging-system/) |
| Pulsar 峰值吞吐 | 305 MB/s | 同上 |
| RabbitMQ 峰值吞吐 | 38 MB/s | 同上 |

## 6. 典型使用场景

| 场景 | 说明 | 代表用户 |
| :-- | :-- | :-- |
| 日志收集 | 应用日志 → Kafka → ELK | LinkedIn、Netflix |
| 事件驱动 | 服务间异步通信 | Uber、Airbnb |
| 数据管道 | MySQL → Debezium → Kafka → 数仓 | 大多数数据团队 |
| 流式处理 | Kafka → Flink/Streams → 结果 | 实时风控、推荐 |
| 指标监控 | 应用指标 → Kafka → Prometheus | 运维监控 |

## 7. 下一步

- 不确定 Kafka 是否适合你的场景？→ [消息队列选型](./chapter-03-mq-comparison.md)
- 想系统学习？→ [学习路径](./chapter-02-learning-path.md)
- 想深入某个主题？→ 从 `02-core/` 目录开始，每个文档聚焦一个核心概念
