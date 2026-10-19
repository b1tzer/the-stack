# 批量发送

> 逐条发送消息的性能瓶颈不在 Broker，而在网络往返。批量发送可以显著提升吞吐量。

## 1. 为什么需要批量发送

```txt
逐条发送：
  Producer ──msg1──▶ Broker ──confirm──▶ Producer
  Producer ──msg2──▶ Broker ──confirm──▶ Producer
  Producer ──msg3──▶ Broker ──confirm──▶ Producer
  每条消息一次发布加一次确认等待，网络往返叠加

批量确认：
  Producer ──msg1──▶ Broker
  Producer ──msg2──▶ Broker
  Producer ──msg3──▶ Broker
  Producer ◀──确认这批消息── Broker
  消息仍逐条发布，等待这一批全部确认，而非合并成一次发布
```

## 2. RabbitMQ 的批量方式

RabbitMQ 没有原生的"批量发送 API"，消息始终逐条 `basicPublish`，所谓"批量"指批量等待确认而非批量发布：

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
        // nack：发布未获 Broker 确认，按 multiple 摘取受影响序号，移除后重发
        if (multiple) {
            ConcurrentNavigableMap<Long, Message> failed = outstanding.headMap(tag + 1);
            failed.values().forEach(msg -> resend(msg));
            failed.clear();
        } else {
            Message msg = outstanding.remove(tag);
            if (msg != null) {
                resend(msg);
            }
        }
    }
);

for (Message msg : messages) {
    long seq = channel.getNextPublishSeqNo();
    outstanding.put(seq, msg);
    channel.basicPublish("exchange", "routingKey", props, msg);
}
```

NACK 只表示 Broker 未确认该消息，不代表它一定丢失，直接重发可能造成重复投递，消费者端需要幂等处理。连接断开时 `outstanding` 中残留的消息确认结果未知，恢复策略需另行设计，这里不展开。

## 3. 多 Channel 并行发送

```java
// 每个任务独立创建 Channel，发送完成后关闭，多任务并行发送
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

| 方式 | 吞吐量（一般趋势） | 延迟 |
| :-- | :-- | :-- |
| 逐条发送 + 同步 Confirm | 较低 | 高 |
| 批量发送 + 批量 Confirm | 中 | 中 |
| 逐条发送 + 无 Confirm | 较高 | 低 |
| 异步 Confirm | 较高 | 低 |
| 多 Channel 并行 + 异步 Confirm | 通常最高 | 低 |

*表中为一般情况下的相对趋势，并非可复现的固定排名。具体吞吐量取决于网络 RTT、Broker 处理能力、消息持久化与队列类型，也受在途消息数量、并发度与客户端资源限制影响，需按自身环境压测。*

## 5. 注意事项

1. **批量大小不是越大越好**：太大的批次会增加单次发送的延迟
2. **内存压力**：大批量发送时，待确认消息积压在 `outstanding` 中占用内存，应关注待确认消息数量与客户端内存使用
3. **确认超时**：批量 Confirm 要设置合理的超时，避免无限等待
4. **消费者端批量确认需按需决定**：批量 ACK 减少协议交互，但会扩大单次确认覆盖的消息范围，消费者在确认前失败会导致更多消息重新投递，是否批量确认应权衡消费吞吐与故障恢复代价
