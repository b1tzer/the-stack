# Headers Exchange

> Headers Exchange 基于消息的 headers 属性进行匹配，不依赖 routing key。它适合需要多维度匹配的复杂路由场景。

## 1. 匹配规则

匹配在 `x-match` 参数控制下进行：

| x-match | 说明 |
| :-- | :-- |
| all | 所有 header 键值对都匹配（AND） |
| any | 任意一个 header 键值对匹配（OR） |

## 2. 示例

```java
// 声明绑定
Map<String, Object> bindingArgs = new HashMap<>();
bindingArgs.put("x-match", "all");     // AND 模式
bindingArgs.put("format", "pdf");
bindingArgs.put("type", "report");
channel.queueBind(queueName, exchangeName, "", bindingArgs);

// 发送消息
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
    .headers(Map.of("format", "pdf", "type", "report", "priority", "high"))
    .build();
channel.basicPublish(exchangeName, "", props, body);
```

## 3. 典型场景

### 3.1 多维度过滤

```text
Headers Exchange
  ├── x-match=all, format=pdf, type=report ──▶ pdf-report-queue
  ├── x-match=any, format=pdf, format=doc  ──▶ document-queue
  └── x-match=all, priority=high            ──▶ high-priority-queue
```

### 3.2 消息分类

```text
notification.headers (headers)
  ├── x-match=all, channel=email, urgent=true  ──▶ urgent-email-queue
  ├── x-match=any, channel=sms                 ──▶ sms-queue
  └── x-match=all, channel=push, platform=ios  ──▶ ios-push-queue
```

## 4. 性能与使用建议

- Headers 匹配比 routing key 匹配慢
- 大部分场景 Topic Exchange 就够用
- 只在需要非字符串维度匹配时使用 Headers
- 避免在 headers 中放入大量键值对
