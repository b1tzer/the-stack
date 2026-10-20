# 死信队列

> 死信队列（Dead Letter Queue）是处理"失败消息"的标准方案。消息变成死信后，会被移出原队列；若配置了 DLX，则路由到专门的死信队列，否则被直接丢弃。

## 1. 什么情况下消息变成死信

| 场景 | 说明 |
| :-- | :-- |
| 消费者拒绝 | `basic.nack` 或 `basic.reject`，且 `requeue = false` |
| 消息 TTL 到期 | 消息在 Queue 中超过 x-message-ttl |
| Queue 长度超限 | Queue 达到 x-max-length，按 `x-overflow` 策略处理 |
| 投递次数超限 | Quorum Queue 的 x-delivery-limit 超过 |

`x-overflow` 决定超限时的处理：默认 `drop-head` 挤出最老的消息，若配置了 DLX 会将其死信；`reject-publish` 拒绝新消息；`reject-publish-dlx` 拒绝新消息并转 DLX。其中 `reject-publish-dlx` 仅经典队列支持，Quorum Queue 只支持 `drop-head` 与 `reject-publish`。

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

> 默认的死信转发是 at-most-once，不保证消息一定到达死信队列。Quorum Queue 可用 `x-dead-letter-strategy = at-least-once` 增强（RabbitMQ 3.10+），但同样受目标队列可用性与资源开销约束。

## 3. 死信消息的 Headers

当消息变成死信时，RabbitMQ 会在消息的 headers 中添加：

| Header | 说明 |
| :-- | :-- |
| `x-first-death-reason` | 第一次变成死信的原因（rejected, expired, maxlen, delivery_limit） |
| `x-first-death-queue` | 第一次变成死信的 Queue 名 |
| `x-first-death-exchange` | 第一次变成死信的 Exchange 名 |
| `x-death` | 死信历史记录数组，按队列与死信原因聚合，而非逐次事件流水 |

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

以上是逻辑示意。RabbitMQ 不会自动识别「第几次重试」，每一跳需要不同的 DLX 与 routing key，或在应用层用消息 header 记录重试次数来决定下一跳。

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

**注意**：队列级 `x-message-ttl` 让整队消息共享同一个过期时间，不存在队头阻塞。队头阻塞（Head-of-Line Blocking）出现在同一队列的消息用不同 TTL（per-message TTL，通过 `expiration` 属性设置）时——经典队列只检查队头消息是否过期，若队头 TTL 更长，后面的消息即使已到期也要等队头先被移出。

**解决方案**：延迟消息插件（rabbitmq_delayed_message_exchange）在 Exchange 层面实现延迟，没有队头阻塞问题，但它已停止维护，依赖的 Mnesia 在 RabbitMQ 4.3 中已移除，无法在 4.3 上使用。4.3 下的延迟方案以 TTL + DLX 为准，需要精确延迟时可升级到 4.4 及以上由 Quorum Queue 原生支持，或改用商业版 Tanzu RabbitMQ 的延迟队列，详见[消息 TTL](../05-consumer/chapter-04-message-ttl.md)。

## 6. 死信队列的最佳实践

1. **对需要追踪失败消息的 Queue 配置 DLX**：让被拒绝、过期、超限的消息有迹可查，而不是静默消失
2. **死信队列配置告警**：结合死信原因与数量告警，区分预期死信（如延迟队列到期）与异常死信
3. **记录死信原因**：通过 headers 判断是 rejected、expired 还是 maxlen
4. **死信消息人工处理**：可恢复的暂时性故障可以自动重试，需要人工判断的失败消息则排查后手动重新投递
5. **延迟重试**：如果需要自动重试，用延迟队列 + DLX 组合，不要直接 requeue
