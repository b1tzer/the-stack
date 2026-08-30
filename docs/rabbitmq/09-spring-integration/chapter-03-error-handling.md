# 错误处理与重试

> Spring AMQP 提供了完善的错误处理和重试机制，避免消息丢失或无限循环。

## 1. 错误处理策略

### 1.1 RejectAndDontRequeueRecoverer

```java
@Bean
public MessageRecoverer messageRecoverer() {
    return new RejectAndDontRequeueRecoverer(); // 直接拒绝，进入死信
}
```

### 1.2 RepublishMessageRecoverer

```java
@Bean
public MessageRecoverer messageRecoverer(RabbitTemplate rabbitTemplate) {
    return new RepublishMessageRecoverer(rabbitTemplate,
        "dlx.exchange", "dlx.order"); // 重新发布到死信
}
```

### 1.3 自定义 Recoverer

```java
@Bean
public MessageRecoverer messageRecoverer() {
    return (message, cause) -> {
        log.error("消息处理失败: {}", new String(message.getBody()), cause);
        // 记录到数据库
        failedMessageRepository.save(message, cause);
    };
}
```

## 2. Spring Retry

### 2.1 配置重试

```yaml
spring:
  rabbitmq:
    listener:
      simple:
        retry:
          enabled: true
          initial-interval: 1000      # 首次重试间隔
          max-attempts: 3             # 最大重试次数
          multiplier: 2.0             # 间隔倍数
          max-interval: 10000         # 最大间隔
          stateless: true             # 无状态重试
```

### 2.2 代码配置

```java
@Bean
public RetryInterceptor retryInterceptor() {
    return RetryInterceptorBuilder.stateless()
        .maxAttempts(3)
        .backOffOptions(1000, 2.0, 10000)
        .recoverer(new RejectAndDontRequeueRecoverer())
        .build();
}
```

## 3. 手动 ACK 下的错误处理

```java
@RabbitListener(queues = "order.queue")
public void handleOrder(Message message, Channel channel) throws IOException {
    long deliveryTag = message.getMessageProperties().getDeliveryTag();

    try {
        Order order = objectMapper.readValue(message.getBody(), Order.class);
        processOrder(order);
        channel.basicAck(deliveryTag, false);
    } catch (BusinessException e) {
        // 业务异常，不重试，直接进死信
        log.error("业务处理失败", e);
        channel.basicNack(deliveryTag, false, false);
    } catch (Exception e) {
        // 系统异常，重试
        log.error("系统异常", e);
        channel.basicNack(deliveryTag, false, true); // requeue
    }
}
```

## 4. 重试次数控制

```java
@RabbitListener(queues = "order.queue")
public void handleOrder(Message message, Channel channel) throws IOException {
    Map<String, Object> headers = message.getMessageProperties().getHeaders();
    int retryCount = (int) headers.getOrDefault("x-retry-count", 0);

    if (retryCount >= 3) {
        // 超过重试次数，进入死信
        channel.basicNack(message.getMessageProperties().getDeliveryTag(), false, false);
        return;
    }

    try {
        processMessage(message);
        channel.basicAck(message.getMessageProperties().getDeliveryTag(), false);
    } catch (Exception e) {
        // 增加重试计数，重新发布
        MessageProperties props = message.getMessageProperties();
        props.setHeader("x-retry-count", retryCount + 1);
        channel.basicPublish(
            props.getReceivedExchange(),
            props.getReceivedRoutingKey(),
            props,
            message.getBody()
        );
        channel.basicAck(message.getMessageProperties().getDeliveryTag(), false);
    }
}
```

## 5. 最佳实践

- 使用手动 ACK，不要依赖自动 ACK
- 区分业务异常和系统异常
- 设置合理的重试次数（3~5 次）
- 重试间隔使用指数退避
- 超过重试次数的消息进入死信队列
- 定期监控死信队列
