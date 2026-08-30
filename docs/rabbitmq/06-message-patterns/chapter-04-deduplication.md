# 消息去重

> 在网络抖动、生产者重试等场景下，同一条消息可能被发送多次。消息去重保证消息被幂等处理。

## 1. 消息重复的原因

| 原因 | 说明 |
| :-- | :-- |
| 生产者重试 | Confirm 超时后重发 |
| 消费者重试 | 处理失败后 nack 重新入队 |
| 网络抖动 | ACK 丢失导致消息重新投递 |
| Broker 故障 | 消息从其他节点恢复 |

## 2. 生产端去重

### 2.1 幂等生产者

```java
String messageId = UUID.randomUUID().toString();

AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
    .messageId(messageId)
    .build();

channel.basicPublish(exchange, routingKey, props, body);
```

### 2.2 去重表（Redis）

```java
String dedupKey = "msg:dedup:" + messageId;

if (redis.setnx(dedupKey, "1", 24, TimeUnit.HOURS)) {
    // 消息未发送过，正常发送
    channel.basicPublish(exchange, routingKey, props, body);
} else {
    // 消息已发送过，跳过
    log.info("消息去重: {}", messageId);
}
```

## 3. 消费端去重

### 3.1 幂等消费

```java
channel.basicConsume(queue, false, (tag, delivery) -> {
    String messageId = delivery.getProperties().getMessageId();

    // 检查是否已处理
    if (redis.exists("msg:processed:" + messageId)) {
        channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
        return;
    }

    // 处理消息
    processMessage(delivery);

    // 标记已处理
    redis.setex("msg:processed:" + messageId, 86400, "1");
    channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
}, tag -> {});
```

### 3.2 数据库唯一约束

```java
// 利用数据库唯一约束去重
try {
    messageDao.insert(messageId, content);
    processMessage(content);
} catch (DuplicateKeyException e) {
    log.info("消息已处理: {}", messageId);
}
```

### 3.3 业务幂等

```java
// 更新操作天然幂等
orderDao.updateStatus(orderId, "PAID");

// 扣减操作需要乐观锁
int affected = inventoryDao.decrease(productId, quantity, expectedVersion);
if (affected == 0) {
    log.info("库存已扣减，跳过重复消息");
}
```

## 4. 去重策略选择

| 策略 | 适用场景 | 说明 |
| :-- | :-- | :-- |
| Redis 去重表 | 通用 | 简单高效，需要 Redis |
| 数据库唯一约束 | 持久化场景 | 依赖数据库 |
| 业务幂等 | 特定操作 | 最优方案 |
| 消息 ID 去重 | 短期去重 | 重启后失效 |

## 5. 最佳实践

- 消费端必须设计为幂等
- 优先使用业务天然幂等（如状态更新）
- 使用全局唯一消息 ID（UUID / 雪花算法）
- 去重窗口根据业务设置（通常 24~72 小时）
- 去重存储选择 Redis 或数据库，不要用内存
