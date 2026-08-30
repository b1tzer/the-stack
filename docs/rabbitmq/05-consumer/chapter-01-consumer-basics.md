# 消费者基础

> 消费者从队列中获取消息并处理。理解两种消费模式（推模式 vs 拉模式）和 ACK 机制，是正确使用 RabbitMQ 的基础。

## 1. 两种消费模式

### 1.1 推模式（Push）

Broker 主动将消息推送给消费者：

```java
DeliverCallback deliverCallback = (tag, delivery) -> {
    String message = new String(delivery.getBody(), "UTF-8");
    // 处理消息
    channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
};

channel.basicConsume("order.queue", false, deliverCallback, tag -> {});
```

### 1.2 拉模式（Pull）

消费者主动从队列拉取消息：

```java
GetResponse response = channel.basicGet("order.queue", false);
if (response != null) {
    byte[] body = response.getBody();
    long deliveryTag = response.getEnvelope().getDeliveryTag();
    // 处理消息
    channel.basicAck(deliveryTag, false);
}
```

## 2. 推模式 vs 拉模式

| 特性 | 推模式 | 拉模式 |
| :-- | :-- | :-- |
| 实时性 | 高（消息到达即推送） | 低（需要轮询） |
| 背压控制 | prefetch 控制 | 拉取频率控制 |
| 实现复杂度 | 简单 | 需要轮询逻辑 |
| 适用场景 | 大多数场景 | 特殊场景（批量处理） |

## 3. 消费者标识

```java
channel.basicConsume(
    "order.queue",       // 队列名
    false,               // auto-ack
    "order-consumer-1",  // 消费者标签（唯一标识）
    deliverCallback,
    cancelCallback
);
```

## 4. 消费者生命周期

```text
注册消费 ──▶ 接收消息 ──▶ 处理消息 ──▶ ACK ──▶ 接收下一条
    │                          │
    │                          ├─ 处理失败 → NACK/Reject
    │                          │
    └─ 取消消费 ◀── cancel ────┘
```

## 5. 取消消费

```java
// 主动取消
channel.basicCancel(consumerTag);

// 被动取消（队列删除、连接断开等）
channel.basicConsume(queue, false, "my-tag",
    deliverCallback,
    consumerTag -> log.info("消费者被取消: {}", consumerTag)
);
```
