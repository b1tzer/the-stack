# Exchange 基础

> Exchange 是 RabbitMQ 消息路由的核心。生产者不直接把消息发给队列，而是发给 Exchange，由 Exchange 决定消息去向。

## 1. Exchange 的本质

```text
Producer ──▶ Exchange ──Binding──▶ Queue 1
                         Binding──▶ Queue 2
                         (无匹配) ──▶ /dev/null
```

Exchange 的职责：

- 接收生产者发送的消息
- 根据类型和路由规则将消息分发到队列
- 消息无法路由时的处理（return / drop / alternate exchange）

## 2. Exchange 属性

| 属性 | 说明 |
| :-- | :-- |
| Name | 交换器名称，"" 是默认交换器 |
| Type | direct / topic / fanout / headers |
| Durable | 持久化，broker 重启后保留 |
| Auto Delete | 所有绑定队列解绑后自动删除 |
| Internal | 内部交换器，不接受生产者直接发送 |
| Alternate Exchange | 备用交换器，接收路由失败的消息 |

## 3. 声明 Exchange

```java
channel.exchangeDeclare(
    "order.exchange",     // 名称
    BuiltinExchangeType.TOPIC, // 类型
    true,                 // 持久化
    false,                // 不自动删除
    false,                // 非内部
    null                  // 参数
);
```

幂等性：多次声明相同名称、相同属性的 Exchange 不会报错。但如果属性不同，会抛出 406 PRECONDITION_FAILED。

## 4. 默认交换器

名称为空字符串 `""` 的默认交换器是 direct 类型：

- 每个 Queue 自动以队列名作为 routing key 绑定到默认交换器
- 发送到默认交换器的消息，routing key 等于队列名就会路由到该队列
- 这是最简单的"点对点"模式

```text
Producer ──▶ "" (default direct) ──▶ Queue "order.created"
                                     (routing key = "order.created")
```

## 5. 系统交换器

RabbitMQ 内部使用的交换器：

| 交换器 | 类型 | 说明 |
| :-- | :-- | :-- |
| amq.direct | direct | 内置 direct |
| amq.topic | topic | 内置 topic |
| amq.fanout | fanout | 内置 fanout |
| amq.headers | headers | 内置 headers |
| amq.match | headers | 兼容旧版 |

这些交换器默认存在，持久化，可以直接使用。
