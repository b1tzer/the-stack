# Alternate Exchange

> Alternate Exchange 解决了一个尴尬的问题：消息路由不到任何 Queue 时去哪？

## 1. 问题场景

```txt
Producer ──routing key="order.refunded"──▶ Direct Exchange
                                               │
                                    binding: order.created → Queue A
                                    binding: order.paid → Queue B
                                    没有 binding: order.refunded！
                                    
                                    → 消息被丢弃，Producer 不知道
```

默认行为：消息路由不到任何 Queue 时，**静默丢弃**。没有报错，没有通知。

## 2. Alternate Exchange 的作用

```java
// 声明 Exchange 时指定 Alternate Exchange
Map<String, Object> args = new HashMap<>();
args.put("alternate-exchange", "ae.unrouted");
channel.exchangeDeclare("order.exchange", BuiltinExchangeType.DIRECT, true, false, args);

// 声明 Alternate Exchange（通常用 Fanout）
channel.exchangeDeclare("ae.unrouted", BuiltinExchangeType.FANOUT, true);
channel.queueDeclare("unrouted.queue", true, false, false, null);
channel.queueBind("unrouted.queue", "ae.unrouted", "");
```

当消息路由不到任何 Queue 时，自动转发到 Alternate Exchange。

## 3. 工作流程

```txt
Producer ──▶ order.exchange ──routing success──▶ Queue A
                │
                └──routing failed──▶ ae.unrouted (Fanout) ──▶ unrouted.queue
```

## 4. 典型场景

| 场景 | 处理方式 |
| :-- | :-- |
| 记录未路由消息 | unrouted.queue 的消费者记录日志 |
| 告警 | 持续有消息进入 unrouted.queue 说明 routing 配置有问题 |
| 重试/转发 | 消费者分析未路由原因，手动重新投递 |
| 兜底 | 所有未路由消息进入一个统一的处理 Queue |

## 5. 注意事项

- Alternate Exchange 本身也是一个普通的 Exchange，可以是任何类型
- 推荐用 Fanout 类型（不需要再做路由判断）
- Alternate Exchange 的未路由消息不会再次触发 Alternate Exchange（避免死循环）
- 消息进入 Alternate Exchange 后，Publisher Confirm 仍然会返回（消息已被 Broker 接收）
