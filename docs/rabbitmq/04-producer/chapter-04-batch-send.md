# 批量发送

> 逐条发送消息的性能瓶颈不在 Broker，而在网络往返。批量发送可以显著提升吞吐量。

## 1. 为什么需要批量发送

```txt
逐条发送：
  Producer ──msg1──▶ Broker ──confirm──▶ Producer
  Producer ──msg2──▶ Broker ──confirm──▶ Producer
  Producer ──msg3──▶ Broker ──confirm──▶ Producer
  每条消息一次网络往返，延迟叠加

批量发送：
  Producer ──[msg1,msg2,msg3]──▶ Broker ──[confirm]──▶ Producer
  一批消息一次网络往返
```

## 2. RabbitMQ 的批量方式

RabbitMQ 没有原生的"批量发送 API"，但可以通过以下方式实现：

### 2.1 批量 Confirm

```java
channel.confirmSelect();
int batchSize = 100;
int count = 0;

for (Message msg : messages) {
    channel.basicPublish("exchange", "routingKey", props, msg);
    count++;
    if (count % batchSize == 0) {
        channel.waitForConfirmsOrDie(5000);
    }
}
if (count % batchSize != 0) {
    channel.waitForConfirmsOrDie(5000);
}
```

### 2.2 异步批量 Confirm

```java
channel.confirmSelect();
ConcurrentNavigableMap<Long, Message> outstanding = new ConcurrentSkipListMap<>();

channel.addConfirmListener(
    (tag, multiple) -> {
        if (multiple) {
            ConcurrentNavigableMap<Long, Message> confirmed = outstanding.headMap(tag + 1);
            confirmed.clear();
        } else {
            outstanding.remove(tag);
        }
    },
    (tag, multiple) -> {
        // nack：重新发送
        Message msg = outstanding.get(tag);
        resend(msg);
    }
);

for (Message msg : messages) {
    long seq = channel.getNextPublishSeqNo();
    outstanding.put(seq, msg);
    channel.basicPublish("exchange", "routingKey", props, msg);
}
```

## 3. Channel 复用

```java
// 一个线程一个 Channel，多线程并行发送
ExecutorService executor = Executors.newFixedThreadPool(10);
Connection connection = factory.newConnection();

for (List<Message> batch : partitions) {
    executor.submit(() -> {
        Channel ch = connection.createChannel();
        ch.confirmSelect();
        for (Message msg : batch) {
            ch.basicPublish("exchange", "key", props, msg);
        }
        ch.waitForConfirmsOrDie(5000);
        ch.close();
    });
}
```

## 4. 性能对比

| 方式 | 吞吐量（参考值） | 延迟 |
| :-- | :-- | :-- |
| 逐条发送 + 无 Confirm | ~5 万 msg/s | 低 |
| 逐条发送 + 同步 Confirm | ~1 万 msg/s | 高 |
| 批量发送 + 批量 Confirm | ~10 万 msg/s | 中 |
| 异步 Confirm | ~15 万 msg/s | 低 |
| 多 Channel 并行 + 异步 Confirm | ~30 万 msg/s | 低 |

*参考值：3 节点 Quorum Queue，消息体 1KB，千兆网络*

## 5. 注意事项

1. **批量大小不是越大越好**：太大的批次会增加单次发送的延迟
2. **内存压力**：大批量发送时，客户端缓冲区可能撑满（`publisher-returns` 监控）
3. **确认超时**：批量 Confirm 要设置合理的超时，避免无限等待
4. **消费者端也需要批量**：生产者批量发送，消费者也应该批量确认
