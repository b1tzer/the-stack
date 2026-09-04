# 发布/订阅

> 发布/订阅（Pub/Sub）模式：一条消息被多个消费者各自消费，互不影响。

## 1. 模式说明

```txt
Producer ──▶ Fanout Exchange ──▶ Queue A ──▶ Consumer A
                              ──▶ Queue B ──▶ Consumer B
                              ──▶ Queue C ──▶ Consumer C
```

每个消费者有自己的 Queue，消息被广播到所有 Queue。每个消费者独立消费，互不影响。

## 2. 与竞争消费者的区别

| 维度 | 竞争消费者 | 发布/订阅 |
| :-- | :-- | :-- |
| 消费者数量 | 一条消息只被一个消费者处理 | 一条消息被所有消费者处理 |
| Queue | 所有消费者共享一个 Queue | 每个消费者有自己的 Queue |
| 用途 | 负载均衡 | 事件广播 |

## 3. 实现方式

```java
// 声明 Fanout Exchange
channel.exchangeDeclare("event.fanout", BuiltinExchangeType.FANOUT, true);

// 每个服务创建自己的 Queue 并绑定
channel.queueDeclare("sms.queue", true, false, false, null);
channel.queueBind("sms.queue", "event.fanout", "");

channel.queueDeclare("email.queue", true, false, false, null);
channel.queueBind("email.queue", "event.fanout", "");

channel.queueDeclare("push.queue", true, false, false, null);
channel.queueBind("push.queue", "event.fanout", "");

// 发送一条消息，三个服务都收到
channel.basicPublish("event.fanout", "", null, body);
```

## 4. 典型场景

- 用户注册后：发短信、发邮件、加积分、写日志
- 配置变更：所有服务清除本地缓存
- 订单状态变更：库存、物流、通知各自处理

## 5. 临时订阅

```java
// 客户端创建临时 Queue，断开自动删除
String tempQueue = channel.queueDeclare().getQueue();
channel.queueBind(tempQueue, "realtime.fanout", "");

channel.basicConsume(tempQueue, true, consumer);
```

适用于：实时通知、WebSocket 推送。
