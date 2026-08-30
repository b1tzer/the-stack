# 生产者基础

> 生产者是消息的源头。理解消息的发送方式、属性设置和路由语义，是保证消息可靠投递的第一步。

## 1. 发送消息

```java
channel.basicPublish(
    "order.exchange",        // 交换器名
    "order.created",         // routing key
    false,                   // mandatory
    MessageProperties.PERSISTENT_TEXT_PLAIN, // 属性
    "hello world".getBytes() // 消息体
);
```

## 2. 消息属性

| 属性 | 说明 |
| :-- | :-- |
| deliveryMode | 1=非持久化，2=持久化 |
| contentType | 消息类型，如 application/json |
| contentEncoding | 编码，如 UTF-8 |
| correlationId | 关联 ID，用于 RPC |
| replyTo | 回复队列，用于 RPC |
| expiration | 消息 TTL（毫秒） |
| messageId | 消息唯一 ID |
| timestamp | 消息时间戳 |
| userId | 用户 ID |
| appId | 应用标识 |
| headers | 自定义头部（Map） |

## 3. 消息体格式

```java
// JSON 格式（推荐）
ObjectMapper mapper = new ObjectMapper();
byte[] body = mapper.writeValueAsBytes(orderEvent);

AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
    .contentType("application/json")
    .contentEncoding("UTF-8")
    .deliveryMode(2)
    .build();
```

## 4. Routing Key 设计

| 风格 | 示例 | 适用场景 |
| :-- | :-- | :-- |
| 点分隔 | `order.created` | 事件通知 |
| 多级 | `order.item.created` | 复杂分类 |
| 通配符 | `order.*`、`#` | Topic 交换器 |

命名规范建议：

- 全小写
- 用 `.` 分隔
- `实体.动作` 格式
- 避免过深嵌套（不超过 5 级）

## 5. 发送确认

未使用 Publisher Confirm 时，消息发送是"fire and forget"：

```java
// 危险：不知道消息是否到达 broker
channel.basicPublish(exchange, routingKey, null, body);
```

必须配合 Publisher Confirm 使用（见后续章节）。
