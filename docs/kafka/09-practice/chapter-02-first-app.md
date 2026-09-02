# 第一个 Kafka 应用

> 用 Spring Boot + Kafka 写一个最小可运行的消息生产与消费示例，并讲清「为什么这样配置」。目标是：复制代码即可运行，且理解每个关键配置的联动关系。

## 1. 添加依赖

```xml
<dependency>
    <groupId>org.springframework.kafka</groupId>
    <artifactId>spring-kafka</artifactId>
</dependency>
```

`spring-kafka` 的版本由 Spring Boot 的依赖管理统一控制，这里不写 `<version>`，避免与 Boot 版本冲突。

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

两个值需要重点解释，它们决定了消息可靠性：

- `acks: all`：消息写入所有 ISR 副本后才确认，避免 Leader 宕机丢数据。三种 ACK 的取舍见 [ACK 机制与可靠性保证](../05-reliability/chapter-01-acks.md)。
- `enable-auto-commit: false`：关闭自动提交 Offset。这一项和 §4 消费者里的 `Acknowledgment` 是一对联动配置，缺了任意一个，另一边的行为都会改变，下面 §4 单独讲。

## 3. 生产者

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

@Service
public class OrderProducer {

    private static final Logger log = LoggerFactory.getLogger(OrderProducer.class);

    private final KafkaTemplate<String, String> kafkaTemplate;

    public OrderProducer(KafkaTemplate<String, String> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

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

`send()` 是异步的，立即返回一个 `CompletableFuture`。真正的发送结果要等 Broker 确认后才在 `whenComplete` 回调里拿到。这意味着 `sendOrder()` 返回时消息不一定已写入——业务上需要「发送成功才继续」的场景，应调用 `future.get()` 同步等待，而不是只看方法返回值。

## 4. 消费者

```java
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

@Component
public class OrderConsumer {

    private static final Logger log = LoggerFactory.getLogger(OrderConsumer.class);

    @KafkaListener(topics = "orders", groupId = "my-app")
    public void consume(ConsumerRecord<String, String> record, Acknowledgment ack) {
        log.info("Received: key={}, value={}, partition={}, offset={}",
            record.key(), record.value(), record.partition(), record.offset());
        ack.acknowledge(); // 手动提交
    }
}
```

这里的方法是「手动提交」模式，它由 §2 的 `enable-auto-commit: false` 触发：

```text
enable-auto-commit: false
        ↓
Spring Boot 把监听容器的确认模式切为 MANUAL
        ↓
@KafkaListener 方法才能注入 Acknowledgment
        ↓
ack.acknowledge() 才会真正提交 Offset
```

为什么不用默认的自动提交？自动提交按固定时间间隔（`auto.commit.interval.ms`）提交，可能出现在「消息已提交、业务还没处理完」的窗口：

```text
poll() → 返回消息 → 到点自动提交 Offset → 业务处理中宕机
                                           ↓
重启后从已提交的 Offset 继续 → 这条没处理完的消息被跳过（丢失）
```

手动提交把「提交」这个动作移到业务处理完成之后：`ack.acknowledge()` 写在 `log.info` 之后，表示处理完才确认。宕机重启会重新消费这条消息——可能重复，但不会丢。重复由业务幂等处理解决，见 [Exactly Once 语义](../05-reliability/chapter-02-exactly-once.md) §4。

## 5. 测试

```java
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class KafkaTest {

    @Autowired
    OrderProducer producer;

    @Test
    void sendOrder() {
        producer.sendOrder("ORD-001", "{\"amount\":99.9}");
    }
}
```

这个用例只验证 `sendOrder()` 不抛异常，没有断言消息真的落盘，因为发送是异步的。要验证端到端收发，需用内嵌 Broker（`@EmbeddedKafka`），示例见 [Spring Kafka 集成](./chapter-04-spring-integration.md) §9。
