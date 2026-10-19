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

`0` 是特例，表示「立即过期」而非「不设限制」。消息到达队列后，若不能立刻投递给消费者，就会过期（配置了 DLX 则转入死信队列，否则直接丢弃）。

- 消息级 `expiration = "0"` 让消息立即过期，若队列正好有消费者在等待，可直接投递而不进入 DLX。
- 队列级 `x-message-ttl = 0` 同样表示零存活时间，消息到达即过期，「能立即投递则投递，否则死信或丢弃」。

真正让消息「永不过期」的是**不设置** `x-message-ttl`，这与设为 `0` 完全相反。此外队列级 `x-message-ttl` 是整数毫秒值，消息级 `expiration` 是字符串。

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

示例假设 `order.exchange` 已经声明，且 `order.timeout` 这个 routing key 能路由到最终目标队列。`x-dead-letter-routing-key` 指定的 key 必须能命中某个已存在且绑定的队列，否则死信消息会被直接丢弃。

TTL + DLX 实现的是「延迟处理」，不是精确定时投递，也不保证端到端可靠。默认死信转发是 at-most-once，详见[死信队列](../03-queue/chapter-06-dead-letter.md)。

## 4. Head-of-Line Blocking 问题

```txt
Queue: [msg1(TTL=60s), msg2(TTL=10s), msg3(TTL=30s)]

t=0s:   msg1 在队头
t=10s:  msg2 TTL 到期，但 msg1 还在队头 → msg2 不能出队
t=30s:  msg3 TTL 到期，但 msg1 还在队头 → msg3 不能出队
t=60s:  msg1 过期 → msg1 出队 → msg2, msg3 一起出队
```

消息按 FIFO 排列，队头消息没过期，后面的消息即使过期也不能出队。

这种队头阻塞只在**同一队列混用不同 per-message TTL** 时出现。队列级 `x-message-ttl` 让整队消息共享同一过期时间，不会有此问题。非优先级队列下，Classic Queue 与 Quorum Queue 都是过期消息到达队头才被移出或死信，所以队头阻塞并非 Classic Queue 独有。优先级队列是例外，Quorum Queue 会跨优先级扫描过期消息，每个优先级内遇到第一条未过期消息才停止。

**解决方案**：

1. **统一 TTL**：同一 Queue 的消息 TTL 设为相同值
2. **延迟消息插件**：`rabbitmq_delayed_message_exchange` 在 Exchange 层面延迟，没有队头阻塞问题。但该插件已停止维护，依赖的 Mnesia 在 RabbitMQ 4.3 中已移除，无法在 4.3 上使用，详见 §5
3. **每条消息独立 Queue**：每种 TTL 用不同的 Queue（不推荐，Queue 太多）

## 5. TTL vs 延迟消息插件

`rabbitmq_delayed_message_exchange` 插件已停止维护，依赖的 Mnesia 在 RabbitMQ 4.3 中已移除，因此 4.3 起无法使用。下表仅作历史对比。

| 维度 | TTL + DLX | 延迟消息插件（历史） |
| :-- | :-- | :-- |
| Head-of-Line Blocking | 有 | 无 |
| 配置 | Queue 参数 | Exchange 参数 |
| 官方支持 | 原生 | 社区插件，已停止维护 |
| 4.3 可用性 | 可用 | 不可用 |

**推荐**：RabbitMQ 4.3 原生机制中，常用的延迟消息方案是 TTL + DLX，超时重试或分钟级延迟用它够用。需要精确延迟或大规模延迟消息时，可升级到 RabbitMQ 4.4 及以上，由 Quorum Queue 原生支持投递延迟，或改用商业版 Tanzu RabbitMQ 的延迟队列。
