# 消息集成

> 微服务之间需要异步通信，Kafka 和 RabbitMQ 是主流选择。本章聚焦可靠收发，底层存储与分布式事务的完整方案见对应专题。

消息从发出到被业务处理，经过四个环节，任一环出问题都会丢消息或重复消费：

```text
生产者 ──确认──► Broker ──持久化──► 存储 ──ACK──► 消费者 ──幂等──► 业务
  ①              ②                    ③              ④
```

本文按这四环节组织 Kafka 与 RabbitMQ 的配置与代码。

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
    listener:
      ack-mode: manual  # 手动确认，配合 Acknowledgment 使用
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

> **踩坑提醒**：`enable-auto-commit` 与 `ack-mode` 是两个概念。`enable-auto-commit: false` 只是关闭 offset 的周期自动提交，不会自动开启手动确认；必须再配置 `spring.kafka.listener.ack-mode: manual`，注入的 `Acknowledgment` 调用 `acknowledge()` 才会生效。缺少 `ack-mode` 时，监听器默认 `AckMode.BATCH`，手动确认被忽略。

### 1.4 事务消息

`@Transactional` 默认绑定 `DataSourceTransactionManager`，只管理数据库事务，不会让 Kafka 发送自动加入数据库事务。要让两者协同，需要先启用事务型生产者：

```yaml
spring:
  kafka:
    producer:
      transaction-id-prefix: order-service-  # 启用事务型生产者，Spring Boot 自动配置 KafkaTransactionManager
```

```java
@Service
public class OrderEventPublisher {

    private final KafkaTemplate<String, Object> kafkaTemplate;

    public OrderEventPublisher(KafkaTemplate<String, Object> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    // 事务消息：数据库操作与 Kafka 发送通过事务同步协同
    @Transactional
    public void createOrderAndPublish(OrderRequest request) {
        // 1. 保存订单到数据库
        Order order = orderRepository.save(new Order(request));

        // 2. 发送 Kafka 消息，参与数据库事务的同步，数据库提交后 Kafka 再提交
        kafkaTemplate.send("order-events", order.getId().toString(),
            new OrderCreatedEvent(order.getId(), order.getUserId(), order.getAmount()));
    }
}
```

> **边界说明**：这是「尽力而为」的 1PC，不是强一致的 XA 事务。若数据库已提交、Kafka 提交失败，消息仍会丢失，需用本地消息表或补偿兜底，完整方案见分布式事务专题。

### 1.5 消费者幂等

```java
@Component
public class OrderEventListener {

    @KafkaListener(topics = "order-events", groupId = "notification-group")
    public void handleOrderEvent(String message,
            @Header(KafkaHeaders.RECEIVED_TOPIC) String topic,
            @Header(KafkaHeaders.RECEIVED_PARTITION) int partition,
            @Header(KafkaHeaders.OFFSET) long offset) {

        // topic + partition + offset 在 Kafka 内全局唯一，作为物理去重键
        String messageId = topic + ":" + partition + ":" + offset;
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
            kafkaTemplate.send("order-events-dlq", topic, message);
        }
    }
}
```

幂等键有两种选法：

| 方案 | 键 | 适用场景 |
| :-- | :-- | :-- |
| 物理去重 | `topic:partition:offset` | 防止同一消息因重试被重复消费 |
| 业务幂等 | 业务唯一 ID（如订单号） | 需要业务语义幂等，且消息可能被不同生产者重发 |

`topic:partition:offset` 在 Kafka 内全局唯一，且不会像 `key` 那样可能为 null。业务幂等应优先用业务唯一 ID，它对重发、补偿都稳定。

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

    // 业务交换机
    @Bean
    public DirectExchange orderExchange() {
        return new DirectExchange("order.exchange");
    }

    // 业务队列：绑定死信交换机，消费失败的消息转入死信
    @Bean
    public Queue orderQueue() {
        return QueueBuilder.durable("order.queue")
                .withArgument("x-dead-letter-exchange", "dlx.exchange")
                .withArgument("x-dead-letter-routing-key", "dlx.routing-key")
                .build();
    }

    @Bean
    public Binding orderBinding() {
        return BindingBuilder.bind(orderQueue())
                .to(orderExchange())
                .with("order.routing-key");
    }

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
}
```

### 2.3 延迟消息

延迟消息复用死信机制：消息先进延迟队列，TTL 过期后经死信交换路由到业务队列。完整链路如下：

```java
@Configuration
public class RabbitDelayConfig {

    // 业务交换机 + 业务队列（延迟消息的最终归宿）
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
                .with("order.routing-key");
    }

    // 延迟交换机 + 延迟队列：消息级 TTL 过期后经死信交换转入业务队列
    @Bean
    public DirectExchange delayExchange() {
        return new DirectExchange("order.delay.exchange");
    }

    @Bean
    public Queue delayQueue() {
        return QueueBuilder.durable("order.delay.queue")
                .withArgument("x-dead-letter-exchange", "order.exchange")
                .withArgument("x-dead-letter-routing-key", "order.routing-key")
                .build();
    }

    @Bean
    public Binding delayBinding() {
        return BindingBuilder.bind(delayQueue())
                .to(delayExchange())
                .with("order.delay.routing-key");
    }
}
```

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

> **踩坑提醒**：TTL 有两种设置方式——队列级 `x-message-ttl`（整队列统一过期时间）和消息级 `setExpiration`（每条消息独立过期时间，如上例）。无论哪种，RabbitMQ 都只在队首消息过期时才检查，因此队首消息 TTL=30s、第二条 TTL=5s 时，第二条也要等第一条过期才被路由。`rabbitmq-delayed-message-exchange` 插件没有这个队首阻塞问题。

## 3. 消息可靠性保证

消息可靠性由四个环节共同保证，任一环缺失都会丢消息或重复消费：

| 环节 | 风险 | 保障措施 | 本文对应小节 |
| :-- | :-- | :-- | :-- |
| ① 生产者 | 网络抖动、Broker 宕机 | 开启 Producer ACK / Confirm | §1.2 |
| ② Broker | 机器宕机 | 多副本 + 持久化 | 见 Kafka / RabbitMQ 专题 |
| ③ 消费者 | 处理失败 | 手动 ACK + 重试 | §1.3 |
| ④ 业务 | 重复消费 | 幂等设计（唯一键 / 状态机） | §1.5 |

①②的配置在 §1.1 已给出，③④的代码在 §1.3、§1.5 已给出，此处不重复。

> **经验法则**：消息可靠性 = 生产者确认 + Broker 持久化 + 消费者手动 ACK + 业务幂等。四个环节缺一不可。

## 4. 最佳实践

1. **消息设计为不可变**——消息一旦发送就不应修改
2. **消费者必须幂等**——网络抖动可能导致重复消费
3. **死信队列必须有**——消费失败的消息要有归宿
4. **消息体不要太大**——Kafka 默认单条消息上限约 1MB（`message.max.bytes`），超过需调大 Broker 配置或改为传 ID 由消费方查询；RabbitMQ 无此硬性限制，按吞吐经验评估
5. **监控消息积压**——消费 Lag 超过阈值要及时告警
6. **超时与重试**——消费失败时指数退避重试，超过次数进死信队列
7. **序列化用 JSON**——不要用 Java 原生序列化，跨语言不兼容
