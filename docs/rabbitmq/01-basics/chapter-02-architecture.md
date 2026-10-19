# 整体架构

> 理解 RabbitMQ 的架构，就是理解"一条消息从发出到被消费，中间经历了什么"。

## 1. 整体架构图

```txt
┌─────────────────────────────────────────────────────────────────┐
│                        RabbitMQ Broker                          │
│                                                                 │
│  ┌──────────┐    ┌──────────────────────────┐    ┌──────────┐  │
│  │          │    │       Virtual Host        │    │          │  │
│  │ Connection├───▶│  ┌─────────┐             │    │ Connection│  │
│  │          │    │  │Exchange │──binding──▶  │    │          │  │
│  └──────────┘    │  └─────────┘    Queue    │    └──────────┘  │
│       │          │       │                  │         │        │
│  ┌────┴─────┐    │  ┌────┴────┐  ┌──────┐  │    ┌───┴──────┐  │
│  │ Channel  │    │  │ Binding │  │ Store │  │    │ Channel  │  │
│  │ Channel  │    │  └─────────┘  └──────┘  │    │ Channel  │  │
│  └──────────┘    └──────────────────────────┘    └──────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Erlang Runtime                         │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │  │
│  │  │Mnesia    │  │ETS       │  │Per-Queue │  │IO Thread│  │  │
│  │  │(元数据)  │  │(热数据)  │  │Process   │  │Pool     │  │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         ▲                                          ▲
         │ AMQP                                     │ AMQP
    ┌────┴────┐                                ┌────┴────┐
    │Producer │                                │Consumer │
    └─────────┘                                └─────────┘
```

> 上图是简化示意，Erlang Runtime 区中的组件归属并不统一。Mnesia 是元数据存储后端，负责 vhost、Exchange、Queue、Binding 等元数据，并非 Classic Queue 独有（RabbitMQ 4.2 起新部署默认改用 Khepri，4.3 起移除 Mnesia）。ETS 与 Per-Queue Process 则主要对应 Classic Queue 的实现。Quorum Queue 与 Stream 采用不同的存储与复制机制，详见第 6 节。

## 2. 连接与 Channel

### 2.1 为什么需要 Channel

一条 TCP 连接的建立需要三次握手，开销不小。如果每个操作都建一条新连接，性能扛不住。RabbitMQ 的解决方案是：**一条 TCP 连接内复用多个 Channel**。

```txt
┌────────────────────────────────────────┐
│           TCP Connection               │
│  ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │Channel 1 │ │Channel 2 │ │Channel3│ │
│  │(发消息)  │ │(收消息)  │ │(管理)  │ │
│  └──────────┘ └──────────┘ └────────┘ │
└────────────────────────────────────────┘
```

Channel 是轻量级的，创建和销毁几乎无开销。一个典型的模式是：**每个线程一个 Channel，所有线程共享一条 Connection**。

### 2.2 线程安全

- **Connection**：线程安全，多线程可以共享
- **Channel**：**不是线程安全的**，一个 Channel 只能在一个线程中使用
- 最佳实践：每个线程创建自己的 Channel，或者用 Channel 池

```java
// 错误：多线程共享一个 Channel
Channel channel = connection.createChannel();
executor.submit(() -> channel.basicPublish(...)); // 线程1
executor.submit(() -> channel.basicPublish(...)); // 线程2 ← 竞态条件！

// 正确：每个线程自己的 Channel
executor.submit(() -> {
    Channel ch = connection.createChannel();
    ch.basicPublish(...);
    ch.close();
});
```

### 2.3 连接参数

| 参数 | 默认值 | 说明 |
| :-- | :-- | :-- |
| heartbeat | 60s | 心跳间隔，检测连接存活 |
| channel_max | 2047 | 每个连接最大 Channel 数 |
| frame_max | 131072 | AMQP 帧最大大小（Broker 默认；Java 客户端默认 0 表示不限） |
| connection_timeout | 60s | 连接超时（Java 客户端默认值） |

