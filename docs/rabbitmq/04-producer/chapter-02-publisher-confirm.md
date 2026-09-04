# Publisher Confirm

> Publisher Confirm 是 RabbitMQ 确认"消息已被 Broker 成功接收"的机制。没有它，你无法知道消息是否真的到达了 Broker。

## 1. 为什么需要 Publisher Confirm

```txt
Producer ──发送消息──▶ Broker ──写入Queue──▶ ???

问题：basicPublish 是异步的，发送成功不等于 Broker 收到。
      即使 TCP 没报错，Broker 也可能在写入 Queue 前崩溃。
```

Publisher Confirm 让 Broker 告诉 Producer："这条消息我已经安全接收并写入 Queue 了。"

## 2. 开启 Confirm 模式

```java
// 开启 Confirm 模式（Channel 级别）
channel.confirmSelect();

// 发送消息
channel.basicPublish("order.exchange", "order.created", props, body);

// 等待确认（同步方式，不推荐）
boolean confirmed = channel.waitForConfirms(5000);  // 超时 5 秒
```

## 3. 异步 Confirm（推荐）

```java
channel.confirmSelect();

// 维护一个待确认的集合
SortedSet<Long> unconfirmed = Collections.synchronizedSortedSet(new TreeSet<>());

channel.addConfirmListener(
    (deliveryTag, multiple) -> {
        // 确认回调
        if (multiple) {
            unconfirmed.headSet(deliveryTag + 1).clear();  // 批量确认
        } else {
            unconfirmed.remove(deliveryTag);  // 单条确认
        }
    },
    (deliveryTag, multiple) -> {
        // 拒绝回调（极少触发）
        log.error("Message nacked: {}", deliveryTag);
        // 重新发送或记录
    }
);

// 发送时记录 deliveryTag
long tag = channel.getNextPublishSeqNo();
channel.basicPublish("order.exchange", "order.created", props, body);
unconfirmed.add(tag);
```

## 4. Confirm 的触发时机

| 场景 | Confirm 行为 |
| :-- | :-- |
| 消息路由到持久化 Queue + 持久化消息 | 写入磁盘后 confirm |
| 消息路由到持久化 Queue + 非持久化消息 | 写入内存后 confirm |
| 消息路由到 Quorum Queue | 多数节点 Raft 确认后 confirm |
| 消息路由到 Stream Queue | 写入日志后 confirm |
| 消息被 DLX 处理 | 写入 DLX Queue 后 confirm |
| 消息路由不到任何 Queue（且无 AE） | 立即 confirm（消息被丢弃，但 Broker 已接收） |

**关键理解**：Confirm 只保证"Broker 已接收"，不保证"消息已被消费"。消息从 Queue 到 Consumer 的可靠性由 ACK 机制保证。

## 5. Confirm vs 事务

| 维度 | Publisher Confirm | 事务（tx） |
| :-- | :-- | :-- |
| 性能 | 高（异步，批量确认） | 低（同步，每批一个事务） |
| 粒度 | 每条消息 | 每批消息 |
| 推荐 | ✅ 生产环境必用 | ❌ 不推荐 |
| 吞吐量影响 | 小 | 大（降低 5-10 倍） |

```java
// 事务方式（性能差，不推荐）
channel.txSelect();
channel.basicPublish("order.exchange", "order.created", props, body);
channel.txCommit();  // 同步等待
```

## 6. 批量 Confirm 优化

```java
// 每 100 条或每 5 秒检查一次确认
int batchSize = 100;
int count = 0;

while (hasMessages()) {
    channel.basicPublish(...);
    count++;
    
    if (count >= batchSize) {
        channel.waitForConfirmsOrDie(5000);
        count = 0;
    }
}

// 处理剩余
if (count > 0) {
    channel.waitForConfirmsOrDie(5000);
}
```

## 7. 丢失 Confirm 的风险

如果 Producer 在发送后、收到 Confirm 前崩溃：

- 消息可能已经到达 Broker（Confirm 丢失）
- 消息可能没到达 Broker（发送丢失）

**解决方案**：Producer 重启后，重新发送未收到 Confirm 的消息。这要求消费者做幂等处理。

## 8. 最佳实践

1. **所有生产环境必须开启 Publisher Confirm**
2. **用异步 Confirm**，不要用同步 waitForConfirms
3. **维护待确认集合**，用于超时重发
4. **设置合理的超时**（如 5-10 秒），超时未确认的消息重新发送
5. **消费者必须做幂等**，因为消息可能被重复发送
6. **不要用事务**，Confirm 的性能远好于事务
