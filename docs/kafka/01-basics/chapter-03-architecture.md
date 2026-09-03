# 整体架构

> Kafka 的架构由 Broker 集群、元数据管理层、生产者、消费者四部分组成。本章从数据流向入手，拆解每条链路的工作原理。

## 1. 架构全景

```txt
┌─────────────────────────────────────────────────────────┐
│                    Kafka Cluster                        │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │ Broker 1 │  │ Broker 2 │  │ Broker 3 │             │
│  │          │  │          │  │          │             │
│  │ Topic A  │  │ Topic A  │  │ Topic A  │             │
│  │ P0(Leader│  │ P1(Leader│  │ P2(Leader│             │
│  │ P1(F)    │  │ P2(F)    │  │ P0(F)    │             │
│  └──────────┘  └──────────┘  └──────────┘             │
│                                                         │
│  ┌──────────────────────────────────────┐              │
│  │  元数据管理：KRaft / ZooKeeper        │              │
│  └──────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────┘
        ▲                              │
        │                              ▼
  ┌──────────┐                  ┌──────────────┐
  │ Producer │                  │ Consumer     │
  │ (写入)    │                  │ Group (消费)  │
  └──────────┘                  └──────────────┘
```

## 2. 核心组件

| 组件 | 职责 |
| :-- | :-- |
| Broker | 存储消息，处理读写请求，副本同步 |
| KRaft/ZooKeeper | 集群协调，元数据管理，Controller 选举 |
| Producer | 发送消息到 Topic 的 Leader 副本 |
| Consumer Group | 从 Topic 消费消息，组内竞争 |
| Connect | 连接外部系统（MySQL、ES 等） |
| Streams | 流处理 API |

## 3. 生产者写入链路

```txt
Producer.send(record)
    │
    ▼
拦截器链（onSend / onAcknowledgement）
    │
    ▼
序列化器（Key / Value 序列化为字节）
    │
    ▼
分区器（根据 Key 或轮询选择分区）
    │
    ▼
RecordAccumulator（按分区聚合到 Deque<ProducerBatch>）
    │  ┌─────────────────────────────────┐
    │  │ batch.size = 16KB（默认）         │
    │  │ linger.ms = 0（默认不等待）       │
    │  │ 达到 batch.size 或 linger.ms     │
    │  │ 触发 Sender 线程发送             │
    │  └─────────────────────────────────┘
    ▼
Sender 线程（从累加器取 batch，构造 Request）
    │
    ▼
NetworkClient（选择 ready 的 Broker 连接）
    │
    ▼
Broker（写入 Leader 副本）
    │
    ▼
副本同步（Leader → Follower，ISR 机制）
    │
    ▼
ACK 返回给 Producer
```

### 3.1 关键配置

| 配置 | 默认值 | 说明 |
| :-- | :-- | :-- |
| `acks` | 1 | 0=不等确认、1=Leader确认、all=ISR全部确认 |
| `retries` | Integer.MAX_VALUE | 重试次数 |
| `batch.size` | 16384 | 单个 batch 最大字节数 |
| `linger.ms` | 0 | 发送前等待时间（增大可提高吞吐） |
| `buffer.memory` | 33554432 | 生产者缓冲区总大小（32MB） |

## 4. 消费者读取链路

```txt
Consumer.poll(Duration)
    │
    ▼
Fetch 请求发往分区 Leader
    │  ┌─────────────────────────────────┐
    │  │ fetch.min.bytes = 1（默认）       │
    │  │ fetch.max.wait.ms = 500          │
    │  │ max.partition.fetch.bytes = 1MB  │
    │  └─────────────────────────────────┘
    ▼
Broker 从日志文件读取数据
    │
    ▼
sendfile() 零拷贝返回
    │
    ▼
Consumer 反序列化消息
    │
    ▼
业务处理
    │
    ▼
提交 Offset（自动或手动）
```

### 4.1 关键配置

| 配置 | 默认值 | 说明 |
| :-- | :-- | :-- |
| `group.id` | — | 消费者组 ID（必填） |
| `auto.offset.reset` | latest | 无 offset 时从哪里开始消费 |
| `enable.auto.commit` | true | 是否自动提交 offset |
| `max.poll.records` | 500 | 单次 poll 最大返回记录数 |
| `session.timeout.ms` | 45000 | 会话超时时间 |

## 5. 副本同步机制

ISR 写入流程、LEO/HW 概念、ISR 动态调整，见 [副本机制](../05-storage-internals/chapter-03-replication.md) §2~§4。

## 6. 元数据管理

### 6.1 ZooKeeper 模式（旧）

```txt
ZooKeeper 存储：
  /brokers/ids/{broker_id}         → Broker 注册
  /brokers/topics/{topic}/partitions → 分区分配
  /controller                      → Controller 选举
```

问题：ZooKeeper 是外部依赖，增加运维复杂度；Controller 是单点；ZooKeeper 不适合存储大量分区元数据。

### 6.2 KRaft 模式（新）

```txt
KRaft Controller（3~5 个节点的 Raft 集群）
  └── __cluster_metadata Topic（存储所有元数据）
  └── 通过 Raft 日志复制保证一致性
```

KRaft 的优势：去掉外部依赖、Controller 多节点冗余、支持百万级分区、启动更快。

