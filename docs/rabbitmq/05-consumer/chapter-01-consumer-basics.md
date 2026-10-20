# 消费者基础

> 消费者从 Queue 中取消息。理解 Push/Pull、自动确认/手动确认的区别，是避免消息丢失或重复消费的关键。

## 1. Push vs Pull

### Push 模式（basicConsume）

```java
// Broker 主动推送消息给 Consumer
channel.basicConsume("order.queue", false, new DefaultConsumer(channel) {
    @Override
    public void handleDelivery(String tag, Envelope envelope, 
                               AMQP.BasicProperties props, byte[] body) {
        // 处理消息
        channel.basicAck(envelope.getDeliveryTag(), false);
    }
});
```

- Broker 在消息到达时立即推送给 Consumer
- 实时性好
- 需要 Prefetch 控制推送速率

### Pull 模式（basicGet）

```java
// Consumer 主动拉取消息
GetResponse response = channel.basicGet("order.queue", false);
if (response != null) {
    byte[] body = response.getBody();
    channel.basicAck(response.getEnvelope().getDeliveryTag(), false);
}
```

- Consumer 按需拉取
- 实时性差（需要轮询）
- 适用于低频消费场景

**推荐**：持续消费优先用 Push 模式（basicConsume）。只有在确实需要按需拉取单条消息时才用 Pull，因为 basicGet 依赖轮询，效率较低。

## 2. 自动确认 vs 手动确认

### 自动确认（autoAck = true）

```java
channel.basicConsume("order.queue", true, consumer);
// 消息一送达就自动确认，Broker 立即删除
```

- 消息送达即确认，不等处理完成
- 如果 Consumer 处理消息时崩溃，消息丢失
- **生产环境默认不要用**（除非业务明确接受消息丢失风险）

### 手动确认（autoAck = false）

```java
channel.basicConsume("order.queue", false, consumer);

// 处理完成后手动确认
channel.basicAck(deliveryTag, false);   // 确认单条
channel.basicAck(deliveryTag, true);    // 批量确认（<= deliveryTag 的所有消息）
```

- Consumer 处理完成后才确认
- 如果 Consumer 崩溃，消息自动重新入队
- **生产环境默认必须用**（并确保能处理重复投递）

## 3. basicAck vs basicNack vs basicReject

| 方法 | 说明 | requeue |
| :-- | :-- | :-- |
| basicAck | 确认消息已处理完成 | - |
| basicNack | 拒绝消息（可批量） | true=重新入队，false=不重新入队（成为死信，配置 DLX 才转发） |
| basicReject | 拒绝单条消息 | true=重新入队，false=不重新入队（成为死信，配置 DLX 才转发） |

```java
// 确认
channel.basicAck(tag, false);

// 拒绝并重新入队（稍后重试）
channel.basicNack(tag, false, true);

// 拒绝且不重新入队（成为死信；配置 DLX 时转发到死信队列，否则丢弃）
channel.basicNack(tag, false, false);

// 拒绝单条
channel.basicReject(tag, false);
```

## 4. 消费者标签（Consumer Tag）

```java
// 自动生成标签
String tag = channel.basicConsume("order.queue", false, consumer);
// tag = "amq.ctag-xxxxx"

// 指定标签
String tag = channel.basicConsume("order.queue", false, "order-consumer-1", consumer);
```

标签用于取消消费：

```java
channel.basicCancel(tag);  // 取消这个消费者
```

## 5. 消费者生命周期

```txt
basicConsume → 注册消费者
  │
  ├─ 消息到达 → handleDelivery → basicAck
  ├─ 消息到达 → handleDelivery → basicNack (requeue=true) → 消息重新入队
  ├─ 消息到达 → handleDelivery → basicNack (requeue=false) → 成为死信（配置 DLX 才转发，否则丢弃）
  ├─ 消费者取消 → handleCancel
  ├─ Channel/Connection 关闭 → handleShutdownSignal
  └─ Channel 关闭 → 消费者自动取消
```

## 6. 多消费者竞争消费

多个 Consumer 订阅同一个 Queue 时，消息在 Consumer 之间轮询分发。下面是简化示例，仅示意默认的交替顺序，不代表严格均分：

```txt
                    ┌─ Consumer 1 (处理 msg1, msg4, msg7...)
Queue ──round-robin──┼─ Consumer 2 (处理 msg2, msg5, msg8...)
                    └─ Consumer 3 (处理 msg3, msg6, msg9...)
```

轮询是默认分发倾向，但实际分配还受 Prefetch 和未确认消息数量影响：Prefetch 限制每个 Consumer 的未确认消息数，处理能力不同的 Consumer 拿到的消息数量并不均等，因此不能把轮询理解为严格的长期均分。配合 Prefetch 可以实现更精细的控制。

## 7. 最佳实践

1. **必须用手动确认**（autoAck = false）
2. **处理完成后再 ack**，不要先 ack 再处理
3. **处理失败区分临时性与永久性**：临时性故障可用 nack(requeue=true) 重试，但需应用侧限制重试次数（requeue=true 本身不提供重试上限）；永久性错误或超过上限用 nack(requeue=false) 拒绝（需已配置 DLX）
4. **设置 Prefetch** 控制未确认消息数量
5. **消费者异常时关闭 Channel**，未确认消息自动重新入队（注意可能造成重复处理，需保证幂等）
6. **不要在消费者回调中做耗时操作**：同一 Channel 上回调按序执行，耗时操作会延迟该 Channel 上后续消息的处理
