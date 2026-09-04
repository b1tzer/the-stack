# 消息 TTL

> TTL（Time To Live）控制消息在 Queue 中的最大存活时间。超时后消息变成死信。

## 1. 两种 TTL 设置方式

### Queue 级别 TTL

```java
Map<String, Object> args = new HashMap<>();
args.put("x-message-ttl", 60000);  // 所有消息统一 60 秒
channel.queueDeclare("delay.queue", true, false, false, args);
```

### 消息级别 TTL

```java
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
    .expiration("30000")  // 这条消息 30 秒
    .build();
channel.basicPublish("exchange", "key", props, body);
```

**两者取较小值**：Queue TTL = 60s，消息 TTL = 30s → 实际 TTL = 30s。

## 2. TTL = 0 的含义

消息级别 TTL 设为 `"0"` 表示消息立即过期（但如果 Queue 为空，消息会直接投递给消费者，不会进入 DLX）。

Queue 级别 TTL 设为 `0` 表示消息永不过期（默认行为）。

## 3. 延迟队列实现

```java
// 延迟 Queue：消息等 TTL 到期后进入 DLX
Map<String, Object> args = new HashMap<>();
args.put("x-message-ttl", 300000);  // 5 分钟
args.put("x-dead-letter-exchange", "order.exchange");
args.put("x-dead-letter-routing-key", "order.timeout");
channel.queueDeclare("delay.order.timeout", true, false, false, args);

// 生产者：发送需要延迟处理的消息
channel.basicPublish("", "delay.order.timeout", props, orderId);

// 消费者：消费延迟后的消息
channel.basicConsume("order.timeout.queue", false, consumer);
```

## 4. Head-of-Line Blocking 问题

```txt
Queue: [msg1(TTL=60s), msg2(TTL=10s), msg3(TTL=30s)]

t=0s:   msg1 在队头
t=10s:  msg2 TTL 到期，但 msg1 还在队头 → msg2 不能出队
t=30s:  msg3 TTL 到期，但 msg1 还在队头 → msg3 不能出队
t=60s:  msg1 过期 → msg1 出队 → msg2, msg3 一起出队
```

消息按 FIFO 排列，队头消息没过期，后面的消息即使过期也不能出队。

**解决方案**：

1. **统一 TTL**：同一 Queue 的消息 TTL 设为相同值
2. **延迟消息插件**：`rabbitmq_delayed_message_exchange` 在 Exchange 层面延迟，没有此问题
3. **每条消息独立 Queue**：每种 TTL 用不同的 Queue（不推荐，Queue 太多）

## 5. TTL vs 延迟消息插件

| 维度 | TTL + DLX | 延迟消息插件 |
| :-- | :-- | :-- |
| Head-of-Line Blocking | 有 | 无 |
| 精度 | 秒级 | 毫秒级 |
| 配置 | Queue 参数 | Exchange 参数 |
| 官方支持 | 原生 | 社区插件 |
| 性能 | 好 | 好 |

**推荐**：如果需要精确的延迟时间，用延迟消息插件。如果只是简单的超时重试，TTL + DLX 够用。
