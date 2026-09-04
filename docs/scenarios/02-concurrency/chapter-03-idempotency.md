# 幂等性设计

> 幂等性 = 同一个操作执行多次，结果和执行一次相同。这是分布式消息系统的基石。

## 1. 为什么需要幂等

```txt
Producer 发送 msg1 → Broker 收到 → Consumer 处理 → ACK 前崩溃
                                              ↓
                            消息重新入队 → Consumer 再次处理

如果 createOrder 不是幂等的 → 创建了两个订单！
```

## 2. 幂等性实现层次

### 2.1 消息级别幂等

```java
// Producer：每条消息带唯一 ID
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
    .messageId(UUID.randomUUID().toString())
    .build();

// Consumer：用消息 ID 去重
String msgId = props.getMessageId();
if (isDuplicate(msgId)) {
    channel.basicAck(tag, false);
    return;
}
processMessage(body);
markAsProcessed(msgId);
channel.basicAck(tag, false);
```

### 2.2 业务级别幂等

```java
// 方案 1：唯一约束
CREATE UNIQUE INDEX uk_order_id ON orders(order_id);
// 重复插入 → DuplicateKeyException → 直接忽略

// 方案 2：状态机
UPDATE orders SET status = 'PAID' WHERE order_id = ? AND status = 'CREATED';
// 已经 PAID 的订单 → affected rows = 0 → 不重复处理

// 方案 3：去重表
INSERT INTO processed_messages(message_id) VALUES(?);
// 重复 → DuplicateKeyException → 直接忽略
```

### 2.3 外部服务调用幂等

```java
// 调用支付接口时，传递幂等键
PaymentRequest request = new PaymentRequest();
request.setIdempotencyKey(orderId);  // 同一个订单只扣一次款
paymentService.charge(request);
```

## 3. 幂等性检查的时机

```txt
1. 收到消息 → 检查是否重复
2. 业务处理 → 利用数据库约束保证
3. 调用外部服务 → 传递幂等键
4. ACK → 确认消息
```

## 4. 常见陷阱

| 陷阱 | 正确做法 |
| :-- | :-- |
| 先 ack 再处理 | 先处理再 ack |
| 只检查不标记 | 检查和标记用同一个原子操作 |
| 去重窗口太短 | 覆盖最大重试时间 |
| 外部调用不做幂等 | 传递幂等键 |
| 数据库事务中检查+处理+标记 | 用数据库约束天然保证 |

## 5. 总结

幂等性不是单一技术，而是一种设计思想：

1. **Producer**：每条消息带唯一 ID
2. **Broker**：Confirm + ACK 保证不丢
3. **Consumer**：去重 + 数据库约束保证不重复
4. **外部调用**：幂等键保证不重复扣款/发货
