# 消息去重

> 消息可能被重复投递（网络问题、Consumer 崩溃、Publisher 重发）。去重是保证"恰好一次"处理的关键。

## 1. 为什么会重复

| 场景 | 原因 |
|------|------|
| Publisher Confirm 超时 | Producer 以为发送失败，重发，但 Broker 其实已收到 |
| Consumer 处理完但 ACK 前崩溃 | 消息重新入队，被另一个 Consumer 消费 |
| 网络抖动 | ACK 丢失，Broker 重新投递 |

## 2. 去重方案

### 2.1 Redis Set 去重

```java
String messageId = props.getMessageId();
Boolean isNew = redis.opsForValue().setIfAbsent("msg:dedup:" + messageId, "1", 24, TimeUnit.HOURS);
if (Boolean.TRUE.equals(isNew)) {
    processMessage(body);
    channel.basicAck(tag, false);
} else {
    log.info("Duplicate: {}", messageId);
    channel.basicAck(tag, false);  // 直接确认，不重复处理
}
```

### 2.2 数据库唯一约束

```java
try {
    orderService.createOrder(orderId, data);
    channel.basicAck(tag, false);
} catch (DuplicateKeyException e) {
    log.info("Duplicate order: {}", orderId);
    channel.basicAck(tag, false);
}
```

### 2.3 乐观锁（版本号）

```java
int updated = orderRepository.updateStatus(orderId, "PAID", "CREATED");
if (updated > 0) {
    channel.basicAck(tag, false);
} else {
    log.info("Already processed: {}", orderId);
    channel.basicAck(tag, false);
}
```

## 3. 去重窗口

Redis 去重的 TTL 就是"去重窗口"。窗口大小取决于：

- 消息的最大可能延迟（如延迟队列的 TTL）
- Consumer 的最大处理时间
- 网络的最大延迟

**经验法则**：去重窗口 = 最大消息 TTL + 最大处理时间 + 缓冲时间。

## 4. 最佳实践

1. **每条消息设置唯一 messageId**（Producer 端）
2. **Consumer 端做幂等**，不要依赖 Broker 保证
3. **选择合适的去重方案**：Redis 适合高并发，数据库适合强一致
4. **去重窗口不要太短**，宁可长一些
