# Mandatory 与 Return

> Mandatory 机制解决的问题是：消息发到了 Exchange，但路由不到任何 Queue 时，怎么办？

## 1. 默认行为

```text
Producer ──▶ Exchange ──routing failed──▶ ???

默认：消息静默丢弃。Producer 不知道。
```

## 2. Mandatory 参数

```java
// basicPublish 的第二个参数是 mandatory
channel.basicPublish("order.exchange", "order.unknown", 
    true,   // mandatory = true：路由失败时返回给 Producer
    props, body);
```

| mandatory | 路由成功 | 路由失败 |
|-----------|----------|----------|
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
|------|----------------|
| 消息路由到至少一个 Queue | ❌ 不触发 |
| 消息路由不到任何 Queue + mandatory = true | ✅ 触发 |
| 消息路由不到任何 Queue + mandatory = false | ❌ 静默丢弃 |
| Exchange 不存在 | ❌ Channel 异常（404） |

## 5. Mandatory vs Alternate Exchange

| 维度 | Mandatory | Alternate Exchange |
|------|-----------|-------------------|
| 机制 | Return 回调通知 Producer | 自动转发到另一个 Exchange |
| Producer 感知 | 需要监听 Return 回调 | 无感知（消息去了 AE） |
| 适用场景 | 需要 Producer 处理未路由消息 | 需要统一收集未路由消息 |
| 推荐 | 作为兜底 | 作为主要方案 |

**最佳实践**：两者配合使用。Alternate Exchange 作为主要收集机制，Mandatory 作为兜底（防止 AE 也没配置的情况）。

## 6. 典型场景

### 6.1 消息路由验证

```java
// 开发/测试环境：开启 mandatory 验证 routing 配置
channel.addReturnListener(msg -> {
    throw new RuntimeException("Routing failed: " + msg.getRoutingKey());
});
```

### 6.2 未路由消息告警

```java
channel.addReturnListener(msg -> {
    // 持续有 Return 说明 routing 配置有问题
    alertService.send("Unrouted message: " + msg.getRoutingKey());
    // 记录到死信队列
    channel.basicPublish("dlx.exchange", "unrouted", msg.getProps(), msg.getBody());
});
```
