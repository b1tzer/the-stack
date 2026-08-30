# Direct Exchange

> Direct Exchange 是最简单的路由模式：消息的 routing key 与绑定的 routing key 完全匹配时，消息被路由到对应队列。

## 1. 路由规则

```text
Producer ──routing key="order.created"──▶ Direct Exchange
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │ (binding key="order.created")  (binding key="order.paid")
                    ▼                         ▼                         ▼
              Queue A ✅                   Queue B ❌                 Queue C ❌
```

精确匹配：routing key == binding key

## 2. 典型场景

### 2.1 精确路由

```text
order.exchange (direct)
  ├── binding key="order.created" ──▶ order-created-queue
  ├── binding key="order.paid"    ──▶ order-paid-queue
  └── binding key="order.shipped" ──▶ order-shipped-queue
```

### 2.2 多消费者竞争

多个消费者订阅同一个队列，实现负载均衡：

```text
notification.exchange (direct)
  └── binding key="email" ──▶ email-queue
                                  ├── Consumer 1
                                  ├── Consumer 2
                                  └── Consumer 3
```

## 3. 默认交换器

默认交换器 `""` 就是 direct 类型：

```java
// 这两种方式等效
channel.basicPublish("", "my-queue", null, body);
channel.basicPublish("my-queue", "my-queue", null, body); // 默认交换器路由 key = 队列名
```

## 4. 与 Topic 的区别

| 特性 | Direct | Topic |
| :-- | :-- | :-- |
| 匹配方式 | 精确匹配 | 通配符匹配 |
| 性能 | 更高 | 略低 |
| 灵活性 | 低 | 高 |
| 适用场景 | 明确的路由规则 | 模糊匹配场景 |
