# 消息 TTL

> TTL（Time To Live）控制消息的存活时间。过期消息会被丢弃或路由到死信队列。

## 1. 两种 TTL 设置方式

### 1.1 队列级别 TTL

队列中所有消息统一过期时间：

```java
Map<String, Object> args = new HashMap<>();
args.put("x-message-ttl", 60000); // 60 秒
channel.queueDeclare("temp.queue", true, false, false, args);
```

### 1.2 消息级别 TTL

每条消息单独设置过期时间：

```java
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
    .expiration("30000") // 30 秒
    .build();
channel.basicPublish(exchange, routingKey, props, body);
```

## 2. TTL 优先级

- 消息级别 TTL 优先于队列级别 TTL
- 如果队列设置了 TTL，消息也设置了 TTL，取较小值

## 3. TTL 过期处理

```text
消息过期 ──▶ 队列头部检查 ──▶ 配置了死信交换器？
                                    │
                              是 → 路由到死信队列
                              否 → 丢弃
```

注意：过期消息不会立即被清理，而是在队列头部被访问时检查。

## 4. 延迟队列实现

利用 TTL + 死信实现延迟消息：

```text
Producer ──▶ delay.queue (TTL=30s) ──(过期)──▶ dlx.exchange ──▶ real.queue
```

```java
// 1. 创建延迟队列
Map<String, Object> delayArgs = new HashMap<>();
delayArgs.put("x-message-ttl", 30000);
delayArgs.put("x-dead-letter-exchange", "business.exchange");
delayArgs.put("x-dead-letter-routing-key", "order.timeout");
channel.queueDeclare("delay.order.timeout", true, false, false, delayArgs);

// 2. 发送延迟消息
channel.basicPublish("delay.exchange", "order.timeout", null, body);

// 3. 消息 30 秒后过期，进入 business.exchange -> order.timeout 队列
```

## 5. 延迟消息插件（推荐）

RabbitMQ 3.8+ 提供延迟消息插件，更优雅：

```bash
rabbitmq-plugins enable rabbitmq_delayed_message_exchange
```

```java
// 声明延迟交换器
Map<String, Object> args = new HashMap<>();
args.put("x-delayed-type", "direct");
channel.exchangeDeclare("delay.exchange", "x-delayed-message",
    true, false, false, args);

// 发送延迟消息
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
    .headers(Map.of("x-delay", 30000)) // 延迟 30 秒
    .build();
channel.basicPublish("delay.exchange", "order.timeout", props, body);
```

## 6. 最佳实践

- 临时消息（验证码、临时 token）设置 TTL
- 延迟消息优先使用延迟插件
- TTL + 死信实现的延迟队列，消息在队头才检查，有精度误差
- 避免在同一个队列混合使用不同 TTL 的消息
