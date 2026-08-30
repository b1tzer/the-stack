# 死信队列

> 死信队列（Dead Letter Queue，DLQ）是处理"死亡"消息的标准方案。消息变成死信后，会被路由到指定的死信交换器。

## 1. 死信的条件

消息在以下情况变成死信：

| 条件 | 说明 |
| :-- | :-- |
| 消费者 nack/ reject | basicNack / basicReject，且 requeue = false |
| 消息 TTL 过期 | 消息在队列中超过 TTL |
| 队列达到长度限制 | x-max-length 或 x-max-length-bytes 超出 |
| 消息被拒绝 | basicReturn（mandatory + 无绑定） |

## 2. 配置方式

```java
// 1. 声明死信交换器
channel.exchangeDeclare("dlx.exchange", BuiltinExchangeType.DIRECT, true);

// 2. 声明死信队列
channel.queueDeclare("dlx.order.queue", true, false, false, null);
channel.queueBind("dlx.order.queue", "dlx.exchange", "dlx.order");

// 3. 业务队列配置死信
Map<String, Object> args = new HashMap<>();
args.put("x-dead-letter-exchange", "dlx.exchange");
args.put("x-dead-letter-routing-key", "dlx.order");
channel.queueDeclare("order.queue", true, false, false, args);
```

## 3. 死信流转

```text
Producer ──▶ order.queue ──(nack/过期/溢出)──▶ dlx.exchange ──▶ dlx.order.queue
```

## 4. 延迟队列实现

利用死信 + TTL 实现延迟消息：

```text
Producer ──▶ delay.queue (TTL=30s) ──(过期)──▶ dlx.exchange ──▶ real.queue ──▶ Consumer
```

```java
// 延迟队列（消息在这里等待过期）
Map<String, Object> delayArgs = new HashMap<>();
delayArgs.put("x-message-ttl", 30000);
delayArgs.put("x-dead-letter-exchange", "business.exchange");
delayArgs.put("x-dead-letter-routing-key", "order.timeout");
channel.queueDeclare("delay.order.timeout", true, false, false, delayArgs);
```

注意：这是经典延迟方案，RabbitMQ 3.8+ 推荐使用延迟消息插件。

## 5. 最佳实践

- 所有业务队列都应配置死信
- 死信队列命名规范：`dlx.<业务队列名>`
- 死信交换器使用 direct 或 topic 类型
- 定期消费死信队列，进行告警或重试
- 死信消息包含原始路由信息（`x-death` header）
