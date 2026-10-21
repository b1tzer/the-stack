# RabbitMQ 概览

> 选 RabbitMQ 不是因为它"最好"，而是因为在"业务消息 + 复杂路由 + 低延迟"这个组合需求下，它是最成熟的选择。
>
> 本文档的版本结论以 **RabbitMQ 4.3 系列**（截至 2026-09，最新补丁 4.3.6）为基准。更早期的版本建议见下方第 9 节。

## 1. RabbitMQ 是什么

RabbitMQ 是一个实现了 AMQP 0-9-1 协议的消息代理（Message Broker）。它的核心工作很简单：接收生产者发来的消息，根据路由规则投递给消费者。

但"简单"不等于"浅"。在一个分布式系统里，"可靠地把消息从 A 搬到 B"这件事，涉及消息持久化、确认机制、死信处理、集群高可用、网络分区恢复等一系列工程问题。RabbitMQ 经过长期生产检验，提供了应对这些问题的成熟机制——但最终的可靠性保证取决于你的配置、故障类型，以及应用层的处理方式（详见[可靠性保障层次](#7-可靠性保障层次)）。

## 2. 为什么需要消息队列

直接调用（HTTP/RPC）和消息队列，本质上解决的是不同的问题：

**直接调用**：

```txt
服务A ──HTTP──▶ 服务B
           等待响应
           ◀──────
```

- 强耦合：B 挂了 A 也挂
- 同步阻塞：A 必须等 B 处理完
- 无缓冲：突发流量直接打垮 B

**消息队列**：

```txt
服务A ──▶ [Queue] ──▶ 服务B
         消息暂存      异步处理
```

- 解耦：A 只管发，不关心谁消费
- 异步：A 发完就走，不等 B
- 削峰：Queue 充当缓冲区，B 按自己的速率消费

但这不是说消息队列比直接调用"更好"。它引入了新的复杂性：消息丢失的风险、消费顺序问题、幂等性要求、运维成本。**如果同步调用能满足需求，不要引入消息队列。**

## 3. RabbitMQ 的核心优势

RabbitMQ 与 Kafka 的设计重点不同。RabbitMQ 围绕 Exchange、Binding 和 Queue 构建消息路由，适合需要灵活分发业务事件的场景；Kafka 以 Topic、Partition 和消费组为核心，更适合高吞吐、可回放的事件流场景。两者存在能力交集，但不能仅凭单一指标判断优劣。

| 维度 | RabbitMQ | Kafka |
| :-- | :-- | :-- |
| 路由模型 | 通过 Direct/Topic/Fanout/Headers Exchange 与 Binding 组合路由规则，可将消息分发到一个或多个队列 | 以 Topic 和 Partition 组织消息，主要通过生产者选分区、消费组订阅与分区分配组织消息流，不提供 AMQP 式 Exchange 路由模型 |
| 延迟特征 | 面向消息分发与消费，延迟受队列类型、消息持久化、确认策略、负载与网络等因素影响 | 延迟受批处理、生产者配置、副本确认策略、消费方式与负载等因素影响 |
| 协议支持 | 原生支持 AMQP 0-9-1；4.0 起 AMQP 1.0 成为核心协议；通过插件支持 MQTT、STOMP，并内置 Stream 协议 | 使用自有二进制协议，拥有多种语言客户端及连接器生态 |
| 死信处理 | 通过 Dead Letter Exchange（DLX）及队列参数构建死信流程 | 没有与 DLX 完全对应的 Broker 级死信路由，通常通过应用或消费框架设计重试与死信主题 |
| 延迟消息 | 通过 TTL + DLX 实现延迟投递，4.4 起 Quorum Queue 原生支持投递延迟 | 通常通过延迟主题、时间戳调度或外部调度机制实现 |
| 堆积与回放 | 队列类型不同，堆积、存储与消费语义也不同；Stream Queue 支持按 offset 回放 | 以持久化分区日志为核心，可在保留策略范围内按 offset 重新消费 |
| 扩展与高可用 | 通过多节点集群与合适的队列类型实现；能力取决于队列类型与分布方式 | 通过分区分布与副本机制扩展；效果取决于分区数、复制配置与负载 |
| 运维与选型成本 | 需理解 Exchange、Binding、队列类型、确认与死信等机制 | 需理解 Topic、Partition、消费组、保留策略、副本与再均衡等机制 |

这张表用于确定评估方向，不代表两种产品在所有场景下的绝对优劣。延迟、吞吐、堆积后性能与运维成本尤其不能脱离负载与部署条件直接比较。需要作出容量或性能决策时，应使用贴近生产环境的消息大小、并发度、持久化与确认策略、复制配置及消费模式进行基准测试。

## 4. RabbitMQ 不适合什么

| 场景 | 问题 | 替代方案 |
| :-- | :-- | :-- |
| 百万级 QPS 持续吞吐 | 单队列/单节点吞吐有上限，需靠横向扩展弥补；经典队列堆积后存在内存换页开销 | Kafka / Pulsar（吞吐需通过基准测试按实际负载评估，不应视为固定边界） |
| 大量消息堆积 | 经典队列在长时间堆积、内存压力下会换页到磁盘，吞吐受影响 | Kafka（顺序写磁盘，长时间堆积场景吞吐通常更稳定） |
| 消息回溯 | 不支持按 offset 重新消费 | Kafka（Stream Queue 3.9+ 提供 offset 回放，详见[队列类型](../03-queue/chapter-04-stream-queue.md)） |
| 流处理 | 无原生流处理引擎 | Kafka Streams / Flink |
| 日志收集 | 高吞吐场景不是强项 | Kafka |

**判断标准**：如果你的需求是"业务消息 + 可靠投递 + 灵活路由 + 低延迟"，RabbitMQ 是首选。如果是"大数据量 + 高吞吐 + 消息回溯"，选 Kafka。吞吐"上限"取决于队列类型、节点数、消息大小与确认策略，应以基准测试结论为准。

## 5. 核心概念速览

```txt
Producer ──▶ Exchange ──binding──▶ Queue ──▶ Consumer
             (路由)               (存储)      (消费)
```

- **Producer**：消息发送者，不直接发到 Queue，而是发到 Exchange
- **Exchange**：路由器，根据 binding 规则把消息分发到一个或多个 Queue
- **Queue**：消息的最终存储，消费者从这里取消息
- **Binding**：Exchange 与 Queue 之间的绑定关系及其匹配条件。常见依据是 routing key（Direct/Topic/Fanout），Headers Exchange 则依据绑定时声明的消息头匹配条件。
- **Consumer**：消息消费者，支持推模式（Push）和拉模式（Pull）
- **Channel**：建立在 AMQP Connection（复用一个 TCP 连接）之上的逻辑通信通道，而非另一条连接。单个 Connection 上可开辟多个 Channel，避免为每个生产者/消费者都建立独立 TCP 连接的开销。
- **Virtual Host（vhost）**：逻辑隔离单元，类似数据库的 schema

## 6. Exchange 类型与路由能力

| Exchange 类型 | 路由规则 | 典型场景 |
| :-- | :-- | :-- |
| Direct | routing key 精确匹配 | 点对点、任务分发 |
| Topic | routing key 通配符匹配（`*` 和 `#`） | 事件订阅、分类路由 |
| Fanout | 忽略 routing key，广播到所有绑定队列 | 广播通知、实时推送 |
| Headers | 根据消息 headers 匹配 | 复杂条件路由（少用） |

通过 Exchange + Binding 的组合，可以覆盖从点对点到发布/订阅的大多数路由需求；更细的绑定与路由规则见[Exchange 基础](../02-exchange/chapter-01-exchange-basics.md)。

## 7. 可靠性保障层次

RabbitMQ 的可靠性不是单一机制，而是多层叠加：

```txt
Producer                    Broker                     Consumer
  │                           │                           │
  ├─ Publisher Confirm ──▶    ├─ 持久化（Durable Queue）   ├─ Manual ACK
  │  (发布端可靠性: Broker    ├─ 持久化（Persistent Msg）  ├─ (消费端可靠性: 处理成功
  │   已确认接收并处理)        ├─ Quorum 队列复制           │   后才确认，失败可重投)
  ├─ Mandatory Return ──▶     └─ 事务（性能差，少用）       └─ 重试 + DLX
  │  (路由失败可感知，与Confirm不同)
```

每一层解决不同的问题，三者分属不同故障窗口：

- **生产端**：Publisher Confirm 确认 Broker 已接收并处理该发布（持久消息进入持久队列时，确认意味着相应持久化已完成；Quorum 队列则需多数副本接受）。它并非对任意故障下"消息绝不丢失"的无条件承诺；Mandatory + Return 负责感知"消息无法路由到任何队列"——它和 Confirm 是两套独立判断，Confirm 成功不等于消息一定进了目标队列。
- **Broker 端**：Durable Queue 保证队列元数据与（持久化）消息在重启后存活；持久化消息属性决定单条消息是否落盘；Quorum 队列通过 Raft 复制提供节点故障容错。持久化配置本身不构成"消息已安全落盘"的保证，仍需 Confirm 配合。
- **消费端**：Manual ACK 在业务处理成功后才确认，处理失败或崩溃时消息可重新投递。Manual ACK 是消费端的投递确认，并不等同于业务事务的提交边界——若先 ACK 再提交业务、或提交业务后 ACK 前崩溃，都可能导致重复或丢失，因此仍需配合幂等处理。

生产环境通常以 **Durable Queue + Persistent Message + Publisher Confirm + Manual ACK** 作为可靠性基线。但这只是基础配置，不等于端到端恰好一次：生产者仍需处理不可路由消息，消费者仍需处理重复投递并做幂等。底层机制与协议细节见[发布确认](../04-producer/chapter-02-publisher-confirm.md)、[ACK 机制](../05-consumer/chapter-02-ack-mechanism.md)与[仲裁队列](../03-queue/chapter-03-quorum-queue.md)。

## 8. 典型使用场景

### 8.1 电商订单流程

```txt
                     ┌──▶ inventory.queue    ──▶ 库存服务（扣库存）
下单 ──▶ order.exchange ├──▶ notification.queue ──▶ 通知服务（发短信）
                     └──▶ points.queue       ──▶ 积分服务（加积分）

（Fanout 或 Topic Exchange，三个队列各自绑定到 Exchange）
```

一条订单事件进入三个独立队列，每个服务消费自己队列里的消息。需要强调的是：RabbitMQ 中多个消费者订阅**同一个队列**时是竞争消费（一条消息只投递给其中一个消费者），并不会自动广播给所有消费者。要让库存、通知、积分三个服务都处理同一事件，必须分别绑定三个队列到 Exchange，由 Exchange 的路由规则决定哪些队列收到消息。Exchange 与绑定规则详见[Exchange 基础](../02-exchange/chapter-01-exchange-basics.md)。

### 8.2 延迟任务

```txt
订单创建 ──▶ delay.order.timeout.queue（TTL 30 分钟）──▶ order.timeout.queue ──▶ 检查支付状态
```

消息先进入带 TTL 的延迟队列，到期后经 DLX 路由到处理队列。RabbitMQ 4.3 下延迟消息插件（rabbitmq_delayed_message_exchange）已停止维护且依赖的 Mnesia 已移除，实现细节见[消息 TTL](../05-consumer/chapter-04-message-ttl.md)。

### 8.3 RPC 调用

```txt
Client ──▶ request.queue ──▶ Server
       ◀── reply.queue ◀──
```

RabbitMQ 可用于构建 RPC 消息模式（借助 reply-to 与关联 ID），适用于需要异步调用但又要返回结果的场景。这不等同于 Broker 提供了完整的原生 RPC 调用语义——请求/响应配对、超时与错误处理仍需应用层实现。

## 9. 版本选择建议

本文以 **RabbitMQ 4.3 系列**（截至 2026-09，最新补丁 4.3.6）为当前基准。版本选择应先看业务对复制、高可用、延迟与消息回溯的要求，再决定队列类型与版本，而非简单按"最新"排序。

| 版本系列 | 关键特征 | 建议 |
| :-- | :-- | :-- |
| 4.3.x | 当前主线；Khepri 成为唯一元数据存储，Mnesia 已移除，统一 Raft 故障模型 | 新项目首选 |
| 4.2.x | Khepri 成为新集群默认元数据存储；社区支持已结束（2026-07），仅商业支持 | 生产可用，规划升级到 4.3 |
| 4.1.x / 4.0.x | 4.0 起移除经典镜像队列；4.1 起 Khepri 可选 | 仅商业支持，建议升级 |
| 3.13.x 及更早 | 经典镜像队列仍可用（3.13 实验性 Khepri） | 不推荐新项目，逐步迁移 |

**关键变化（跨大版本升级务必注意）**：RabbitMQ 4.0 起**彻底移除了经典镜像队列（Classic Mirrored Queue）**，复制型队列只保留 Quorum Queue 与 Stream Queue。从 3.x 升级到 4.x 是破坏性变更，需经 3.13 → 4.2 → 4.3 逐级升级并开启相应 feature flag（升级前用 `rabbitmqctl list_feature_flags` 确认必需 flag 已启用）；旧版基于镜像队列的运维经验不能直接套用到 4.x。**例外**：若 3.13 集群已开启 Khepri 元数据存储，则无法按常规方式原地升级到 4.x，需规划蓝绿迁移等替代方案。新项目应直接使用 Quorum Queue，不要使用镜像队列。详细的队列类型与迁移见[仲裁队列](../03-queue/chapter-03-quorum-queue.md)与[集群基础](../07-clustering/chapter-01-cluster-basics.md)。
