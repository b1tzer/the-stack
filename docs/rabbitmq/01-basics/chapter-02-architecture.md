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
| frame_max | 131072 | AMQP 帧最大大小 |
| connection_timeout | 无限 | 连接超时（ms） |

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
- 资源隔离：一个 vhost 的问题不影响其他 vhost

**注意**：vhost 之间完全隔离，Exchange 和 Queue 不能跨 vhost 绑定。

## 4. 消息流转全链路

一条消息从生产到消费的完整路径：

```txt
1. Producer 创建连接 → 创建 Channel
2. Channel.basicPublish(exchange, routingKey, properties, body)
3. Broker 收到消息：
   a. 根据 exchange 名找到 Exchange 进程
   b. Exchange 根据 routing key + binding 规则查找目标 Queue
   c. 消息写入 Queue（持久化到磁盘，如果 Durable）
   d. 返回 Publisher Confirm（如果开启了 confirm 模式）
4. Consumer.basicConsume(queue, autoAck, callback)
5. Broker 将消息投递给 Consumer（Push 模式）
6. Consumer 处理完成后 basicAck / basicNack
7. Broker 收到 ACK 后从 Queue 中删除消息
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
| deliveryMode | 1=非持久化，2=持久化 | 生产环境必须为 2 |
| contentType | 内容类型 | application/json |
| correlationId | 关联 ID | RPC 模式匹配请求和响应 |
| replyTo | 回复队列 | RPC 模式 |
| expiration | 消息 TTL | 延迟消息（单条级别） |
| priority | 消息优先级 | 优先级队列 |
| headers | 自定义头 | 死信路由、延迟消息插件 |

## 5. Erlang 进程模型

RabbitMQ 基于 Erlang/OTP 构建，这决定了它的几个核心特性：

**每个 Queue 是一个 Erlang 进程**：

```txt
Queue A → Erlang Process (独立调度)
Queue B → Erlang Process (独立调度)
Queue C → Erlang Process (独立调度)
```

- 每个 Queue 独立调度，互不阻塞
- Erlang 的轻量级进程（不是 OS 线程）可以轻松创建数万个
- 这就是为什么 RabbitMQ 能支持大量 Queue 而不掉性能

**Erlang 调度器**：

- 每个 CPU 核心一个调度器
- 调度器在进程间公平切换，避免某个 Queue 独占 CPU
- 这是 RabbitMQ 微秒级延迟的底层原因

**ETS（ETS Table）**：

- Erlang 的内存表，用于存储热数据（如 Queue 的消息索引）
- 读写都是 O(1)，无锁（进程内操作）

## 6. 存储引擎

### 6.1 消息存储路径

```txt
消息进入 Queue
  ├─ 小消息（< 4KB）→ 直接写入 Queue 的 ETS 表（内存）
  └─ 大消息（≥ 4KB）→ 写入消息存储文件（磁盘），Queue 中存引用
```

### 6.2 持久化机制

```txt
Queue 声明为 Durable + 消息标记为 Persistent
  → 消息写入磁盘（msg_store_persistent）
  → Queue 元数据写入 Mnesia
  → Broker 重启后自动恢复
```

**注意**："持久化"不等于"不丢消息"。消息写入磁盘是异步的（批量刷盘），如果在写入前 Broker 崩溃，消息会丢。要实现真正的不丢消息，需要 Publisher Confirm + Durable + Manual ACK 的组合。

### 6.3 内存管理

| 参数 | 说明 |
| :-- | :-- |
| `vm_memory_high_watermark` | 内存高水位（默认 0.6），超过后阻塞生产者 |
| `vm_memory_high_watermark_paging_ratio` | 开始换页的内存比例（默认 0.5） |
| `disk_free_limit` | 磁盘低水位（默认 50MB），低于后阻塞生产者 |

当内存使用率达到高水位时，RabbitMQ 会：
1. 阻塞所有生产者（flow control）
2. 将内存中的消息换页到磁盘
3. 内存降到安全水位后恢复生产者

这就是为什么消息堆积会导致性能下降：大量消息从内存换页到磁盘，消费时需要重新读磁盘。
