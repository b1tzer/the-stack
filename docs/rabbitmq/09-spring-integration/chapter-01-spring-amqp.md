# Spring AMQP

> Spring AMQP 是 Spring 对 RabbitMQ 的封装，提供 `RabbitTemplate`、`@RabbitListener` 等高级抽象。

## 1. 依赖配置

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-amqp</artifactId>
</dependency>
```

## 2. application.yml

```yaml
spring:
  rabbitmq:
    host: localhost
    port: 5672
    username: admin
    password: admin
    virtual-host: /
    # 生产者确认
    publisher-confirm-type: correlated
    publisher-returns: true
    # 消费者配置
    listener:
      simple:
        acknowledge-mode: manual
        prefetch: 10
        concurrency: 5
        max-concurrency: 20
```

## 3. RabbitTemplate

### 3.1 发送消息

```java
@Autowired
private RabbitTemplate rabbitTemplate;

// 简单发送
rabbitTemplate.convertAndSend("order.exchange", "order.created", order);

// 带属性发送
rabbitTemplate.convertAndSend("order.exchange", "order.created", order, message -> {
    message.getMessageProperties().setDeliveryMode(MessageDeliveryMode.PERSISTENT);
    message.getMessageProperties().setExpiration("60000");
    return message;
});
```

### 3.2 发送确认

```java
@Bean
public RabbitTemplate.ConfirmCallback confirmCallback() {
    return (correlationData, ack, cause) -> {
        if (!ack) {
            log.error("消息发送失败: {}", cause);
        }
    };
}

@Bean
public RabbitTemplate.ReturnCallback returnCallback() {
    return (message, replyCode, replyText, exchange, routingKey) -> {
        log.error("消息路由失败: exchange={}, routingKey={}", exchange, routingKey);
    };
}

@PostConstruct
public void init() {
    rabbitTemplate.setConfirmCallback(confirmCallback());
    rabbitTemplate.setReturnCallback(returnCallback());
    rabbitTemplate.setMandatory(true);
}
```

## 4. @RabbitListener

### 4.1 简单消费

```java
@RabbitListener(queues = "order.queue")
public void handleOrder(Message message, Channel channel) throws IOException {
    String body = new String(message.getBody());
    log.info("收到消息: {}", body);

    // 手动 ACK
    channel.basicAck(message.getMessageProperties().getDeliveryTag(), false);
}
```

### 4.2 带异常处理

```java
@RabbitListener(queues = "order.queue")
public void handleOrder(Message message, Channel channel) throws IOException {
    try {
        Order order = objectMapper.readValue(message.getBody(), Order.class);
        processOrder(order);
        channel.basicAck(message.getMessageProperties().getDeliveryTag(), false);
    } catch (Exception e) {
        log.error("处理消息失败", e);
        // nack，不重新入队（进入死信）
        channel.basicNack(message.getMessageProperties().getDeliveryTag(), false, false);
    }
}
```

### 4.3 动态队列

```java
@RabbitListener(bindings = @QueueBinding(
    value = @Queue(value = "order.queue", durable = "true"),
    exchange = @Exchange(value = "order.exchange", type = ExchangeTypes.TOPIC),
    routingKey = "order.*"
))
public void handleOrder(Message message, Channel channel) {
    // ...
}
```

## 5. 消息转换器

```java
@Bean
public MessageConverter jsonMessageConverter() {
    return new Jackson2JsonMessageConverter();
}

@Bean
public RabbitTemplate rabbitTemplate(ConnectionFactory connectionFactory) {
    RabbitTemplate template = new RabbitTemplate(connectionFactory);
    template.setMessageConverter(jsonMessageConverter());
    return template;
}
```
