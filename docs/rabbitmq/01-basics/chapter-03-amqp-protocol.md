# AMQP 协议

> AMQP 0-9-1 是 RabbitMQ 默认支持的消息协议。理解它的帧结构和命令，是理解 RabbitMQ 底层交互的基础。

## 1. AMQP 是什么

AMQP（Advanced Message Queuing Protocol）是一个开放标准的消息协议。它定义了：

- 消息的格式（帧结构）
- 客户端和 Broker 之间的交互方式（命令）
- 路由和队列的语义

RabbitMQ 实现的是 AMQP 0-9-1 版本。不要和 AMQP 1.0 混淆——两者是协议模型和线格式均不同的两个版本，不能直接互通。AMQP 1.0 的支持方式随版本变化：RabbitMQ 3.13 及更早版本通过插件支持且默认不启用，RabbitMQ 4.0 起已集成进核心 Broker 并默认可用，原插件仅作为升级流程的兼容空壳保留。

## 2. AMQP 帧结构

建立 AMQP 0-9-1 连接后，双方的协议数据以"帧"（Frame）为单位传输（连接建立之初客户端会先发送协议头，它不是普通帧）。每个帧由固定长度的帧头、Payload 和帧尾组成：

```txt
┌───────────┬──────────┬───────────────┬──────────┬───────────┐
│ Frame Type│ Channel  │ Payload Size  │ Payload  │ Frame End │
│ (1 byte)  │ (2 bytes)│ (4 bytes)     │ (N bytes)│ (0xCE)    │
└───────────┴──────────┴───────────────┴──────────┴───────────┘
```

帧头固定 7 字节：帧类型（1 字节）、Channel 编号（2 字节）、Payload 长度（4 字节），随后是 Payload，最后以 `0xCE` 作为帧结束标记。

| 帧类型 | 编号 | 用途 |
| :-- | :-- | :-- |
| Method | 1 | 命令帧（如 basic.publish, queue.declare） |
| Header | 2 | 消息头（属性：delivery-mode, content-type 等） |
| Body | 3 | 消息体（实际数据） |
| Heartbeat | 8 | 心跳帧，独立控制帧，不承载业务消息 |

一条消息的发送过程：

```txt
Client → Broker: Method Frame (basic.publish)
Client → Broker: Header Frame (消息属性)
Client → Broker: Body Frame (消息内容，大消息可拆分为多个 Body Frame)
```

## 3. AMQP 核心命令

### 3.1 连接与 Channel

| 命令 | 方向 | 说明 |
| :-- | :-- | :-- |
| connection.start | S→C | Broker 发送支持的 SASL 机制 |
| connection.start-ok | C→S | 客户端发送认证信息 |
| connection.tune | S→C | 协商参数（channel-max, frame-max, heartbeat） |
| connection.open | C→S | 打开连接，指定 vhost |
| channel.open | C→S | 打开 Channel |
| channel.close | 双向 | 关闭 Channel |

### 3.2 Exchange 操作

| 命令 | 说明 |
| :-- | :-- |
| exchange.declare | 声明 Exchange（名称、类型、持久化等） |
| exchange.delete | 删除 Exchange |
| exchange.bind | Exchange 之间的绑定（较少用） |

### 3.3 Queue 操作

| 命令 | 说明 |
| :-- | :-- |
| queue.declare | 声明 Queue（名称、持久化、排他等） |
| queue.bind | 将 Queue 绑定到 Exchange |
| queue.unbind | 解除绑定 |
| queue.delete | 删除 Queue |
| queue.purge | 清空 Queue 中的消息 |

### 3.4 消息操作

| 命令 | 方向 | 说明 |
| :-- | :-- | :-- |
| basic.publish | C→S | 发送消息到 Exchange |
| basic.consume | C→S | 订阅 Queue（Push 模式） |
| basic.get | C→S | 主动拉取一条消息（Pull 模式） |
| basic.deliver | S→C | Broker 推送消息给 Consumer |
| basic.ack | C→S | 消费者确认消息已处理 |
| basic.nack | C→S | 消费者拒绝消息（可选 requeue） |
| basic.reject | C→S | 消费者拒绝单条消息 |
| basic.qos | C→S | 设置 Prefetch（流控） |
| confirm.select | C→S | 开启发布确认（Publisher Confirm）模式 |
| basic.return | S→C | 不可路由消息返回通知（发布时设置 mandatory） |

注意 `basic.ack` 和 `basic.nack` 都存在两个方向、两种语义，不能混为一谈：

