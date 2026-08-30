# 整体架构

> Kafka 的架构由 Broker 集群、元数据管理层、生产者、消费者四部分组成。本章从数据流向入手，拆解每条链路的工作原理。

## 1. 架构全景

```text
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

```text
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

```text
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

### 5.1 ISR 写入流程

```text
Producer 发送消息到 Leader
    │
    ▼
Leader 写入本地日志，更新 LEO（Log End Offset）
    │
    ▼
Follower 发送 Fetch 请求拉取新消息
    │
    ▼
Follower 写入本地日志，更新自己的 LEO
    │
    ▼
Leader 更新 HW（High Watermark）= min(所有 ISR 的 LEO)
    │
    ▼
HW 之前的消息对消费者可见
```

| 概念 | 说明 |
| :-- | :-- |
| LEO | Log End Offset，日志末尾偏移量（下一条写入的位置） |
| HW | High Watermark，高水位线（消费者可见的最大 Offset） |
| ISR | 与 Leader 保持同步的副本集合 |

> 消费者只能读到 HW 之前的消息。HW 以下的消息才是「已提交」的——这保证了消费者不会读到可能丢失的数据。

### 5.2 ISR 动态调整

```text
replica.lag.time.max.ms = 30000（默认30秒）

Follower 超过 30 秒没有 Fetch 请求 → 移出 ISR
Follower 恢复同步、追上 Leader → 加回 ISR
```

ISR 收缩的危险：如果 ISR 只剩 Leader 一个副本，acks=all 等同于 acks=1，可靠性下降。

## 6. 元数据管理

### 6.1 ZooKeeper 模式（旧）

```text
ZooKeeper 存储：
  /brokers/ids/{broker_id}         → Broker 注册
  /brokers/topics/{topic}/partitions → 分区分配
  /controller                      → Controller 选举
```

问题：ZooKeeper 是外部依赖，增加运维复杂度；Controller 是单点；ZooKeeper 不适合存储大量分区元数据。

### 6.2 KRaft 模式（新）

```text
KRaft Controller（3~5 个节点的 Raft 集群）
  └── __cluster_metadata Topic（存储所有元数据）
  └── 通过 Raft 日志复制保证一致性
```

KRaft 的优势：去掉外部依赖、Controller 多节点冗余、支持百万级分区、启动更快。

## 7. 最佳实践

1. **避免单点 Controller**：ZooKeeper 模式下监控 Controller 状态，KRaft 模式天然多 Controller。
2. **合理规划 Broker 数量**：Broker ≥ 副本因子，推荐 3 个以上。
3. **使用 Rack Awareness**：配置 `broker.rack` 让副本分布在不同机架。
4. **监控 ISR 收缩**：ISR 收缩意味着可靠性下降，及时排查慢副本。
5. **新项目用 KRaft**：避免 ZooKeeper 的运维复杂度。
