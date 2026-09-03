# 整体架构

> Kafka 集群由「数据面」和「控制面」两层构成：数据面负责消息的生产、存储与消费，控制面负责集群协调与元数据管理。本章用一条消息的旅程串起这两层，建立整体认知模型。

## 1. 架构全景：两层结构

![Kafka 整体架构](/kafka/01-basics-chapter-03-architecture.svg)

上图可以拆成两层，分清两者的分工是理解 Kafka 架构的钥匙：

| 层次 | 组成 | 职责 |
| :-- | :-- | :-- |
| 数据面 | Producer、Broker、Consumer | 消息的实际生产、存储、消费 |
| 控制面 | Controller / 元数据层（KRaft / ZooKeeper） | 分区 Leader 选举、元数据管理、副本协调 |

一个关键事实：**控制面不处理任何业务消息**。它做的事是让数据面「知道该往哪发、从哪读」。消息本身只流经数据面，但数据面每走一步都要向控制面「问路」。

## 2. 数据面：一条消息的旅程

### 2.1 写入：Producer → 分区 Leader

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

**读写都只走 Leader**：Follower 不接收客户端读写，它只从 Leader 拉数据，作为高可用的备份。这样设计的原因在于——一个分区若允许多个副本同时接写，写入顺序就会分叉；Follower 若接读，又可能返回尚未同步的旧数据。让 Leader 独占读写，是最简单的一致性方案。

发送前的内部处理（拦截器、序列化、分区选择、批量聚合）见 [生产者 API](../02-producer/chapter-01-producer-basics.md)；`acks` 等可靠性参数见 [确认与重试](../02-producer/chapter-03-acks-retries.md)。

### 2.2 读取：Consumer ← 分区 Leader

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

消费者同样只从 Leader 读。消费者组如何分配分区、Offset 如何管理，见 [消费者组](../03-consumer/chapter-02-consumer-group.md) 与 [Offset 管理](../03-consumer/chapter-03-offset-management.md)。

## 3. 控制面：谁在支撑数据面

### 3.1 元数据：路由的依据

Producer 和 Consumer 凭什么知道「目标分区的 Leader 在哪台 Broker」？靠的是一份由 Controller 统一维护、持续广播到全集群的元数据：哪个分区在哪个 Broker、谁是 Leader、谁是 Follower。

这就是控制面存在的根本原因：分布式系统里，客户端不可能自己记住所有分区的 Leader 位置，必须有一个权威源统一管理并对外提供。元数据管理的实现经历了从 ZooKeeper 到 KRaft 的演进，职责与机制详见 [Controller](../05-storage-internals/chapter-04-controller.md) 与 [KRaft](../05-storage-internals/chapter-05-kraft.md)。

### 3.2 副本同步：高可用的来源

Follower 持续从 Leader 拉数据，靠 ISR 机制保证「挂掉一个副本，消息仍可读可写」。LEO、HW、ISR 动态调整等细节见 [副本机制](../05-storage-internals/chapter-03-replication.md)。

## 4. 一句话总结

- 数据面管「消息的收发与存储」，控制面管「集群的协调与元数据」。
- Producer 和 Consumer 都只与分区 Leader 打交道，Follower 是为高可用而存在的备份。
- 控制面不碰业务消息，但它的元数据决定了消息流向哪里。

