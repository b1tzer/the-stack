# 第一个 Kafka 应用

> 先在本地拉起一个 Kafka，再用 Spring Boot 写一个最小可运行的消息生产与消费示例。目标是：复制代码即可运行，并理解每个关键配置的联动关系。

## 1. 准备本地环境 {#prepare-local-env}

Kafka 有 ZooKeeper 与 KRaft 两种元数据管理模式。本文用 Confluent Platform 7.6 的 ZooKeeper 模式启动单 Broker 环境，以减少本地实验所需的配置；新部署应优先考虑 KRaft，相关差异见 [Controller 与 KRaft](../02-core/chapter-08-controller-and-kraft.md)。两种模式的启动配置不能混用。本地验证最快的是一条 Docker Compose 命令：

```yaml
services:
  zookeeper:
    image: confluentinc/cp-zookeeper:7.6.0
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
  kafka:
    image: confluentinc/cp-kafka:7.6.0
    depends_on:
      - zookeeper
    ports:
      - "9092:9092"
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false"
```

执行 `docker-compose up -d` 拉起容器。

最容易被忽略的是 `KAFKA_ADVERTISED_LISTENERS`：`listeners` 是 Broker 实际监听的地址（容器内），`advertised.listeners` 是返回给客户端的地址（容器外）。这里必须填客户端可达的 `localhost:9092`——填成 `kafka:9092` 时宿主机无法解析容器内域名，这是 Compose 启动后客户端连不上的最常见原因。`KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false"` 关闭自动建 Topic，避免 Topic 名拼错时悄悄创建出多余 Topic。

生产环境不要沿用这份 ZK 模式的 YAML。若改用 KRaft 部署，启动前要先「格式化」——用 `kafka-storage.sh format` 初始化每个节点的存储目录元数据。这一步属于 KRaft 的节点初始化流程，与 ZooKeeper 模式的初始化方式不同：

```bash
KAFKA_CLUSTER_ID=$(kafka-storage.sh random-uuid)  # 1. 生成集群唯一标识
kafka-storage.sh format -t $KAFKA_CLUSTER_ID -c kraft/server.properties  # 2. 格式化存储目录，写入初始元数据
kafka-server-start.sh kraft/server.properties  # 3. 启动
```

这段 KRaft 命令是另一条独立的部署路径，要求本机已安装 Kafka 二进制发行版、事先准备好 `kraft/server.properties` 配置文件，与前面 Docker Compose 拉起的 ZK 环境不是同一套操作。集群 ID 只在第一个节点生成一次，后续所有节点复用同一个值——不要在每台机器上重复执行 `random-uuid`，否则各节点元数据不一致，无法组成集群。启动后用下面的命令验证收发：

```bash
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic test --partitions 1 --replication-factor 1
echo "hello kafka" | kafka-console-producer.sh --bootstrap-server localhost:9092 --topic test
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic test --from-beginning --max-messages 1
```

`test` 只用于验证控制台工具。Spring Boot 示例使用的 `orders` Topic 需要显式创建（上文关闭了自动建 Topic）：

```bash
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic orders --partitions 1 --replication-factor 1
```

本文创建单分区、单副本的 Topic 仅用于本地验证，生产环境应根据吞吐量、消费并行度和故障恢复要求规划分区数与副本数。

对于没有已提交 Offset 的新消费者组，控制台消费者默认从最新位置开始，要验证此前写入的消息需加 `--from-beginning`；它不意味着忽略已有的有效 Offset。`--max-messages 1` 读到 1 条就退出，否则控制台消费者会一直阻塞等待新消息。应用侧 §3 的 `auto-offset-reset: earliest` 同样只在消费者组没有有效已提交 Offset 时生效，已有 Offset 时从已提交位置继续消费。

## 2. 添加依赖

```xml
<dependency>
    <groupId>org.springframework.kafka</groupId>
    <artifactId>spring-kafka</artifactId>
</dependency>
```

`spring-kafka` 的版本由 Spring Boot 的依赖管理统一控制，这里不写 `<version>`，避免与 Boot 版本冲突。

## 3. 配置

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
    listener:
      ack-mode: manual
