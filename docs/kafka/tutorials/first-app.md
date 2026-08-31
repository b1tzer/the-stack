# 第一个 Kafka 应用

> 用 Spring Boot + Kafka 实现一个简单的消息生产消费。

## 1. 添加依赖

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
    consumer:
      group-id: my-app
      auto-offset-reset: earliest
      enable-auto-commit: false
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.apache.kafka.common.serialization.StringDeserializer
```

## 3. 生产者

```java
@Service
public class OrderProducer {
    private final KafkaTemplate<String, String> kafkaTemplate;

    public void sendOrder(String orderId, String payload) {
        kafkaTemplate.send("orders", orderId, payload)
            .whenComplete((result, ex) -> {
                if (ex == null) {
                    log.info("Sent: {}", result.getRecordMetadata().offset());
                } else {
                    log.error("Failed: {}", ex.getMessage());
                }
            });
    }
}
```

## 4. 消费者

```java
@Component
public class OrderConsumer {
    @KafkaListener(topics = "orders", groupId = "my-app")
    public void consume(ConsumerRecord<String, String> record, Acknowledgment ack) {
        log.info("Received: key={}, value={}, partition={}, offset={}",
            record.key(), record.value(), record.partition(), record.offset());
        ack.acknowledge(); // 手动提交
    }
}
```

## 5. 测试

```java
@SpringBootTest
class KafkaTest {
    @Autowired OrderProducer producer;

    @Test
    void sendOrder() {
        producer.sendOrder("ORD-001", "{\"amount\":99.9}");
    }
}
```
