# Classic Queue

> Classic Queue（经典队列）是 RabbitMQ 最早的队列类型，基于 Erlang Mnesia 数据库存储。它简单易用，适合大多数场景。

## 1. 存储结构

Classic Queue 使用两个核心组件：

```text
┌─────────────────────────────────────┐
│           Classic Queue             │
│                                     │
│  ┌─────────────┐  ┌──────────────┐  │
│  │   Q1 (内存)  │  │  Q2 (磁盘)   │  │
│  │  消息索引    │  │  消息体      │  │
│  └──────┬──────┘  └──────┬───────┘  │
│         └──────┬─────────┘          │
│                ▼                    │
│         消费者读取                   │
└─────────────────────────────────────┘
```

- Q1：内存中的消息索引（指向磁盘位置）
- Q2：磁盘中的消息体

## 2. 内存管理

### 2.1 内存阈值

```text
vm_memory_high_watermark = 0.4（默认 40% 物理内存）
```

当 RabbitMQ 内存使用达到阈值：

- 阻塞生产者（flow control）
- 消息写入磁盘
- 内存释放后恢复

### 2.2 惰性队列（Lazy Queue）

消息直接写入磁盘，减少内存使用：

```java
Map<String, Object> args = new HashMap<>();
args.put("x-queue-mode", "lazy");
channel.queueDeclare("log.queue", true, false, false, args);
```

适用场景：

- 消息堆积量大
- 消息不需要快速消费
- 内存资源有限

## 3. 持久化配置

要保证消息不丢失，需要三重保障：

| 层级 | 配置 |
| :-- | :-- |
| Exchange | durable = true |
| Queue | durable = true |
| Message | deliveryMode = 2（PERSISTENT） |

```java
// 声明持久化交换器
channel.exchangeDeclare("order.exchange", BuiltinExchangeType.DIRECT, true);

// 声明持久化队列
channel.queueDeclare("order.queue", true, false, false, null);

// 发送持久化消息
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
    .deliveryMode(2)  // PERSISTENT
    .build();
channel.basicPublish("order.exchange", "order.created", props, body);
```

## 4. 局限性

- 单线程写入，吞吐量有限
- 镜像队列同步开销大
- 消息堆积时性能下降
- 不支持流式消费
