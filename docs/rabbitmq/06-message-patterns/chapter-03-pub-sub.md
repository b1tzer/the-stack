# 发布/订阅模式

> 发布/订阅（Pub/Sub）模式让一条消息被多个消费者组同时消费，每个组内只有一个消费者处理。

## 1. 模式原理

```text
Producer ──▶ Fanout Exchange ──┬── Queue A ── Consumer Group A
                               ├── Queue B ── Consumer Group B
                               └── Queue C ── Consumer Group C
```

- 每个消费者组有自己的队列
- 消息广播到所有队列
- 组内竞争消费

## 2. 实现方式

```java
// 声明交换器
channel.exchangeDeclare("event.exchange", BuiltinExchangeType.FANOUT, true);

// 消费者组 A
channel.queueDeclare("event.group-a", true, false, false, null);
channel.queueBind("event.group-a", "event.exchange", "");
channel.basicConsume("event.group-a", false, groupAConsumer, tag -> {});

// 消费者组 B
channel.queueDeclare("event.group-b", true, false, false, null);
channel.queueBind("event.group-b", "event.exchange", "");
channel.basicConsume("event.group-b", false, groupBConsumer, tag -> {});
```

## 3. 与竞争消费者的区别

| 特性 | 竞争消费者 | 发布/订阅 |
| :-- | :-- | :-- |
| 消息投递 | 一个消费者 | 每个组一个消费者 |
| 消息复制 | 不复制 | 复制到每个队列 |
| 适用场景 | 任务分发 | 事件广播 |

## 4. Topic 交换器实现选择性订阅

```text
Producer ──▶ Topic Exchange ──┬── order.* ──▶ 订单服务队列
                              ├── payment.* ──▶ 支付服务队列
                              └── # ──▶ 日志服务队列
```

## 5. 典型场景

- 事件驱动架构（领域事件广播）
- 数据同步（缓存失效、索引更新）
- 多系统集成（同一事件多个下游消费）
- 日志分发（不同服务关注不同日志）
