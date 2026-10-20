# Mandatory 与 Return

> Mandatory 机制解决的问题是：消息发到了 Exchange，但路由不到任何 Queue 时，怎么办？

## 1. 默认行为

```txt
Producer ──▶ Exchange ──routing failed──▶ ???

默认：消息静默丢弃。Producer 不知道。
```

## 2. Mandatory 参数

```java
// basicPublish 的第三个参数是 mandatory
channel.basicPublish("order.exchange", "order.unknown", 
    true,   // mandatory = true：路由失败时返回给 Producer
    props, body);
```

| mandatory | 路由成功 | 路由失败 |
| :-- | :-- | :-- |
| false（默认） | 正常投递 | 静默丢弃 |
| true | 正常投递 | Return 回调通知 Producer |

## 3. Return 回调

```java
channel.addReturnListener(returnMessage -> {
    int replyCode = returnMessage.getReplyCode();
    String replyText = returnMessage.getReplyText();
    String exchange = returnMessage.getExchange();
    String routingKey = returnMessage.getRoutingKey();
    byte[] body = returnMessage.getBody();
    
    log.warn("Message returned: exchange={}, routingKey={}, code={}, text={}",
        exchange, routingKey, replyCode, replyText);
    
    // 处理未路由的消息：记录日志、重新路由、告警
});

// 发送时设置 mandatory = true
channel.basicPublish("order.exchange", "order.unknown", true, props, body);
```

## 4. Return 的触发条件

| 条件 | 是否触发 Return |
| :-- | :-- |
| 消息路由到至少一个 Queue | ❌ 不触发 |
| 消息路由不到任何 Queue + mandatory = true | ✅ 触发 |
| 消息路由不到任何 Queue + mandatory = false | ❌ 静默丢弃 |
| Exchange 不存在 | ❌ Channel 异常（404） |

## 5. Mandatory vs Alternate Exchange

| 维度 | Mandatory | Alternate Exchange |
| :-- | :-- | :-- |
| 机制 | Return 回调通知 Producer | 自动转发到另一个 Exchange |
| Producer 感知 | 需要监听 Return 回调 | 无感知（消息去了 AE） |
| 适用场景 | 需要 Producer 处理未路由消息 | 需要统一收集未路由消息 |
| 推荐 | 作为兜底 | 作为主要方案 |

**最佳实践**：两者配合使用。Alternate Exchange 作为主要收集机制，Mandatory 作为兜底（防止 AE 也没配置的情况）。

## 6. Return 与 Publisher Confirm 的关系

Return 与 [Publisher Confirm](chapter-02-publisher-confirm.md) 是两套独立机制，判断单条消息的最终结果需要组合两者，而不是只盯其中一个。

| 观察到的事件 | 含义 |
| :-- | :-- |
| 收到 Return | 消息未路由到任何 Queue（且没有 AE 兜底） |
| 收到 Confirm ACK，未收到 Return | 只说明 Broker 已处理该次发布，不能证明进入了预期的业务 Queue |
| 未收到 Confirm | 发布结果未知，超时重发可能造成重复投递，消费端需幂等 |

一条不可路由且 mandatory=true 的消息，Broker 会先发 `basic.return`，再发对应的 `basic.ack`。所以 Confirm ACK 只保证「Broker 接收了」，不保证「路由到了 Queue」。

两个容易踩的坑：

- 只统计 Confirm ACK，会把进入 [Alternate Exchange](../02-exchange/chapter-06-alternate-exchange.md) 的消息误判为业务路由成功。消息被 AE 接管时视为已路由，不会触发 Return。
- 只处理 Return，会漏掉「未收到 Confirm」的未知态，此时既不能认定发送失败，也不能认定发送成功。

Return 事件携带消息属性，可直接读 messageId；Confirm 的 ACK 则通过 deliveryTag（发布序列号）关联发布操作，不直接携带 messageId。两者都是异步事件，要关联同一条消息需在发送侧维护 deliveryTag 与业务 messageId 的映射（做法见 [Publisher Confirm](chapter-02-publisher-confirm.md)），再据此决定告警、重发或补偿。

## 7. 典型场景

### 7.1 消息路由验证

```java
// 开发/测试环境：验证 order.unknown 无法路由时能通过 Return 被检测到。
// Return 是异步回调，抛异常不会传回调用 basicPublish 的线程，无法直接让测试失败。
CountDownLatch latch = new CountDownLatch(1);
Set<String> unrouted = ConcurrentHashMap.newKeySet();

channel.addReturnListener(msg -> {
    unrouted.add(msg.getRoutingKey());
    latch.countDown();
});

channel.basicPublish("order.exchange", "order.unknown", true, props, body);

// await 返回 false 表示超时未收到 Return，与「收到但 routing key 不符」是两种失败
if (!latch.await(2, TimeUnit.SECONDS)) {
    throw new AssertionError("2 秒内未收到 Return");
}
assertTrue(unrouted.contains("order.unknown"));
```

### 7.2 未路由消息告警

```java
// Return 回调运行在客户端分派线程，Channel 非线程安全：
// 不要在回调里复用发布 Channel，避免与业务线程并发操作同一 Channel、阻塞分派线程。
channel.addReturnListener(msg -> {
    // 持续有 Return 说明 routing 配置有问题
    alertService.send("Unrouted message: " + msg.getRoutingKey());
    // 转存到死信队列，用独立 Channel
    deadLetterChannel.basicPublish("dlx.exchange", "unrouted",
        msg.getProperties(), msg.getBody());
});
```

生产实现还需补齐转存失败重试、告警失败处理和重复投递下的消费端幂等。示例中的同步告警与转存仍会阻塞回调分派线程，生产环境应改为异步或有界队列处理。