**heartbeat 调优**：生产环境建议 30-60s。太短会误判（网络抖动导致断连），太长检测死连接慢。

## 3. Virtual Host（vhost）

vhost 是 RabbitMQ 的逻辑隔离单元，类似于数据库中的 schema 或 Nginx 中的 server block。

```txt
vhost: /order
  ├── Exchange: order.exchange
  ├── Queue: order.created.queue
  └── User: order_service (仅对此 vhost 有权限)

vhost: /payment
  ├── Exchange: payment.exchange
  ├── Queue: payment.processed.queue
  └── User: payment_service (仅对此 vhost 有权限)
```

**用途**：

- 多租户隔离：不同业务/团队使用不同 vhost
- 权限控制：用户只能访问被授权的 vhost
- 逻辑隔离：同一 Broker 上的不同 vhost 仍共享 CPU、内存、磁盘等底层资源

**注意**：vhost 提供的是逻辑命名空间与权限隔离，不是物理资源隔离。某个 vhost 消息大量堆积，仍可能触发 Broker 级内存告警或生产者流控，影响其他 vhost。需要强隔离时应评估独立节点或集群部署。Exchange 和 Queue 也不能跨 vhost 绑定。

## 4. 消息流转全链路

一条消息从生产到消费的完整路径：

```txt
1. Producer 创建连接 → 创建 Channel
2. Channel.basicPublish(exchange, routingKey, properties, body)
3. Broker 收到消息：
   a. 根据 exchange 名找到 Exchange 并执行路由逻辑
   b. Exchange 根据 routing key + binding 规则查找目标 Queue
   c. 消息被路由到目标 Queue
   d. 持久化取决于队列类型：Classic Queue 需队列 Durable 且消息标记为 Persistent 才持久化；Quorum Queue 天然持久化
   e. 返回 Publisher Confirm（如果开启了 confirm 模式）
4. Consumer.basicConsume(queue, autoAck, callback)
5. Broker 将消息投递给 Consumer（Push 模式）
6. Consumer 处理完成后 basicAck / basicNack
7. Broker 收到 ACK 后，消息具备被删除的条件（实际物理删除时机由存储实现决定）
```

### 4.1 消息属性

```java
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
    .deliveryMode(2)           // 持久化
    .contentType("application/json")
    .correlationId(UUID.randomUUID().toString())  // 关联 ID（RPC 场景）
    .replyTo("callback.queue") // 回调队列（RPC 场景）
    .expiration("60000")       // 消息 TTL（毫秒）
    .priority(5)               // 优先级
    .headers(Map.of("x-trace-id", "abc123"))  // 自定义 headers
    .build();
```

| 属性 | 说明 | 常用场景 |
| :-- | :-- | :-- |
| deliveryMode | 1=非持久化，2=持久化 | 需要持久化时为 2，Quorum Queue 天然持久化 |
| contentType | 内容类型 | application/json |
| correlationId | 关联 ID | RPC 模式匹配请求和响应 |
| replyTo | 回复队列 | RPC 模式 |
| expiration | 消息 TTL（存活期限） | 配合队列 TTL 与 DLX 实现延迟投递 |
| priority | 消息优先级 | 需目标队列启用优先级特性才生效 |
| headers | 自定义头 | 死信路由、自定义消息头 |

## 5. Erlang 进程模型

RabbitMQ 基于 Erlang/OTP 构建，这决定了它的几个核心特性：

**Classic Queue 的每个队列是一个 Erlang 进程**：

```txt
Queue A → Erlang Process (独立调度)
Queue B → Erlang Process (独立调度)
Queue C → Erlang Process (独立调度)
```

- 每个 Classic Queue 有独立的 Erlang 进程，但进程之间仍共享 CPU、调度器与磁盘等资源，并非完全互不影响
- Erlang 的轻量级进程（不是 OS 线程）可以轻松创建数万个

