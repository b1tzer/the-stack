# Publisher Confirm

> Publisher Confirm 是 RabbitMQ 保证消息到达 Broker 的核心机制。它替代了性能差的事务机制，提供异步确认能力。

## 1. 为什么需要 Confirm

```text
Producer ──basicPublish──▶ Exchange ──▶ Queue
                                │
                           消息丢失？
                           网络中断？
                           Broker 崩溃？
```

没有 Confirm，生产者无法知道消息是否成功投递。

## 2. 启用 Confirm

```java
channel.confirmSelect(); // 开启 confirm 模式
```

## 3. 同步确认

```java
channel.confirmSelect();
channel.basicPublish(exchange, routingKey, null, body);
if (!channel.waitForConfirms(5000)) { // 等待 5 秒
    // 消息投递失败，重试或记录
    log.error("消息投递失败");
}
```

性能差，不推荐生产使用。

## 4. 异步确认（推荐）

```java
channel.confirmSelect();

// 注册确认回调
channel.addConfirmListener(
    (deliveryTag, multiple) -> {
        // 消息被 broker 确认
        if (multiple) {
            confirmSet.headSet(deliveryTag + 1).clear();
        } else {
            confirmSet.remove(deliveryTag);
        }
    },
    (deliveryTag, multiple) -> {
        // 消息被 broker 拒绝
        log.error("消息被拒绝: deliveryTag={}", deliveryTag);
        // 重试或记录
    }
);

// 发送消息
for (int i = 0; i < 1000; i++) {
    long seqNo = channel.getNextPublishSeqNo();
    confirmSet.add(seqNo);
    channel.basicPublish(exchange, routingKey, null, body);
}
```

## 5. Confirm vs 事务

| 特性 | Confirm | 事务（Tx） |
| :-- | :-- | :-- |
| 性能 | 高（异步） | 低（同步阻塞） |
| 粒度 | 单条/批量 | 批量 |
| 实现 | 服务端异步回调 | AMQP Tx 类 |
| 推荐场景 | 所有场景 | 极少使用 |

**永远不要在生产环境使用事务，用 Confirm 替代。**

## 6. Confirm 与 Return 的关系

| 机制 | 触发条件 | 说明 |
| :-- | :-- | :-- |
| Confirm | 消息到达 Exchange | 消息被 broker 接收 |
| Return | 消息无法路由到队列 | mandatory=true 时触发 |

```java
channel.addReturnListener(returnMessage -> {
    log.warn("消息路由失败: {}",
        returnMessage.getReplyText());
});
```

## 7. 最佳实践

- 所有生产者必须开启 Confirm
- 使用异步 Confirm，不要同步等待
- 维护一个 unconfirm 集合，定时重发超时消息
- 配合 mandatory + ReturnListener 处理路由失败
- 消息发送和 Confirm 回调在不同线程
