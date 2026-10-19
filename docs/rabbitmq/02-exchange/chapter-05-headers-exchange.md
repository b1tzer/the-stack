# Headers Exchange

> Headers Exchange 根据消息的 headers 属性（而非 routing key）进行路由。适合复杂条件匹配。

## 1. 路由规则

```txt
Producer ──headers: {format=pdf, type=report}──▶ Headers Exchange
                                                      │
                                              ┌───────┼───────┐
                                              ▼               ▼
                                         Queue A          Queue B
                                    (bind:              (bind:
                                    x-match=all,        x-match=any,
                                    format=pdf,         format=pdf,
                                    type=report)        lang=en)
```

消息是否路由到某个队列，取决于其 headers 是否满足该队列绑定时声明的匹配条件，而不是 routing key。

## 2. 匹配模式

| x-match | 含义 |
| :-- | :-- |
| `all` | 绑定中所有参与匹配的 header 条件均满足（AND） |
| `any` | 绑定中至少一个参与匹配的 header 条件满足（OR） |
| `all-with-x` | 同 `all`，但把以 `x-` 开头的匹配项也纳入匹配（RabbitMQ 3.7.0+） |
| `any-with-x` | 同 `any`，但把以 `x-` 开头的匹配项也纳入匹配（RabbitMQ 3.7.0+） |

`x-match` 是绑定参数中的控制字段，其余键值对才是参与匹配的条件。匹配时，绑定参数中的 header 值与消息对应 header 的值比较，类型也参与比较，例如整数 `1` 与字符串 `"1"` 不相等。在 `all`/`any` 模式下，绑定参数中以 `x-` 开头的匹配项（如 `x-trace-id`）不参与匹配，避免追踪类 header 干扰路由。

```java
// 声明 Headers Exchange
channel.exchangeDeclare("report.exchange", BuiltinExchangeType.HEADERS, true);

// 绑定：要求 format=pdf AND type=report
Map<String, Object> bindArgs = new HashMap<>();
bindArgs.put("x-match", "all");
bindArgs.put("format", "pdf");
bindArgs.put("type", "report");
channel.queueBind("pdf-report.queue", "report.exchange", "", bindArgs);

// 绑定：只要 format=pdf 或 lang=en 就匹配
Map<String, Object> bindArgs2 = new HashMap<>();
bindArgs2.put("x-match", "any");
bindArgs2.put("format", "pdf");
bindArgs2.put("lang", "en");
channel.queueBind("loose-match.queue", "report.exchange", "", bindArgs2);
```

## 3. 发送消息

```java
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
    .headers(Map.of("format", "pdf", "type", "report", "lang", "zh"))
    .build();

channel.basicPublish("report.exchange", "", props, body);
// 注意：routing key 在 Headers Exchange 中无意义，传空字符串
```

## 4. 适用场景

- 需要根据多个维度路由（格式、语言、类型等）
- routing key 不够表达的复杂条件
- 消息本身就是按属性分类的

## 5. 为什么少用

Headers Exchange 支持多个 header 的 AND/OR 匹配，但规则配置和排查比简单的 routing key 路由更复杂。实际路由开销取决于绑定条件数量、匹配规则与消息属性，性能敏感场景应在目标负载下基准测试。大多数能用简单 routing key 表达的场景，优先考虑 [Topic Exchange](./chapter-03-topic-exchange.md)。

**替代方案**：需要精确匹配 routing key 时优先考虑 Direct Exchange，需要 `*`/`#` 模式匹配时考虑 Topic Exchange，只有需要按多个 header 条件组合匹配时才考虑 Headers Exchange。
