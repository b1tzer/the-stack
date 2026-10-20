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

// 发送前先登记 deliveryTag，避免确认回调先于登记执行
long tag = channel.getNextPublishSeqNo();
unconfirmed.add(tag);
channel.basicPublish("order.exchange", "order.created", props, body);
```

示例省略了发布异常、连接中断和待确认消息恢复的处理，生产实现需补齐这些路径。

## 4. Confirm 的触发时机

确认时机取决于目标队列类型。下表按经典队列（classic queue）与复制队列（Quorum / Stream）分别说明。

| 场景 | Confirm 行为 |
| :-- | :-- |
| 持久化消息路由到 durable classic queue | 通常写入磁盘后 confirm |
| 非持久化消息路由到 classic queue | Broker 接受消息后立即 confirm（不保证节点重启后保留） |
| 消息路由到 [Quorum Queue](../03-queue/chapter-03-quorum-queue.md) | 多数节点写入并 fsync 到磁盘后 confirm |
| 消息路由到 [Stream Queue](../03-queue/chapter-04-stream-queue.md) | 数据复制到多数副本后 confirm（不主动 fsync，依赖 OS 刷盘） |
| 消息路由不到任何 Queue（且无 AE） | 立即 confirm（消息被丢弃，但 Broker 已接收） |

Publisher Confirm 反映 Broker 对发布操作的处理结果。消息路由到队列时，确认意味着队列已接受消息；消息路由不到任何队列时，Broker 同样会发送 Confirm（消息被丢弃）。它不覆盖消息后续的消费、过期或[死信转发](../03-queue/chapter-06-dead-letter.md)过程，死信路由的可靠性需单独评估。

**关键理解**：Confirm 只保证"Broker 已接收"，不保证"消息已被消费"。消息从 Queue 到 Consumer 的可靠性由 [ACK 机制](../05-consumer/chapter-02-ack-mechanism.md)保证。

## 5. Confirm vs 事务

| 维度 | Publisher Confirm | 事务（tx） |
| :-- | :-- | :-- |
| 性能 | 高（异步，批量确认） | 低（同步，每批一个事务） |
| 粒度 | 每条消息 | 每批消息 |
| 推荐 | ✅ 生产环境必用 | ❌ 不推荐 |
| 吞吐量影响 | 小 | 大（有明显吞吐开销） |

```java
// 事务方式（性能差，不推荐）
channel.txSelect();
channel.basicPublish("order.exchange", "order.created", props, body);
channel.txCommit();  // 同步等待
```

## 6. 批量 Confirm 优化

```java
// 每 100 条检查一次确认
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

需要注意三点：

1. 超时意味着结果未知，不代表消息必然发送失败
2. 重发前需要稳定的消息标识，由消费者或业务层做幂等处理
3. 进程重启后要恢复未确认消息，需持久化发送记录，或从可靠的业务数据源重建消息

## 8. 最佳实践

1. **所有生产环境必须开启 Publisher Confirm**
2. **用异步 Confirm**，不要用同步 waitForConfirms
3. **维护待确认集合**，用于超时重发
4. **设置合理的超时**（如 5-10 秒），超时表示结果未知，需结合幂等重新发送
5. **消费者需能处理重复消息**（幂等、去重或其他可靠机制），因为消息可能被重复发送
6. **优先用 Publisher Confirm 而非事务**，事务仅在有明确事务语义需求且接受成本时才考虑
