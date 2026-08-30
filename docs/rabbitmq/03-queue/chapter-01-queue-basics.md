# Queue 基础

> Queue 是消息的最终存储单元。理解 Queue 的属性、声明方式和生命周期，是正确使用 RabbitMQ 的基础。

## 1. Queue 的本质

Queue 是一个有序的、先进先出（FIFO）的消息存储：

```text
Producer → [消息1][消息2][消息3][消息4]... → Consumer
           ──────── Queue ────────
```

## 2. Queue 属性

| 属性 | 说明 | 默认值 |
| :-- | :-- | :-- |
| Name | 队列名称 | 服务端生成 |
| Durable | 持久化，broker 重启后保留 | false |
| Exclusive | 仅限当前连接，连接断开自动删除 | false |
| Auto Delete | 所有消费者断开后自动删除 | false |
| Arguments | 扩展参数（TTL/长度/死信等） | null |

## 3. 声明 Queue

```java
channel.queueDeclare(
    "order.queue",  // 队列名
    true,           // 持久化
    false,          // 非排他
    false,          // 不自动删除
    null            // 扩展参数
);
```

幂等性：多次声明相同名称、相同属性的 Queue 不会报错。

## 4. 队列命名规范

| 场景 | 命名示例 |
| :-- | :-- |
| 业务队列 | `order.created`、`payment.process` |
| 死信队列 | `dlx.order.created` |
| 延迟队列 | `delay.order.timeout` |
| 回退队列 | `ae.unrouted` |
| 工作队列 | `task.email.send` |

## 5. 临时队列

Exclusive 或 Auto Delete 队列适用于临时场景：

```java
// 自动生成唯一名称，连接断开自动删除
String queueName = channel.queueDeclare().getQueue();
channel.queueBind(queueName, "amq.fanout", "");
```

典型场景：RPC 回调队列、事件订阅的临时队列。
