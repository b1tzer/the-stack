# 幂等性设计

> 幂等性是分布式消息系统的核心要求：无论消息被处理多少次，结果都与处理一次相同。

## 1. 幂等的定义

```text
f(f(x)) = f(x)
```

无论执行一次还是多次，结果相同。

## 2. 常见操作的幂等性

| 操作 | 天然幂等 | 说明 |
| :-- | :-- | :-- |
| SELECT | ✅ | 读操作天然幂等 |
| UPDATE SET col=val | ✅ | 设置固定值 |
| UPDATE SET col=col+N | ❌ | 需要条件或版本号 |
| INSERT | ❌ | 可能重复插入 |
| DELETE | ✅ | 删除已删除的数据不影响 |

## 3. 设计模式

### 3.1 唯一标识 + 去重表

```java
public void processOrder(OrderMessage msg) {
    // 1. 检查是否已处理
    if (processedMessageRepository.exists(msg.getMessageId())) {
        return;
    }

    // 2. 处理业务
    orderService.createOrder(msg);

    // 3. 记录已处理
    processedMessageRepository.save(msg.getMessageId());
}
```

### 3.2 状态机

```java
// 订单状态机：CREATED → PAID → SHIPPED → COMPLETED
public void payOrder(String orderId) {
    int affected = orderDao.updateStatus(orderId, "PAID", "CREATED");
    if (affected == 0) {
        // 状态不是 CREATED，说明已处理过
        log.info("订单已支付或状态异常: {}", orderId);
        return;
    }
    // 继续处理支付逻辑
}
```

### 3.3 乐观锁

```java
// 用版本号防止重复扣减
public void decreaseStock(String productId, int quantity, int version) {
    int affected = inventoryDao.decrease(productId, quantity, version);
    if (affected == 0) {
        throw new OptimisticLockException("库存版本冲突");
    }
}
```

### 3.4 Token 机制

```java
// 1. 服务端生成唯一 token
String token = generateToken();
redis.setex("token:" + token, 300, "1");

// 2. 客户端携带 token 请求
public void submit(String token) {
    if (redis.del("token:" + token) == 0) {
        throw new DuplicateRequestException("重复请求");
    }
    // 处理请求
}
```

## 4. 最佳实践

- 消息系统必须设计幂等消费者
- 优先使用业务天然幂等
- 使用全局唯一消息 ID
- 去重和业务操作在同一事务中
- 考虑去重存储的容量和过期策略
