# Direct Exchange

> Direct Exchange 是最简单的路由方式：routing key 精确匹配。

## 1. 路由规则

```txt
Producer ──routing key="order.created"──▶ Direct Exchange
                                              │
                                    ┌─────────┼─────────┐
                                    ▼         ▼         ▼
                              Queue A    Queue B    Queue C
                              (bind:     (bind:     (bind:
                            order.created) order.paid) order.created)
```

消息的 routing key 必须和 Queue 的 binding key **完全相同**才会被投递。

一个 routing key 可以同时匹配多个队列的绑定，一条消息可能被路由到多个队列；同一队列内的多个消费者则竞争消费该队列中的消息。

如果消息没有匹配到任何队列，默认会被丢弃；配置了 Alternate Exchange 时可以转交给备用 Exchange。使用 mandatory 参数与 basic.return 可以识别无法路由的消息，Publisher Confirm 确认的是 Broker 对发布消息的处理结果，其 ACK 不等于消息已成功路由到目标队列。详见 [Mandatory 与 Return](../04-producer/chapter-03-mandatory-return.md)、[Publisher Confirm](../04-producer/chapter-02-publisher-confirm.md) 和 [Alternate Exchange](./chapter-06-alternate-exchange.md)。

## 2. 典型场景

### 2.1 点对点任务分发

```java
// 声明
channel.exchangeDeclare("task.exchange", BuiltinExchangeType.DIRECT, true);
channel.queueDeclare("email.send", true, false, false, null);
channel.queueBind("email.send", "task.exchange", "email.send");

// 发送
channel.basicPublish("task.exchange", "email.send", props, body);

// 多个 Worker 竞争消费同一个 Queue → 负载均衡
```

### 2.2 精确路由

```java
// 不同类型的消息路由到不同 Queue
channel.queueBind("order.created.queue", "order.exchange", "order.created");
channel.queueBind("order.paid.queue", "order.exchange", "order.paid");
channel.queueBind("order.cancelled.queue", "order.exchange", "order.cancelled");
```

## 3. 一个 Queue 绑定多个 routing key

```java
// 同一个 Queue 可以绑定多个 routing key
channel.queueBind("notification.queue", "event.exchange", "user.registered");
channel.queueBind("notification.queue", "event.exchange", "user.activated");
channel.queueBind("notification.queue", "event.exchange", "user.reset-password");
```

这样，三种事件都会路由到同一个 notification.queue。

## 4. 与 Topic Exchange 的区别

| 特性 | Direct | Topic |
| :-- | :-- | :-- |
| 匹配方式 | 精确匹配 | 通配符匹配（`*` 和 `#`） |
| 灵活性 | 低 | 高 |
| 适用场景 | 确定性路由 | 基于模式的路由 |

**选择建议**：如果 routing key 是确定的（如 `order.created`），用 Direct。如果需要通配符（如 `order.*`），用 Topic。

Direct 使用精确匹配，Topic 需要进行模式匹配，这是机制差异而非性能结论。实际性能差异取决于绑定规模、匹配模式及工作负载，应通过基准测试验证，不能据此认定 Direct 必然更快。Topic Exchange 的通配符语义与使用方式见 [Topic Exchange](./chapter-03-topic-exchange.md)。
