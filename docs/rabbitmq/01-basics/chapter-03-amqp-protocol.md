# AMQP 协议

> AMQP 0-9-1 是 RabbitMQ 的"母语"协议。理解它，你就理解了 RabbitMQ 的所有操作本质上是什么。

## 1. AMQP 是什么

AMQP（Advanced Message Queuing Protocol）是一个开放标准的消息协议。它定义了：

- 消息的格式（帧结构）
- 客户端和 Broker 之间的交互方式（命令）
- 路由和队列的语义

RabbitMQ 实现的是 AMQP 0-9-1 版本。不要和 AMQP 1.0 混淆——1.0 是完全不同的协议，RabbitMQ 通过插件支持但默认不用。

## 2. AMQP 帧结构

所有 AMQP 通信都以"帧"（Frame）为单位：

```text
┌──────────┬──────────────────────────────────┬──────────┐
│ 帧类型   │ 帧内容                           │ 帧结束   │
│ (1 byte) │ (payload)                        │ 0xCE     │
└──────────┴──────────────────────────────────┴──────────┘
```

| 帧类型 | 用途 |
|--------|------|
| 1 (Method) | 命令帧（如 basic.publish, queue.declare） |
| 2 (Header) | 消息头（属性：delivery-mode, content-type 等） |
| 3 (Body) | 消息体（实际数据） |
| 4 (Heartbeat) | 心跳帧（检测连接存活） |

一条消息的发送过程：

```text
Client → Broker: Method Frame (basic.publish)
Client → Broker: Header Frame (消息属性)
Client → Broker: Body Frame (消息内容)
```

## 3. AMQP 核心命令

### 3.1 连接与 Channel

| 命令 | 方向 | 说明 |
|------|------|------|
| connection.start | S→C | Broker 发送支持的 SASL 机制 |
| connection.start-ok | C→S | 客户端发送认证信息 |
| connection.tune | S→C | 协商参数（frame-max, heartbeat） |
| connection.open | C→S | 打开连接，指定 vhost |
| channel.open | C→S | 打开 Channel |
| channel.close | 双向 | 关闭 Channel |

### 3.2 Exchange 操作

| 命令 | 说明 |
|------|------|
| exchange.declare | 声明 Exchange（名称、类型、持久化等） |
| exchange.delete | 删除 Exchange |
| exchange.bind | Exchange 之间的绑定（较少用） |

### 3.3 Queue 操作

| 命令 | 说明 |
|------|------|
| queue.declare | 声明 Queue（名称、持久化、排他等） |
| queue.bind | 将 Queue 绑定到 Exchange |
| queue.unbind | 解除绑定 |
| queue.delete | 删除 Queue |
| queue.purge | 清空 Queue 中的消息 |

### 3.4 消息操作

| 命令 | 方向 | 说明 |
|------|------|------|
| basic.publish | C→S | 发送消息到 Exchange |
| basic.consume | C→S | 订阅 Queue（Push 模式） |
| basic.get | C→S | 主动拉取一条消息（Pull 模式） |
| basic.deliver | S→C | Broker 推送消息给 Consumer |
| basic.ack | C→S | 确认消息已处理 |
| basic.nack | C→S | 拒绝消息（可选 requeue） |
| basic.reject | C→S | 拒绝单条消息 |
| basic.qos | C→S | 设置 Prefetch（流控） |

## 4. AMQP 的"声明"语义

AMQP 中的 `declare` 操作是**幂等的**：

```java
// 第一次声明：创建 Queue
channel.queueDeclare("order.queue", true, false, false, null);

// 第二次声明：如果属性相同，返回成功；如果不同，报错
channel.queueDeclare("order.queue", true, false, false, null); // OK

// 属性不同：报错 406 PRECONDITION_FAILED
channel.queueDeclare("order.queue", false, false, false, null); // 错误！
```

这个设计的意图是：**让客户端可以安全地重复声明，确保 Queue 存在且属性正确**。在微服务架构中，多个实例启动时都会声明自己需要的 Queue，幂等性保证了不会出错。

## 5. AMQP vs 其他协议

| 协议 | RabbitMQ 支持 | 特点 | 场景 |
|------|--------------|------|------|
| AMQP 0-9-1 | 默认 | 功能最全，RabbitMQ 原生 | 通用消息 |
| AMQP 1.0 | 插件 | 标准化，但语义不同 | 企业集成 |
| MQTT | 插件 | 轻量，适合 IoT | IoT 设备 |
| STOMP | 插件 | 文本协议，简单 | WebSocket 集成 |

## 6. 协议层面的性能考量

**为什么 AMQP 比 HTTP 快**：

- HTTP 每次请求都要建连（或复用有限的 keep-alive）
- AMQP 一条连接复用多个 Channel，建连开销分摊到所有消息
- AMQP 的帧格式比 HTTP 的文本头更紧凑
- AMQP 支持批量发送（Publisher Confirm 批量确认）

**为什么 RabbitMQ 比 Kafka 延迟低**：

- RabbitMQ 的 Queue 是内存优先（小消息直接在内存），读写都是 O(1)
- Kafka 的消息在磁盘（顺序写），读需要 Page Cache 或磁盘 IO
- Erlang 的调度器比 JVM 的 GC 更适合低延迟场景