```

这里有两项与消息交付行为直接相关的配置，分开解释：

- `acks: all`：生产者等待当前 ISR 中的副本确认写入后才把请求视为成功。它与 `min.insync.replicas` 配合能提高写入可靠性，但单 Broker、单副本环境没有第二个副本可以接替故障节点，此时 `acks: all` 并不等于具备副本级容错能力，本文只演示配置方式。三种 ACK 的取舍见 [ACK 与幂等](../02-core/chapter-05-ack-and-idempotence.md)。
- `enable-auto-commit: false`：关闭 Kafka Consumer 的原生定时自动提交。这一项和 §5 消费者里的 `Acknowledgment` 是一对联动配置，缺了任意一个，另一边的行为都会改变，下面 §5 单独讲。

## 4. 生产者

```java
import java.util.concurrent.CompletableFuture;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.SendResult;
import org.springframework.stereotype.Service;

@Service
public class OrderProducer {

    private static final Logger log = LoggerFactory.getLogger(OrderProducer.class);

    private final KafkaTemplate<String, String> kafkaTemplate;

    public OrderProducer(KafkaTemplate<String, String> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    public CompletableFuture<SendResult<String, String>> sendOrder(String orderId, String payload) {
        CompletableFuture<SendResult<String, String>> future =
            kafkaTemplate.send("orders", orderId, payload);

        future.whenComplete((result, ex) -> {
            if (ex == null) {
                log.info("Sent: partition={}, offset={}",
                    result.getRecordMetadata().partition(),
                    result.getRecordMetadata().offset());
            } else {
                log.error("Failed to send order: {}", orderId, ex);
            }
        });

        return future;
    }
}
```

`send()` 是异步的，立即返回一个 `CompletableFuture`，真正的发送结果要等 Broker 确认后才在 `whenComplete` 回调里拿到。方法返回 Future 不代表消息已发送成功——需要「发送成功才继续」的场景，调用方要在业务边界等待这个 Future 并检查结果，必要时用 `get()` 同步等待，同时处理超时、中断和发送异常。另外，Broker 确认生产请求成功，不等于消费者已经收到消息，更不等于订单业务处理成功，这三个阶段需分别判断。

## 5. 消费者

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

这里省略了实际业务处理，仅用日志演示确认时机；接入业务逻辑时应在处理成功后确认，处理失败则需按重试、错误处理和死信策略决定如何处置消息。

这里的方法是「手动提交」模式，由 §3 的两项配置共同决定：

```txt
enable-auto-commit: false
        ↓
关闭 Kafka Consumer 的定时自动提交
        ↓
spring.kafka.listener.ack-mode: manual
        ↓
监听容器允许通过 Acknowledgment 显式确认
        ↓
ack.acknowledge() 通知监听容器提交 Offset
```

`enable-auto-commit` 和 `ack-mode` 控制两个不同层次：前者关闭 Kafka 原生自动提交，后者决定 Spring Kafka 监听容器何时确认 Offset。只关前者不设后者，监听容器默认仍是批量确认模式（BATCH），`@KafkaListener` 方法里无法注入 `Acknowledgment`。

为什么不用默认的自动提交？Kafka 原生自动提交以消费者 `poll()` 获取的记录位置为基础，按固定时间间隔（`auto.commit.interval.ms`）提交，不等待业务处理完成。若业务处理时间超过了自动提交周期，Offset 就可能先于业务完成而推进，此时进程发生故障，重启后会跳过尚未处理完成的消息：

```txt
poll() → 返回消息 → 到点自动提交 Offset → 业务处理中宕机
                                           ↓
重启后从已提交的 Offset 继续 → 这条没处理完的消息被跳过（丢失）
```

这个风险来自 Offset 提交时机与业务处理完成时机不一致，并非每次自动提交都会丢消息。

手动提交把「提交」这个动作移到业务处理完成之后：`ack.acknowledge()` 写在 `log.info` 之后，表示处理完才确认。若业务已处理成功、但 Offset 尚未提交时进程宕机，重启后会重新消费这条消息——可能重复，但不会丢；反过来，若在业务处理完成前就确认，故障后同样可能跳过未完成的工作。手动确认能控制提交时机，却不能单独保证业务副作用与 Offset 提交原子完成。重复由业务幂等处理解决，见 [消息去重](../03-reliability/chapter-02-message-dedup.md)。

## 6. 测试

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

这个测试只调用 `sendOrder()`，没有等待异步发送结果，也没有断言消费者收到消息。它只能验证调用过程没有同步抛出异常，不能验证消息是否发送成功，更不能验证端到端消费是否成功。若要验证发送成功，应等待返回的 Future 并检查结果；若要验证完整的生产与消费链路，应在测试 Kafka 环境等待消费者收到指定消息并断言内容，示例见 [Spring Kafka 集成](../../spring/07-async-and-messaging/chapter-04-messaging.md#kafka-integration) 的测试一节。
