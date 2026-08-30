# 竞争消费者

> 竞争消费者（Competing Consumers）是 RabbitMQ 最基本的负载均衡模式：多个消费者订阅同一个队列，消息只被其中一个消费。

## 1. 模式原理

```text
Producer ──▶ Queue ──┬── Consumer 1
                     ├── Consumer 2
                     └── Consumer 3
```

- 每条消息只投递给一个消费者
- 多个消费者之间是竞争关系
- 天然实现负载均衡

## 2. 实现方式

```java
// 多个消费者订阅同一个队列
for (int i = 0; i < consumerCount; i++) {
    channel.basicConsume("work.queue", false,
        "consumer-" + i,
        (tag, delivery) -> {
            processMessage(delivery);
            channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
        },
        tag -> {});
}
```

## 3. 消费者分配策略

### 3.1 Round-Robin（默认）

消息按轮询方式分配给消费者：

```text
消息1 → Consumer 1
消息2 → Consumer 2
消息3 → Consumer 3
消息4 → Consumer 1
...
```

### 3.2 按 Prefetch 分配

设置不同 prefetch，处理能力强的消费者接收更多消息：

```java
// 处理能力强的消费者
channel.basicQos(100);

// 处理能力弱的消费者
channel.basicQos(10);
```

## 4. 消费者动态伸缩

```java
// 启动新消费者
channel.basicConsume("work.queue", false, newConsumerTag,
    deliverCallback, cancelCallback);

// 停止消费者
channel.basicCancel(consumerTag);
```

运行时可以随时增加或减少消费者，无需修改配置。

## 5. 消息顺序保证

竞争消费者模式下，单条消息的顺序无法保证：

```text
消息1 → Consumer 1（处理慢）
消息2 → Consumer 2（处理快）
结果：消息2 先处理完成
```

需要顺序保证的场景：

- 使用单消费者
- 使用一致性哈希交换器
- 按业务 ID 路由到固定队列

## 6. 典型场景

- 异步任务处理（邮件发送、图片处理）
- 工作队列（耗时任务分发）
- 日志收集（多消费者并行处理）
- 消息分发（一个队列多个消费者）
