# 批量发送与性能优化

> 单条发送效率低，批量发送是提升生产者吞吐量的关键手段。

## 1. 单条发送的问题

```text
每条消息 = 1 次网络往返
1000 条消息 = 1000 次网络往返
```

## 2. 批量发送

```java
channel.confirmSelect();

int batchSize = 100;
int outstandingMessageCount = 0;

for (int i = 0; i < messageCount; i++) {
    channel.basicPublish(exchange, routingKey, null, bodies[i]);
    outstandingMessageCount++;

    if (outstandingMessageCount == batchSize) {
        channel.waitForConfirmsOrDie(5_000);
        outstandingMessageCount = 0;
    }
}

if (outstandingMessageCount > 0) {
    channel.waitForConfirmsOrDie(5_000);
}
```

## 3. 异步批量 + Confirm

```java
channel.confirmSelect();
SortedSet<Long> confirmSet = Collections.synchronizedSortedSet(new TreeSet<>());

channel.addConfirmListener(
    (tag, multiple) -> {
        if (multiple) {
            confirmSet.headSet(tag + 1).clear();
        } else {
            confirmSet.remove(tag);
        }
    },
    (tag, multiple) -> {
        // 处理 nack
    }
);

// 批量发送
for (Message message : messages) {
    long seqNo = channel.getNextPublishSeqNo();
    confirmSet.add(seqNo);
    channel.basicPublish(exchange, routingKey, null, message);
}

// 等待所有确认
while (!confirmSet.isEmpty()) {
    Thread.sleep(10);
}
```

## 4. 性能对比

| 方式 | 吞吐量 | 说明 |
| :-- | :-- | :-- |
| 单条同步 | ~200 msg/s | 每条等确认 |
| 批量同步 | ~5000 msg/s | 100 条等一次确认 |
| 异步 Confirm | ~30000 msg/s | 不等待，回调确认 |

## 5. 优化建议

- 使用异步 Confirm，不要同步等待
- 合理设置 batchSize（100~500）
- 使用 Channel 池化（多 Channel 并行发送）
- 开启 TCP Nagle 禁用（`tcp_nodelay = true`）
- 使用消息压缩（gzip / snappy）
- 大消息考虑分割或使用流式传输
