# Mandatory 与 Return

> Mandatory 标志告诉 RabbitMQ：如果消息无法路由到队列，不要丢弃，而是 Return 给生产者。

## 1. Mandatory 的作用

```text
Producer ──▶ Exchange ──(无匹配队列)──▶ Return 给 Producer
                  │
                  └──(有匹配队列)──▶ Queue
```

## 2. 使用方式

```java
// mandatory = true
channel.basicPublish(exchange, routingKey, true, props, body);

// 注册 Return 监听器
channel.addReturnListener(returnMessage -> {
    int code = returnMessage.getReplyCode();
    String text = returnMessage.getReplyText();
    String exchange = returnMessage.getExchange();
    String routingKey = returnMessage.getRoutingKey();
    byte[] body = returnMessage.getBody();

    log.warn("消息路由失败: exchange={}, routingKey={}, code={}, text={}",
        exchange, routingKey, code, text);

    // 处理路由失败的消息：重试、记录、告警
});
```

## 3. Return 回调参数

| 参数 | 说明 |
| :-- | :-- |
| replyCode | 错误码（312 = NO_ROUTE） |
| replyText | 错误描述 |
| exchange | 目标交换器 |
| routingKey | 路由 key |
| properties | 消息属性 |
| body | 消息体 |

## 4. 与 Alternate Exchange 的选择

| 场景 | 选择 |
| :-- | :-- |
| 生产者需要感知路由失败 | mandatory + Return |
| 统一兜底，生产者不关心 | Alternate Exchange |
| 两者都需要 | 同时配置 |

## 5. 最佳实践

- 核心业务消息使用 mandatory = true
- 注册 ReturnListener 处理路由失败
- 路由失败的消息记录到日志或数据库
- 配合告警及时发现路由配置问题
- 非核心消息可以不使用 mandatory
