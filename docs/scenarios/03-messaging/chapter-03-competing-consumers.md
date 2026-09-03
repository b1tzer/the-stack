# 竞争消费者

> 竞争消费者（Competing Consumers）是最常用的消息消费模式：多个消费者竞争消费同一个 Queue，实现负载均衡。

## 1. 模式说明

```txt
                    ┌─ Consumer 1
Queue ──round-robin──┼─ Consumer 2
                    └─ Consumer 3
```

- 每条消息只被一个消费者处理
- 消息在消费者之间轮询分发
- 自动实现负载均衡

## 2. 实现方式

```java
// 多个消费者订阅同一个 Queue
for (int i = 0; i < 3; i++) {
    final int consumerId = i;
    channel.basicConsume("order.queue", false, "consumer-" + i, new DefaultConsumer(channel) {
        @Override
        public void handleDelivery(String tag, Envelope envelope,
                                   AMQP.BasicProperties props, byte[] body) {
            log.info("Consumer {} processing: {}", consumerId, envelope.getDeliveryTag());
            processOrder(body);
            channel.basicAck(envelope.getDeliveryTag(), false);
        }
    });
}
```

## 3. 消息分配策略

RabbitMQ 默认使用 round-robin（轮询），但实际分配还受 Prefetch 影响：

| 策略 | 配置 | 效果 |
| :-- | :-- | :-- |
| Round-Robin（默认） | Prefetch=0 | 消息轮流分配 |
| Fair Dispatch | Prefetch=1 | 处理完一条才推下一条 |
| Prefetch=N | Prefetch=N | 最多 N 条未确认 |

```java
// Fair Dispatch：处理慢的消费者少拿消息
channel.basicQos(1);  // Prefetch = 1
```

## 4. 消费者扩缩容

```txt
场景：订单高峰
  ├─ 启动 10 个消费者实例
  ├─ 每个实例 5 个消费者线程
  └─ 共 50 个消费者竞争消费 order.queue

场景：低谷
  ├─ 缩减到 3 个实例
  └─ 共 15 个消费者
```

消费者数量可以动态调整，不需要修改 Queue 配置。

## 5. 注意事项

**5.1 消息顺序**

竞争消费者模式下，消息的处理顺序不保证。如果需要顺序处理，用单个消费者或用消息 hash 分配到固定 Queue。

**5.2 幂等性**

由于 ACK 机制，消息可能被重复投递。消费者必须做幂等处理。

**5.3 消费者故障**

如果消费者崩溃（未 ack），消息自动重新入队，被其他消费者消费。这是竞争消费者模式的天然容错能力。

## 6. 与 Kafka Consumer Group 的区别

| 维度 | RabbitMQ 竞争消费者 | Kafka Consumer Group |
| :-- | :-- | :-- |
| 分配方式 | Broker 推送（round-robin） | Consumer 主动拉取 |
| 分区 | 无分区概念 | 每个 Partition 分配一个 Consumer |
| 顺序 | 不保证 | 同 Partition 内有序 |
| 回溯 | 不支持 | 支持 |
