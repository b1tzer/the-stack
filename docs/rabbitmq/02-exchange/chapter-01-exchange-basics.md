# Exchange 基础

> Exchange 是 RabbitMQ 的路由核心。Producer 不直接发消息到 Queue，而是发到 Exchange，由 Exchange 决定消息去哪。

## 1. 为什么需要 Exchange

如果 Producer 直接发到 Queue，那 Producer 必须知道目标 Queue 的名字。这意味着：

- Producer 和 Queue 强耦合
- 一条消息发给多个 Queue 时，Producer 要发多次
- 路由逻辑硬编码在 Producer 里

Exchange 的存在解耦了这个关系：

```txt
Producer ──▶ Exchange ──▶ Queue A
                      ──▶ Queue B
                      ──▶ Queue C
```

Producer 只需要知道 Exchange 名字和 routing key，不需要知道消息最终去哪个 Queue。路由逻辑由 Exchange + Binding 决定。

## 2. Exchange 的属性

| 属性 | 说明 | 默认值 |
| :-- | :-- | :-- |
| Name | Exchange 名称 | - |
| Type | 类型（direct/topic/fanout/headers） | - |
| Durable | 持久化（Broker 重启后保留） | false |
| Auto Delete | 最后一个绑定（来自 Queue 或 Exchange）解除后自动删除 | false |
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
| :-- | :-- | :-- | :-- |
| Direct | routing key 精确匹配 | `order.created` = `order.created` | 点对点、任务分发 |
| Topic | routing key 通配符匹配 | `order.*` 匹配 `order.created` | 事件订阅、分类路由 |
| Fanout | 忽略 routing key | 广播到所有绑定 Queue | 广播通知、实时推送 |
| Headers | 消息 headers 匹配 | 自定义 header 键值对 | 复杂条件路由 |

各类型的匹配规则与使用方式见 [Direct Exchange](./chapter-02-direct-exchange.md)、[Topic Exchange](./chapter-03-topic-exchange.md) 和 [Fanout Exchange](./chapter-04-fanout-exchange.md)。

## 6. 默认 Exchange

RabbitMQ 有一个内置的默认 Exchange（名字为空字符串 `""`），类型为 Direct。

它的特殊规则：**每个 Queue 自动以自己的名字作为 routing key 绑定到默认 Exchange**。

```java
// 先声明队列，确保目标队列存在
channel.queueDeclare("order.queue", true, false, false, null);

// 默认 Exchange：routing key 使用目标队列名称
channel.basicPublish("", "order.queue", null, body);
```

默认 Exchange 适合按队列名称直接做点对点投递。当需要一对多分发、复杂路由拓扑，或希望降低生产者对目标队列名称的依赖时，应声明专用 Exchange。

## 7. Dead Letter Exchange（DLX）

DLX 本身不是一种新的 Exchange 类型，而是把某个普通 Exchange 配置为死信消息的目标。消息在以下常见情况下会变成死信：被拒绝且不重新入队、TTL 到期、队列长度超限，或 Quorum Queue 的 delivery limit 超限：

```java
// 声明死信 Exchange
channel.exchangeDeclare("dlx.exchange", BuiltinExchangeType.DIRECT);

// 声明队列时指定 DLX
Map<String, Object> args = new HashMap<>();
args.put("x-dead-letter-exchange", "dlx.exchange");
args.put("x-dead-letter-routing-key", "dlx.order");
channel.queueDeclare("order.queue", true, false, false, args);
```

当队列配置了 DLX，且消息变成死信时，RabbitMQ 会将其重新发布到 DLX，由 DLX 按 routing key 路由到死信队列。TTL 与 DLX 组合可以实现延迟投递模式，结合不同目标队列与路由规则可以构建重试流程，但实际部署还需要考虑重复投递、重试次数与死循环等问题。死信转发的可靠性取决于队列类型与转发机制，不能仅凭配置了 DLX 就认定消息不会丢失。死信配置与转发机制详见[死信队列](../03-queue/chapter-06-dead-letter.md)。

## 8. Exchange 的内部实现

Exchange 本身不是独立进程，路由由 Broker 根据 Exchange 类型和 Binding 执行。当消息到达时：

```txt
1. Broker 收到 basic.publish(exchange, routingKey, body)
2. Exchange 根据类型与 Binding 执行路由匹配
3. 找到匹配的 Queue 列表
4. 将消息写入每个 Queue（可能是多个）
5. 返回
```

以上是概念流程，省略了队列内部处理与确认细节。路由匹配在内存中的索引结构上完成，Direct Exchange 的精确匹配与 Topic Exchange 的通配符匹配成本不同。路由匹配成本取决于 Binding 的数量与分布以及匹配结果数量，不能仅凭使用内存索引就断言为 O(1)。消息投递后队列的处理能力影响的是端到端吞吐与延迟，与路由匹配本身是不同层面。

路由匹配只是找到目标队列，并不代表消息已成功写入并持久化，也不代表生产者已收到确认。消息写入队列、持久化、Publisher Confirm 是彼此相关但不同的环节，确认时机取决于路由结果、目标队列类型及其持久化要求。
