# 消息集成

> 微服务之间需要异步通信，Kafka 和 RabbitMQ 是主流选择。本章从集成配置到高级用法（事务消息、死信队列、延迟消息、幂等消费），覆盖消息可靠性的全链路。

## 1. Kafka 集成

### 1.1 基础配置

```yaml
spring:
  kafka:
    bootstrap-servers: localhost:9092
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
      acks: all
      retries: 3
    consumer:
      group-id: order-service
      auto-offset-reset: earliest
      enable-auto-commit: false  # 生产环境务必关闭自动提交
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.springframework.kafka.support.serializer.JsonDeserializer
      properties:
        spring.json.trusted.packages: "com.example.dto"
```

### 1.2 生产者

```java
@Service
public class OrderProducer {

    private final KafkaTemplate<String, OrderEvent> kafkaTemplate;

    public OrderProducer(KafkaTemplate<String, OrderEvent> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    public void sendOrderCreated(OrderEvent event) {
        kafkaTemplate.send("order-events", event.getOrderId().toString(), event)
                .addCallback(
                    result -> System.out.println("发送成功: " + result.getRecordMetadata()),
                    ex -> System.err.println("发送失败: " + ex.getMessage())
                );
    }
}
```

### 1.3 消费者

```java
@Component
public class OrderConsumer {

    @KafkaListener(topics = "order-events", groupId = "payment-service")
    public void handleOrderCreated(
            @Payload OrderEvent event,
            @Header(KafkaHeaders.RECEIVED_PARTITION) int partition,
            @Header(KafkaHeaders.OFFSET) long offset,
            Acknowledgment acknowledgment) {
        try {
            System.out.println("收到消息: partition=" + partition + ", offset=" + offset);
            // 处理业务...
            acknowledgment.acknowledge();  // 手动确认
        } catch (Exception e) {
            throw e;  // 不 ack，消息会被重新投递
        }
    }
}
```

消费者组与分区策略：

| 概念 | 说明 |
|------|------|
| 消费者组（Group） | 同组内的消费者分摊消费，不同组各自消费全量 |
| 分区分配 | 一个分区只能被同组内的一个消费者消费 |
| 分区数 ≥ 消费者数 | 多余的消费者会空闲 |
| Rebalance | 消费者加入/退出时自动重新分配分区 |

> **踩坑提醒**：`spring.kafka.consumer.auto-commit-enable=true`（默认）在消息处理失败时会丢失消息。生产环境务必设置 `enable-auto-commit: false`，手动 `acknowledge()`。

### 1.4 事务消息

```java
@Service
public class OrderEventPublisher {

    @Autowired
    private KafkaTemplate<String, Object> kafkaTemplate;

    // 事务消息：数据库操作和消息发送在同一事务中
    @Transactional
    public void createOrderAndPublish(OrderRequest request) {
        // 1. 保存订单到数据库
        Order order = orderRepository.save(new Order(request));

        // 2. 发送 Kafka 消息（与数据库在同一事务中）
        kafkaTemplate.send("order-events", order.getId().toString(),
            new OrderCreatedEvent(order.getId(), order.getUserId(), order.getAmount()));
    }
}
```

### 1.5 消费者幂等

```java
@Component
public class OrderEventListener {

    @KafkaListener(topics = "order-events", groupId = "notification-group")
    public void handleOrderEvent(String message,
            @Header(KafkaHeaders.RECEIVED_KEY) String key,
            @Header(KafkaHeaders.OFFSET) long offset) {

        String messageId = key + ":" + offset;
        if (processedMessageRepository.existsById(messageId)) {
            log.info("消息已处理，跳过: {}", messageId);
            return;
        }

        try {
            OrderCreatedEvent event = objectMapper.readValue(message, OrderCreatedEvent.class);
            notificationService.sendOrderConfirmation(event);
            processedMessageRepository.save(new ProcessedMessage(messageId));
        } catch (Exception e) {
            log.error("消息处理失败: {}", messageId, e);
            kafkaTemplate.send("order-events-dlq", key, message);
        }
    }
}
```

## 2. RabbitMQ 集成

### 2.1 基础配置

```java
@Configuration
public class RabbitConfig {

    @Bean
    public Queue queue() {
        return new Queue("my-queue");
    }

    @Bean
    public DirectExchange exchange() {
        return new DirectExchange("my-exchange");
    }

    @Bean
    public Binding binding(Queue queue, DirectExchange exchange) {
        return BindingBuilder.bind(queue).to(exchange).with("routing-key");
    }
}
```

### 2.2 死信队列

```java
@Configuration
public class RabbitDlqConfig {

    // 死信交换机
    @Bean
    public DirectExchange deadLetterExchange() {
        return new DirectExchange("dlx.exchange");
    }

    // 死信队列
    @Bean
    public Queue deadLetterQueue() {
        return QueueBuilder.durable("dlx.queue").build();
    }

    @Bean
    public Binding deadLetterBinding() {
        return BindingBuilder.bind(deadLetterQueue())
                .to(deadLetterExchange())
                .with("dlx.routing-key");
    }

    // 业务队列（绑定死信交换机）
    @Bean
    public Queue orderQueue() {
        return QueueBuilder.durable("order.queue")
                .withArgument("x-dead-letter-exchange", "dlx.exchange")
                .withArgument("x-dead-letter-routing-key", "dlx.routing-key")
                .withArgument("x-message-ttl", 30000)  // 30 秒 TTL
                .build();
    }
}
```

