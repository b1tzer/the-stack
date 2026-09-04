# 死信队列

> 死信队列（Dead Letter Queue）是处理"失败消息"的标准方案。消息变成死信后，不会被丢弃，而是路由到专门的队列。

## 1. 什么情况下消息变成死信

| 场景 | 说明 |
| :-- | :-- |
| 消费者拒绝 | `basic.nack` 或 `basic.reject`，且 `requeue = false` |
| 消息 TTL 到期 | 消息在 Queue 中超过 x-message-ttl |
| Queue 长度超限 | Queue 达到 x-max-length，新消息将最老的消息挤出 |
| 投递次数超限 | Quorum Queue 的 x-delivery-limit 超过 |

## 2. 配置死信队列

```java
// 1. 声明死信 Exchange
channel.exchangeDeclare("dlx.exchange", BuiltinExchangeType.DIRECT, true);

// 2. 声明死信 Queue
channel.queueDeclare("dlx.order.queue", true, false, false, null);
channel.queueBind("dlx.order.queue", "dlx.exchange", "dlx.order");

// 3. 声明业务 Queue 时指定 DLX
Map<String, Object> args = new HashMap<>();
args.put("x-dead-letter-exchange", "dlx.exchange");
args.put("x-dead-letter-routing-key", "dlx.order");
channel.queueDeclare("order.queue", true, false, false, args);
```

## 3. 死信消息的 Headers

当消息变成死信时，RabbitMQ 会在消息的 headers 中添加：

| Header | 说明 |
| :-- | :-- |
| `x-first-death-reason` | 第一次变成死信的原因（rejected, expired, maxlen, delivery_limit） |
| `x-first-death-queue` | 第一次变成死信的 Queue 名 |
| `x-first-death-exchange` | 第一次变成死信的 Exchange 名 |
| `x-death` | 所有死信记录的数组（可能多次死信） |

```java
// 消费死信队列时可以读取这些 header
@RabbitListener(queues = "dlx.order.queue")
public void handleDlx(Message message) {
    String reason = message.getMessageProperties()
        .getHeaders().get("x-first-death-reason").toString();
    String originalQueue = message.getMessageProperties()
        .getHeaders().get("x-first-death-queue").toString();
    
    log.warn("Message dead-lettered: reason={}, originalQueue={}", reason, originalQueue);
}
```

## 4. 死信的再投递

死信消息被发送到 DLX 后，如果 DLX 绑定的 Queue 也有 DLX 配置，消息会继续死信下去。这可以实现多级重试：

```txt
order.queue (retry 1) → DLX → delay.1min.queue (TTL 1分钟) → order.queue (retry 2)
order.queue (retry 2) → DLX → delay.5min.queue (TTL 5分钟) → order.queue (retry 3)
order.queue (retry 3) → DLX → final.dlx.queue (人工处理)
```

## 5. 延迟队列的实现

利用消息 TTL + DLX 可以实现延迟队列：

```java
// 延迟 Queue（消息在这里等 TTL 到期，然后进入 DLX）
Map<String, Object> args = new HashMap<>();
args.put("x-message-ttl", 300000);  // 5 分钟
args.put("x-dead-letter-exchange", "order.exchange");
args.put("x-dead-letter-routing-key", "order.timeout");
channel.queueDeclare("delay.order.timeout", true, false, false, args);

// 生产者发消息到 delay Queue
channel.basicPublish("", "delay.order.timeout", props, body);

// 5 分钟后，消息自动进入 order.exchange → order.timeout.queue
```

**注意**：这种实现方式有一个问题——消息在 delay Queue 中是按 FIFO 排列的，如果队头消息的 TTL 比后面消息的 TTL 长，后面消息即使 TTL 到期也要等队头消息先过期（Head-of-Line Blocking）。

**解决方案**：使用延迟消息插件（rabbitmq_delayed_message_exchange），它在 Exchange 层面实现延迟，没有 Head-of-Line Blocking 问题。

## 6. 死信队列的最佳实践

1. **每个业务 Queue 都配置 DLX**：避免消息静默丢失
2. **死信队列配置告警**：有消息进入说明有问题
3. **记录死信原因**：通过 headers 判断是 rejected、expired 还是 maxlen
4. **死信消息人工处理**：不要自动重试（可能造成死循环），而是人工排查后手动重新投递
5. **延迟重试**：如果需要自动重试，用延迟队列 + DLX 组合，不要直接 requeue
