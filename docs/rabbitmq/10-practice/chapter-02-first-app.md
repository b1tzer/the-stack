# 第一个 RabbitMQ 应用

> 用 Spring Boot + RabbitMQ 实现一个简单的生产消费。

## 1. 添加依赖

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-amqp</artifactId>
</dependency>
```

## 2. 配置

```yaml
spring:
  rabbitmq:
    host: localhost
    port: 5672
    username: admin
    password: admin123
    publisher-confirm-type: correlated
    publisher-returns: true
    listener:
      simple:
        acknowledge-mode: manual
        prefetch: 10
```

## 3. 声明队列和交换机

```java
@Configuration
public class RabbitConfig {
    @Bean
    public DirectExchange orderExchange() {
        return new DirectExchange("order.exchange");
    }

    @Bean
    public Queue orderQueue() {
        return QueueBuilder.durable("order.queue")
            .deadLetterExchange("dlx.exchange")
            .build();
    }

    @Bean
    public Binding orderBinding() {
        return BindingBuilder.bind(orderQueue())
            .to(orderExchange())
            .with("order.created");
    }
}
```

## 4. 生产者

```java
@Service
public class OrderProducer {
    private final RabbitTemplate rabbitTemplate;

    public void sendOrder(String orderId) {
        rabbitTemplate.convertAndSend("order.exchange", "order.created",
            orderId, message -> {
                message.getMessageProperties().setDeliveryMode(MessageDeliveryMode.PERSISTENT);
                return message;
            });
    }
}
```

## 5. 消费者

```java
@Component
public class OrderConsumer {
    @RabbitListener(queues = "order.queue")
    public void handleOrder(String orderId, Channel channel,
                            @Header(AmqpHeaders.DELIVERY_TAG) long tag) throws IOException {
        try {
            log.info("Processing order: {}", orderId);
            // 业务逻辑
            channel.basicAck(tag, false);
        } catch (Exception e) {
            channel.basicNack(tag, false, true); // 重新入队
        }
    }
}
```
