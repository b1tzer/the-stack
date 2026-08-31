# Exchange 基础

> Exchange 是 RabbitMQ 的路由核心。Producer 不直接发消息到 Queue，而是发到 Exchange，由 Exchange 决定消息去哪。

## 1. 为什么需要 Exchange

如果 Producer 直接发到 Queue，那 Producer 必须知道目标 Queue 的名字。这意味着：

- Producer 和 Queue 强耦合
- 一条消息发给多个 Queue 时，Producer 要发多次
- 路由逻辑硬编码在 Producer 里

Exchange 的存在解耦了这个关系：

```text
Producer ──▶ Exchange ──▶ Queue A
                      ──▶ Queue B
                      ──▶ Queue C
```

Producer 只需要知道 Exchange 名字和 routing key，不需要知道消息最终去哪个 Queue。路由逻辑由 Exchange + Binding 决定。

## 2. Exchange 的属性

| 属性 | 说明 | 默认值 |
|------|------|--------|
| Name | Exchange 名称 | - |
| Type | 类型（direct/topic/fanout/headers） | - |
| Durable | 持久化（Broker 重启后保留） | false |
| Auto Delete | 所有绑定 Queue 解绑后自动删除 | false |
| Internal | 是否为内部 Exchange（不接受 Producer 直接发送） | false |

## 3. 声明 Exchange

```java
// 声明一个持久化的 Direct Exchange
channel.exchangeDeclare(
    "order.exchange",     // 名称
    BuiltinExchangeType.DIRECT,  // 类型
    true                  // 持久化
);
```

**幂等性**：多次声明相同名称、相同属性的 Exchange 不会报错。但属性不同会报 `406 PRECONDITION_FAILED`。

## 4. Binding：Exchange 和 Queue 的桥梁

Binding 是 Exchange 和 Queue 之间的"路由规则"：

```java
// 将 order.queue 绑定到 order.exchange，routing key 为 "order.created"
channel.queueBind("order.queue", "order.exchange", "order.created");
```

一个 Queue 可以绑定到多个 Exchange，一个 Exchange 可以绑定多个 Queue。Binding 是多对多的关系。

## 5. 四种 Exchange 类型概览

| 类型 | 路由规则 | 匹配方式 | 典型场景 |
|------|----------|----------|----------|
| Direct | routing key 精确匹配 | `order.created` = `order.created` | 点对点、任务分发 |
| Topic | routing key 通配符匹配 | `order.*` 匹配 `order.created` | 事件订阅、分类路由 |
| Fanout | 忽略 routing key | 广播到所有绑定 Queue | 广播通知、实时推送 |
| Headers | 消息 headers 匹配 | 自定义 header 键值对 | 复杂条件路由 |

## 6. 默认 Exchange

RabbitMQ 有一个内置的默认 Exchange（名字为空字符串 `""`），类型为 Direct。

它的特殊规则：**每个 Queue 自动以自己的名字作为 routing key 绑定到默认 Exchange**。

```java
// 这两行等效：
channel.basicPublish("", "order.queue", null, body);
channel.queueDeclare("order.queue", ...);
channel.basicPublish("", "order.queue", null, body);  // 直接按 Queue 名路由
```

这个设计让初学者可以不声明 Exchange 就能发消息，但生产环境不建议使用默认 Exchange。

## 7. Dead Letter Exchange（DLX）

DLX 是一种特殊的 Exchange，用于处理"死信"（被拒绝、过期、或超长的消息）：

```java
// 声明死信 Exchange
channel.exchangeDeclare("dlx.exchange", BuiltinExchangeType.DIRECT);

// 声明队列时指定 DLX
Map<String, Object> args = new HashMap<>();
args.put("x-dead-letter-exchange", "dlx.exchange");
args.put("x-dead-letter-routing-key", "dlx.order");
channel.queueDeclare("order.queue", true, false, false, args);
```

当消息变成死信时，RabbitMQ 会自动将其重新发布到 DLX，由 DLX 路由到死信队列。这是实现延迟队列、重试机制的基础。

## 8. Exchange 的内部实现

每个 Exchange 是一个 Erlang 进程。当消息到达时：

```text
1. Broker 收到 basic.publish(exchange, routingKey, body)
2. 找到 Exchange 进程
3. Exchange 查询 binding 表（ETS 表，O(1) 查找）
4. 找到匹配的 Queue 列表
5. 将消息写入每个 Queue（可能是多个）
6. 返回
```

**性能关键**：binding 表存储在 ETS 中，查找是 O(1) 的。即使有几千个 binding，路由性能也不会下降。