> 这一模型描述的是 Classic Queue。Quorum Queue 和 Stream 同样基于 Erlang 进程，但采用 Raft 复制和分段日志等不同机制，不能简单套用上述模型。

**Erlang 调度器**：

- 每个 CPU 核心一个调度器
- 调度器在进程间切换，减少某个 Queue 长时间独占 CPU

**ETS（ETS Table）**：

- Erlang 的内存表，用于存储 RabbitMQ 内部的各类元数据
- 注意：消息体本身不直接存在 ETS 中，消息的存放位置取决于队列类型，见第 6 节

## 6. 存储引擎

### 6.1 消息存储路径

不同队列类型的存储机制差异很大。以下描述的是 Classic Queue（v1，普通队列）的行为，Quorum Queue 和 Stream 采用不同的存储方式。

```txt
消息进入 Classic Queue（v1）
  ├─ 小消息（< queue_index_embed_msgs_below，默认 4096 字节）
  │    → 消息体直接嵌入队列索引，不单独写消息存储文件
  └─ 大消息（≥ 4096 字节）
       → 消息体写入消息存储文件（msg_store），队列索引中只存引用
```

注意三点：其一，`queue_index_embed_msgs_below` 是可配置项，默认 4096，并非固定阈值；其二，本节描述的 Classic Queue v1 已在 RabbitMQ 4.0 移除，此处保留是为理解版本演进；其三，Classic Queue v2（RabbitMQ 3.10 引入，3.12 显著改进）改用每队列独立文件存储，不再使用共享的 msg_store。

### 6.2 持久化机制

```txt
Queue 声明为 Durable + 消息标记为 Persistent
  → 消息写入磁盘
  → Queue 元数据写入元数据存储（Mnesia，或 RabbitMQ 4.2 起的 Khepri）
  → Broker 重启后自动恢复
```

**注意**："持久化"不等于"不丢消息"。以 Classic Queue 为例，消息写入磁盘是异步批量刷盘的，写入前 Broker 崩溃仍可能丢消息；Quorum Queue 需要消息被多数副本确认后才返回确认，数据安全保证更强。

要降低丢失风险，需要生产端、Broker 存储端、消费端三段配合：

- 生产端：开启 Publisher Confirm，确认超时后重发可能产生重复消息
- Broker 端：Queue 声明 Durable + 消息标记 Persistent
- 消费端：关闭 autoAck，处理成功后再 basicAck

即便三者齐备，也不能承诺绝对不丢。以 Classic Queue 持久消息为例，Broker 在消息持久化到磁盘后才发送 Publisher Confirm，Quorum Queue 则在多数副本接受后才确认；真正的风险窗口在确认到达之前，此时连接故障会让生产者无法判断消息是否已被接收，重发就可能产生重复。此外，消费者处理成功但 ACK 丢失时消息会重新投递，业务侧仍需幂等处理。

### 6.3 内存管理

| 参数 | 说明 |
| :-- | :-- |
| `vm_memory_high_watermark` | 内存高水位（默认 0.6），超过后阻塞生产者 |
| `vm_memory_high_watermark_paging_ratio` | 开始换页的内存比例（默认 0.5），仅 Classic Queue v1 适用 |
| `disk_free_limit` | 磁盘低水位（默认 50MB），低于后阻塞生产者 |

这里有两个独立机制，不要混为一谈：

**内存告警与流控**：内存使用率达到 `vm_memory_high_watermark` 后，Broker 阻塞发布消息的连接（flow control），告警解除后恢复。这是 Broker 级的保护机制。

**队列换页**：Classic Queue v1 在内存达到 `vm_memory_high_watermark_paging_ratio` 时开始把内存中的消息换页到磁盘，无需等到高水位才触发。该参数不适用于 Classic Queue v2、Quorum Queue 和 Stream。

对 Classic Queue v1 而言，消息堆积会导致大量消息从内存换页到磁盘，消费时需要重新读磁盘，性能随之下降；Quorum Queue 和 Stream 则有各自的存储 I/O 与积压成本。
