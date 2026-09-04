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
| 性能 | 更快（简单字符串比较） | 稍慢（需要模式匹配） |
| 灵活性 | 低 | 高 |
| 适用场景 | 确定性路由 | 模糊分类路由 |

**选择建议**：如果 routing key 是确定的（如 `order.created`），用 Direct。如果需要通配符（如 `order.*`），用 Topic。
