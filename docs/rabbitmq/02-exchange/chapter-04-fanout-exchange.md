# Fanout Exchange

> Fanout Exchange 将消息广播到所有绑定的队列，忽略 routing key。它是发布/订阅模式的典型实现。

## 1. 路由规则

```text
Producer ──▶ Fanout Exchange
                  │
        ┌─────────┼─────────┐
        ▼         ▼         ▼
    Queue A   Queue B   Queue C
   (Consumer) (Consumer) (Consumer)
```

所有绑定队列都会收到消息的完整副本。

## 2. 典型场景

### 2.1 广播通知

```text
notification.fanout (fanout)
  ├── email-queue     ──▶ 邮件服务
  ├── sms-queue       ──▶ 短信服务
  ├── push-queue      ──▶ 推送服务
  └── wechat-queue    ──▶ 微信服务
```

### 2.2 数据同步

```text
data.sync (fanout)
  ├── cache-invalidation-queue  ──▶ 缓存失效
  ├── search-index-queue        ──▶ 搜索索引更新
  └── analytics-queue           ──▶ 数据分析
```

### 2.3 事件溯源

```text
domain.event (fanout)
  ├── order-service-queue    ──▶ 订单服务
  ├── inventory-service-queue ──▶ 库存服务
  └── billing-service-queue  ──▶ 计费服务
```

## 3. 注意事项

| 事项 | 说明 |
| :-- | :-- |
| 消息复制 | 每个绑定队列收到独立副本 |
| 性能影响 | 绑定队列越多，网络开销越大 |
| 消息丢失风险 | 绑定后才收到消息，历史消息不会补发 |
| 不需要 routing key | routing key 被忽略 |

## 4. 与 Pub/Sub 的区别

RabbitMQ 的 Fanout 与 Redis Pub/Sub 的区别：

| 特性 | RabbitMQ Fanout | Redis Pub/Sub |
| :-- | :-- | :-- |
| 消息持久化 | 支持 | 不支持 |
| 消费者离线 | 消息在队列中等待 | 消息丢失 |
| 消费者组 | 支持（多消费者竞争） | 不支持 |
| ACK 机制 | 支持 | 不支持 |
