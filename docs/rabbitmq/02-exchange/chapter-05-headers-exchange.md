# Headers Exchange

> Headers Exchange 根据消息的 headers 属性（而非 routing key）进行路由。适合复杂条件匹配。

## 1. 路由规则

```text
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

路由依据是消息的 `headers` 属性，而不是 routing key。

## 2. 匹配模式

| x-match | 含义 |
|---------|------|
| `all` | 所有 header 键值对都匹配（AND） |
| `any` | 任一 header 键值对匹配（OR） |

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

Headers Exchange 的匹配性能比 Direct/Topic 差（需要逐个比较 header 键值对），且配置更复杂。大多数场景用 Topic Exchange + 设计良好的 routing key 就能解决。

**替代方案**：如果只需要一两个维度，用 Topic Exchange 更简单。只有在需要多维度组合匹配时才考虑 Headers Exchange。
