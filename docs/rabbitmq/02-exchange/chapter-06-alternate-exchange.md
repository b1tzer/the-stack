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

生产环境也可以用 policy 配置 Alternate Exchange，它的好处是无需重新声明交换机即可独立调整配置。上面代码里的声明参数方式，适合在应用拓扑声明时就明确指定备用交换机，具体选哪种应结合现有拓扑管理方式决定。

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
| 告警 | 持续有消息进入 unrouted.queue 值得排查 routing 配置，也可能是业务主动发布了当前无消费者订阅的事件 |
| 重试/转发 | 消费者分析未路由原因，手动重新投递 |
| 兜底 | 所有未路由消息进入一个统一的处理 Queue |

## 5. 注意事项

- Alternate Exchange 本身也是一个普通的 Exchange，可以是任何类型
- 推荐用 Fanout 类型（不需要再做路由判断）
- Alternate Exchange 可以串联。消息在当前备用交换机仍无法路由时，可以继续进入其配置的 Alternate Exchange
- RabbitMQ 会检测循环路由，用于阻止循环备用交换机配置造成无限路由。若路由链最终没有任何队列接收消息，消息可能被丢弃
- 消息进入 Alternate Exchange 后，Publisher Confirm 仍会返回 ACK，但它只确认 Broker 已处理该次发布，不等于消息已路由到最终队列，也不等于业务消费者已处理。消息成功路由到 Alternate Exchange 时，Broker 会将其视为已路由，通常不会因原交换机没有匹配队列而触发 basic.return。mandatory 与 basic.return 能帮助发现最终仍无法路由的消息，但不能单独判断消息是否进入了备用队列。确认具体消息是否进入 unrouted.queue，应结合消息追踪或消费侧记录与队列监控
