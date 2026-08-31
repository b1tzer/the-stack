# Spring Kafka 集成

## 1. 依赖

```xml
<dependency>
    <groupId>org.springframework.kafka</groupId>
    <artifactId>spring-kafka</artifactId>
</dependency>
```

## 2. 配置

```yaml
spring:
  kafka:
    bootstrap-servers: localhost:9092
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.apache.kafka.common.serialization.StringSerializer
      acks: all
      retries: 3
    consumer:
      group-id: my-group
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      auto-offset-reset: earliest
```

## 3. 生产者

```java
@Service
public class KafkaProducer {
    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;
    
    public void send(String topic, String message) {
        kafkaTemplate.send(topic, message);
    }
}
```

## 4. 消费者

```java
@Component
public class KafkaConsumer {
    @KafkaListener(topics = "my-topic", groupId = "my-group")
    public void consume(String message) {
        System.out.println("Received: " + message);
    }
}
```

## 5. Spring Kafka 高级配置

```java
@Configuration
public class KafkaConfig {

    @Bean
    public ConcurrentKafkaListenerContainerFactory<String, String> kafkaListenerContainerFactory(
            ConsumerFactory<String, String> consumerFactory) {
        ConcurrentKafkaListenerContainerFactory<String, String> factory =
            new ConcurrentKafkaListenerContainerFactory<>();
        factory.setConsumerFactory(consumerFactory);
        factory.setConcurrency(3);  // 并发消费者数
        factory.getContainerProperties().setPollTimeout(3000);
        factory.getContainerProperties().setAckMode(ContainerProperties.AckMode.MANUAL_IMMEDIATE);
        factory.setCommonErrorHandler(new DefaultErrorHandler(
            new FixedBackOff(1000L, 3L)  // 重试 3 次，间隔 1 秒
        ));
        return factory;
    }

    @Bean
    public ProducerFactory<String, String> producerFactory() {
        Map<String, Object> props = new HashMap<>();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        props.put(ProducerConfig.ACKS_CONFIG, "all");
        props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
        props.put(ProducerConfig.RETRIES_CONFIG, Integer.MAX_VALUE);
        return new DefaultKafkaProducerFactory<>(props);
    }

    @Bean
    public KafkaTemplate<String, String> kafkaTemplate() {
        return new KafkaTemplate<>(producerFactory());
    }
}
```

## 6. 手动提交 Offset

```java
@Component
public class ManualAckConsumer {

    @KafkaListener(topics = "my-topic", groupId = "my-group")
    public void consume(ConsumerRecord<String, String> record,
                        Acknowledgment acknowledgment) {
        try {
            // 处理消息
            processMessage(record);
            // 手动提交 Offset
            acknowledgment.acknowledge();
        } catch (Exception e) {
            // 处理失败，不提交 Offset，消息会被重新消费
            log.error("Failed to process message", e);
        }
    }
}
```

## 7. 事务支持

```java
@Service
public class TransactionalProducer {

    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;

    public void sendInTransaction(String topic, String key, String value) {
        kafkaTemplate.executeInTransaction(operations -> {
            operations.send(topic, key, value);
            operations.send("another-topic", key, "processed-" + value);
            return true;
        });
    }
}
```

## 8. 消息过滤器

```java
@Bean
public ConcurrentKafkaListenerContainerFactory<String, String> filteredFactory(
        ConsumerFactory<String, String> consumerFactory) {
    ConcurrentKafkaListenerContainerFactory<String, String> factory =
        new ConcurrentKafkaListenerContainerFactory<>();
    factory.setConsumerFactory(consumerFactory);
    factory.setRecordFilterStrategy(record -> {
        // 过滤掉 value 为空的消息
        return record.value() == null || record.value().isEmpty();
    });
    return factory;
}

@KafkaListener(topics = "filtered-topic", containerFactory = "filteredFactory")
public void consumeFiltered(String message) {
    // 只会收到非空消息
    System.out.println("Received: " + message);
}
```

## 9. 测试配置

```java
@SpringBootTest
@EmbeddedKafka(partitions = 1, topics = {"test-topic"})
public class KafkaProducerTest {

    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;

    @Autowired
    private EmbeddedKafkaBroker embeddedKafka;

    @Test
    public void testSendAndReceive() throws Exception {
        // 发送消息
        kafkaTemplate.send("test-topic", "key", "value").get();

        // 验证消息
        Consumer<String, String> consumer = createTestConsumer();
        ConsumerRecords<String, String> records = consumer.poll(Duration.ofSeconds(10));
        assertThat(records.count()).isEqualTo(1);
        assertThat(records.iterator().next().value()).isEqualTo("value");
    }
}
```

## 10. 最佳实践

1. **使用 @KafkaListener 而非手动创建消费者**：Spring 管理的消费者更易于配置和测试。
2. **配置错误处理**：使用 `DefaultErrorHandler` 处理消费失败，避免消息丢失。
3. **使用手动提交 Offset**：在消息处理完成后才提交，避免消息丢失。
4. **集成测试使用 @EmbeddedKafka**：无需外部 Kafka 集群，提高测试效率。
