# 整体架构

## 1. 架构图

```
┌─────────┐  ┌─────────┐  ┌─────────┐
│Producer1│  │Producer2│  │Producer3│
└────┬────┘  └────┬────┘  └────┬────┘
     │            │            │
     └────────────┼────────────┘
                  │
     ┌────────────┼────────────┐
     │      Kafka Cluster      │
     │  ┌──────────────────┐  │
     │  │  Broker 1        │  │
     │  │  ┌─────────────┐ │  │
     │  │  │ Topic A     │ │  │
     │  │  │ Partition 0 │ │  │
     │  │  │ Partition 1 │ │  │
     │  │  └─────────────┘ │  │
     │  └──────────────────┘  │
     │  ┌──────────────────┐  │
     │  │  Broker 2        │  │
     │  │  ┌─────────────┐ │  │
     │  │  │ Topic A     │ │  │
     │  │  │ Partition 2 │ │  │
     │  │  └─────────────┘ │  │
     │  └──────────────────┘  │
     └────────────┬────────────┘
                  │
     ┌────────────┼────────────┐
     │ Consumer Group          │
     │ ┌────────┐ ┌────────┐  │
     │ │Consumer│ │Consumer│  │
     │ │   1    │ │   2    │  │
     │ └────────┘ └────────┘  │
     └─────────────────────────┘
```

## 2. 核心组件

| 组件 | 说明 |
|------|------|
| Broker | 存储消息，处理请求 |
| ZooKeeper/KRaft | 集群协调，元数据管理 |
| Producer | 发送消息到 Topic |
| Consumer | 从 Topic 消费消息 |
| Connect | 连接外部系统 |
| Streams | 流处理 API |

## 3. 数据流向详解

### 3.1 生产者写入流程

```
Producer
    │
    ▼
Interceptor（拦截器，可链式处理）
    │
    ▼
Serializer（序列化 Key/Value）
    │
    ▼
Partitioner（分区器，决定发往哪个分区）
    │
    ▼
RecordAccumulator（按分区聚合到队列）
    │
    ▼
Sender 线程（批量发送）
    │
    ▼
Broker（写入 Leader 副本）
    │
    ▼
Follower 同步（ISR 机制）
    │
    ▼
ACK 返回给 Producer
```

### 3.2 消费者读取流程

```
Consumer.poll()
    │
    ▼
Fetch 请求发往分区 Leader
    │
    ▼
Broker 从日志文件读取数据
    │
    ▼
通过 sendfile() 零拷贝返回
    │
    ▼
Consumer 反序列化消息
    │
    ▼
业务处理
    │
    ▼
提交 Offset
```

## 4. 元数据管理

| 组件 | 元数据 | 存储位置 |
|------|--------|----------|
| ZooKeeper 模式 | Topic/分区/副本分配、Controller 选举、Broker 注册 | ZooKeeper |
| KRaft 模式 | 同上，但使用内部 Raft 日志 | __cluster_metadata Topic |

## 5. 多集群架构

在大型企业中，通常会部署多个 Kafka 集群：

```
┌─────────────────┐         ┌─────────────────┐
│  集群 A (北京)    │◄───────►│  集群 B (上海)    │
│  MirrorMaker2   │         │  MirrorMaker2   │
└─────────────────┘         └─────────────────┘
         ▲                           ▲
         │                           │
         ▼                           ▼
    ┌─────────┐               ┌─────────┐
    │ 集群 C  │               │ 集群 D  │
    │ (灾备)  │               │ (分析)  │
    └─────────┘               └─────────┘
```

## 6. 最佳实践

1. **避免单点 Controller**：在 ZooKeeper 模式下，Controller 是单点。确保监控 Controller 状态，KRaft 模式天然支持多 Controller 冗余。
2. **合理规划 Broker 数量**：Broker 数量应至少等于副本因子，推荐 3 个以上。
3. **使用 Rack Awareness**：配置 `broker.rack` 让副本分布在不同机架，提高容灾能力。
4. **监控网络分区**：网络分区可能导致脑裂，配置合适的 `replica.lag.time.max.ms` 及时将慢副本移出 ISR。