- 消费者向 Broker 发送的 `basic.ack` / `basic.nack`，是应用对某条投递结果的表态。`basic.ack` 表示确认投递；`basic.nack` 表示否定确认，Broker 根据 `requeue` 参数决定是否重新入队，未重新入队的消息可能被丢弃或死信转发。
- 发布确认模式下，Broker 向生产者发送的 `basic.ack` / `basic.nack`，表示 Broker 是否接受并承担该消息的责任。这里的 `basic.ack` 不代表消息一定路由到了队列，更不等于消息一定持久化；确认时机与队列类型、消息属性、目标队列有关。例如持久化消息进入 durable queue 时，确认通常要等到消息写盘；进入 quorum queue 时涉及多数副本接受消息。

发布确认由 `confirm.select` 启用，解决的是生产者侧"消息是否被 Broker 接受"的问题；消费者 `basic.ack` 解决的是消费侧"消息是否已被成功处理"的问题。两者方向相反、对象不同，仅方法名相同。

当发布时设置 `mandatory` 且消息无法路由到任何队列，Broker 会先发送 `basic.return` 退回消息，再发送发布确认。`basic.return` 处理的是路由结果通知，发布确认处理的是 Broker 接收责任，二者解决不同问题。

另外，两者的主要区别在于批量能力：`basic.nack` 支持通过 `multiple` 参数一次否定多条投递，`basic.reject` 只能处理单条投递。

## 4. AMQP 的"声明"语义

AMQP 中的 `declare` 操作对**已存在的具名实体**通常可以安全地重复执行：

```java
// 第一次声明：创建 Queue
channel.queueDeclare("order.queue", true, false, false, null);

// 第二次声明：声明参数与现有队列兼容，Broker 接受此次声明
channel.queueDeclare("order.queue", true, false, false, null); // OK

// 参数不兼容：报错 406 PRECONDITION_FAILED
channel.queueDeclare("order.queue", false, false, false, null); // 错误！
```

但要分清"幂等"的边界。重复声明不是无条件安全的：

- 对已存在的具名 Queue 或 Exchange，使用兼容参数重复声明，可以安全地确认其存在且属性正确。
- 参数不兼容时，Broker 返回协议错误（406 PRECONDITION_FAILED 是声明属性不一致的典型结果，但并非所有声明失败的统一错误码）。
- 服务端自动生成名称的队列（如 `queueDeclare()` 不带队列名），每次声明都会创建新队列，不存在"确认同一个既有队列"这回事。
- 排他队列（exclusive）与创建它的连接绑定，其他连接即使声明同名队列、参数看似相同，也可能因资源已被占用而失败。普通具名队列的重复声明规则不能直接套用到跨连接场景。

这个设计的意图是：**让客户端可以安全地重复声明，确保 Queue 存在且属性正确**。在微服务架构中，多个实例启动时都会声明自己需要的 Queue，兼容参数的重复声明可以避免因重复创建同一拓扑而冲突，但不保证声明过程在所有条件下都成功。

## 5. AMQP vs 其他协议

| 协议 | RabbitMQ 支持 | 特点 | 场景 |
| :-- | :-- | :-- | :-- |
| AMQP 0-9-1 | 默认 | 功能最全，RabbitMQ 原生 | 通用消息 |
| AMQP 1.0 | 4.0 起核心内置（3.13 及以前为插件） | 标准化，但语义与 0-9-1 不同 | 企业集成 |
| MQTT | 插件 | 轻量，适合 IoT | IoT 设备 |
| STOMP | 插件 | 文本协议，简单 | WebSocket 集成 |

## 6. 协议层面的性能考量

协议、连接模型和存储机制都会影响性能，但性能高低取决于具体负载，不能脱离测试条件做排名。下面拆开几个经常被混为一谈的因素。

**连接与协议开销**：

- AMQP 0-9-1 使用二进制帧，并支持在一条 TCP 连接上复用多个 Channel，建连开销可以分摊到大量消息上。
- HTTP 的连接复用能力取决于协议版本和客户端实现：HTTP/1.1 支持持久连接，HTTP/2 支持单连接多路复用。不能简单断言"HTTP 每次请求都建连"。

**消息路径与延迟**：

- RabbitMQ 的 Queue 读写在内存优先时很快，但实际成本取决于队列类型、消息大小、持久化配置和负载状态，不能把队列操作概括为固定的 O(1)。
- Kafka 以追加方式写入日志，写入路径通常先经过操作系统 Page Cache，数据何时刷入物理介质取决于系统和配置；读取也受 Page Cache 命中率、磁盘 I/O 和消费模式影响。两者延迟高低取决于消息路径、持久化与确认语义、批处理、复制和消费者行为，不能凭存储方式直接判定。

**运行时因素**：

- Erlang/OTP 的轻量级进程与调度机制是 RabbitMQ 的设计特点，但调度机制与 JVM 的 GC 不是可以直接对比的单一性能指标，不能据此得出"Erlang 调度器比 JVM GC 更适合低延迟"的结论。实际延迟还取决于队列实现、持久化、复制、确认策略、负载和部署条件。
