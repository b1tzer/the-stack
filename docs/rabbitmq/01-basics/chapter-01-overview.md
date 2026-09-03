# RabbitMQ 概览

> 选 RabbitMQ 不是因为它"最好"，而是因为在"业务消息 + 复杂路由 + 微秒级延迟"这个组合需求下，它是最成熟的选择。

## 1. RabbitMQ 是什么

RabbitMQ 是一个实现了 AMQP 0-9-1 协议的消息代理（Message Broker）。它的核心工作很简单：接收生产者发来的消息，根据路由规则投递给消费者。

但"简单"不等于"浅"。在一个分布式系统里，"可靠地把消息从 A 搬到 B"这件事，涉及到消息持久化、确认机制、死信处理、集群高可用、网络分区恢复等一系列工程问题。RabbitMQ 用十几年的生产验证，把这些都解决了。

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

| 维度 | RabbitMQ 的特点 | 对比 |
| :-- | :-- | :-- |
| 路由能力 | 4 种 Exchange，支持精确/模糊/广播路由 | Kafka 只支持 Topic 级路由 |
| 延迟 | 微秒级（Erlang 调度器优势） | Kafka 毫秒级 |
| 协议支持 | AMQP/MQTT/STOMP | Kafka 只有自定义协议 |
| 死信队列 | 原生支持，配置即用 | Kafka 不原生支持 |
| 延迟消息 | 插件原生支持 | Kafka 不原生支持 |
| 运维复杂度 | 低（单节点即可用） | Kafka 至少 3 节点 |
| 消息模型 | Queue + Exchange（灵活组合） | Topic + Partition（固定） |

## 4. RabbitMQ 不适合什么

| 场景 | 问题 | 替代方案 |
| :-- | :-- | :-- |
| 百万级 QPS | Erlang 单节点吞吐上限 | Kafka / Pulsar |
| 大量消息堆积 | 堆积后性能下降（内存换页） | Kafka（顺序写磁盘） |
| 消息回溯 | 不支持按 offset 重新消费 | Kafka |
| 流处理 | 无原生流处理引擎 | Kafka Streams / Flink |
| 日志收集 | 高吞吐场景不是强项 | Kafka |

**判断标准**：如果你的需求是"业务消息 + 可靠投递 + 灵活路由 + 低延迟"，RabbitMQ 是首选。如果是"大数据量 + 高吞吐 + 消息回溯"，选 Kafka。

## 5. 核心概念速览

```txt
Producer ──▶ Exchange ──binding──▶ Queue ──▶ Consumer
             (路由)               (存储)      (消费)
```

- **Producer**：消息发送者，不直接发到 Queue，而是发到 Exchange
- **Exchange**：路由器，根据 binding 规则把消息分发到一个或多个 Queue
- **Queue**：消息的最终存储，消费者从这里取消息
- **Binding**：Exchange 和 Queue 之间的关联规则（routing key）
- **Consumer**：消息消费者，支持推模式（Push）和拉模式（Pull）
- **Channel**：轻量级连接，复用 TCP 连接，避免频繁建连开销
- **Virtual Host（vhost）**：逻辑隔离单元，类似数据库的 schema

## 6. Exchange 类型与路由能力

| Exchange 类型 | 路由规则 | 典型场景 |
| :-- | :-- | :-- |
| Direct | routing key 精确匹配 | 点对点、任务分发 |
| Topic | routing key 通配符匹配（`*` 和 `#`） | 事件订阅、分类路由 |
| Fanout | 忽略 routing key，广播到所有绑定队列 | 广播通知、实时推送 |
| Headers | 根据消息 headers 匹配 | 复杂条件路由（少用） |

这是 RabbitMQ 最强的地方：通过 Exchange + Binding 的组合，可以实现几乎任意的消息路由拓扑。

## 7. 可靠性保障层次

RabbitMQ 的可靠性不是单一机制，而是多层叠加：

```txt
Producer                    Broker                     Consumer
  │                           │                           │
  ├─ Publisher Confirm ──▶    ├─ 持久化（Durable Queue）   ├─ Manual ACK
  ├─ Mandatory Return ──▶     ├─ 持久化（Persistent Msg）  ├─ Prefetch 控制
  │                           ├─ 镜像队列/Quorum Queue     ├─ 死信队列
  │                           └─ 事务（性能差，少用）       └─ 重试 + DLX
```

每一层解决不同的问题。生产环境通常需要至少 Publisher Confirm + Durable Queue + Manual ACK 的组合。

## 8. 典型使用场景

### 8.1 电商订单流程

```txt
下单 ──▶ order.exchange ──▶ order.created.queue ──▶ 库存服务（扣库存）
                        ──▶ order.created.queue ──▶ 通知服务（发短信）
                        ──▶ order.created.queue ──▶ 积分服务（加积分）
```

一条消息，多个消费者各自处理。Fanout 或 Topic Exchange 实现。

### 8.2 延迟任务

```txt
订单创建 ──▶ delay.exchange（延迟30分钟）──▶ order.timeout.queue ──▶ 检查支付状态
```

延迟消息插件（rabbitmq_delayed_message_exchange）实现。

### 8.3 RPC 调用

```txt
Client ──▶ request.queue ──▶ Server
       ◀── reply.queue ◀──
```

RabbitMQ 原生支持 RPC 模式，适用于需要异步调用但又要返回结果的场景。

## 9. 版本选择建议

| 版本 | 特点 | 建议 |
| :-- | :-- | :-- |
| 3.13.x | 最新稳定版，Quorum Queue 成熟 | 新项目首选 |
| 3.12.x | 稳定，社区活跃 | 生产环境可用 |
| 3.11 及以下 | 镜像队列为主（已废弃） | 不推荐新项目 |

**关键变化**：3.x 版本中，镜像队列（Mirrored Queue）已被 Quorum Queue 取代。新项目应直接使用 Quorum Queue，不要用镜像队列。
