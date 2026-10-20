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
    listener:
      simple:
        acknowledge-mode: manual
        prefetch: 10
```

这里只保留最小连接配置和消费者手动确认。发布确认与不可路由消息的退回处理是可靠发布才需要的机制，本例不启用，见[发布确认](../04-producer/chapter-02-publisher-confirm.md)。

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
        return QueueBuilder.durable("order.queue").build();
    }

    @Bean
    public Binding orderBinding() {
        return BindingBuilder.bind(orderQueue())
            .to(orderExchange())
            .with("order.created");
    }
}
```

失败消息的死信处理不在入门示例展开，见[死信队列](../03-queue/chapter-06-dead-letter.md)。

## 4. 生产者

```java
@Service
@RequiredArgsConstructor
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
@Slf4j
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
            // 最简演示，统一重新入队。生产代码应区分临时错误与永久错误，
            // 永久错误应 requeue=false 并配合死信队列，否则会无限重试。
            channel.basicNack(tag, false, true);
        }
    }
}
```

手动确认与重试边界的完整说明见[ACK 机制](../05-consumer/chapter-02-ack-mechanism.md)。