### 2.3 延迟消息

```java
@Service
public class OrderProducer {

    private final RabbitTemplate rabbitTemplate;

    public OrderProducer(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    // 发送延迟消息（利用 TTL + 死信队列实现延迟）
    public void sendDelayedCloseOrder(Long orderId, long delayMs) {
        rabbitTemplate.convertAndSend("order.delay.exchange", "order.delay.routing-key",
                orderId, message -> {
                    message.getMessageProperties().setExpiration(String.valueOf(delayMs));
                    return message;
                });
    }
}

// 消费者
@Component
public class OrderConsumer {

    @RabbitListener(queues = "order.queue")
    public void handleOrderMessage(Long orderId, Channel channel,
                                    @Header(AmqpHeaders.DELIVERY_TAG) long tag) {
        try {
            System.out.println("处理订单: " + orderId);
            channel.basicAck(tag, false);
        } catch (Exception e) {
            try {
                channel.basicNack(tag, false, false);  // 拒绝，进入死信队列
            } catch (IOException ex) {
                ex.printStackTrace();
            }
        }
    }
}
```

延迟消息方案对比：

| 方案 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| TTL + 死信队列 | 消息在队列中超时后转入死信 | 原生支持 | 每个延迟时间需建队列 |
| rabbitmq-delayed-message-exchange 插件 | 交换机级别延迟 | 灵活 | 需安装插件 |
| 延迟消息表 + 定时扫描 | 数据库存消息，定时捞 | 无额外依赖 | 实时性差 |

> **踩坑提醒**：TTL + 死信队列方案中，消息是在**队列头部**开始计算 TTL 的。如果队首消息 TTL=30s，第二条 TTL=5s，第二条也要等第一条过期才能被处理。插件方案没有这个问题。

## 3. 消息可靠性保证

**全链路可靠性保证**：

```
生产者 ──确认──► Broker ──持久化──► 存储 ──ACK──► 消费者 ──幂等──► 业务
  ①              ②                    ③              ④
```

| 环节 | 风险 | 保障措施 |
|------|------|---------|
| 生产者 | 网络抖动、Broker 宕机 | 开启 Producer ACK / Confirm |
| Broker | 机器宕机 | 多副本 + 持久化 |
| 消费者 | 处理失败 | 手动 ACK + 重试 |
| 业务 | 重复消费 | 幂等设计（唯一键/状态机） |

```java
// ① 生产者确认（Kafka）
// application.yml
// spring.kafka.producer.acks: all
// spring.kafka.producer.retries: 3

// ② Broker 持久化（Kafka）
// topic 配置: replication.factor=3, min.insync.replicas=2

// ③ 消费者手动 ACK
@KafkaListener(topics = "order-events")
public void consume(OrderEvent event, Acknowledgment ack) {
    try {
        processEvent(event);
        ack.acknowledge();
    } catch (Exception e) {
        throw e;  // 不 ack，消息会被重新投递
    }
}

// ④ 幂等消费
@Service
public class IdempotentConsumer {

    private final RedisTemplate<String, String> redisTemplate;

    public boolean processIfNotDuplicate(String messageId, Runnable action) {
        String key = "processed:" + messageId;
        Boolean isNew = redisTemplate.opsForValue()
                .setIfAbsent(key, "1", 24, TimeUnit.HOURS);
        if (Boolean.TRUE.equals(isNew)) {
            action.run();
            return true;
        }
        System.out.println("重复消息，跳过: " + messageId);
        return false;
    }
}
```

> **经验法则**：消息可靠性 = 生产者确认 + Broker 持久化 + 消费者手动 ACK + 业务幂等。四个环节缺一不可。

## 4. Spring Cloud Stream

```java
// 声明式消息发送
public interface OrderEventSource {

    @Output("order-created")
    MessageChannel orderCreated();

    @Output("order-cancelled")
    MessageChannel orderCancelled();
}

// 声明式消息消费
public interface OrderEventSink {

    @Input("order-created")
    SubscribableChannel orderCreated();
}

// 使用
@EnableBinding({OrderEventSource.class, OrderEventSink.class})
public class OrderEventHandler {

    @Autowired
    private OrderEventSource source;

    public void publishOrderCreated(Order order) {
        source.orderCreated().send(
            MessageBuilder.withPayload(order)
                .setHeader("contentType", "application/json")
                .build());
    }

    @StreamListener("order-created")
    public void handleOrderCreated(Order order) {
        // 处理订单创建事件
    }
}
```

## 5. 最佳实践

1. **消息设计为不可变**——消息一旦发送就不应修改
2. **消费者必须幂等**——网络抖动可能导致重复消费
3. **死信队列必须有**——消费失败的消息要有归宿
4. **消息体不要太大**——超过 1MB 考虑传 ID，消费方按需查询
5. **监控消息积压**——消费 Lag 超过阈值要及时告警
6. **手动 ACK**——不要用自动提交，处理失败时消息会丢失
7. **超时与重试**——消费失败时指数退避重试，超过次数进死信队列
8. **序列化用 JSON**——不要用 Java 原生序列化，跨语言不兼容
