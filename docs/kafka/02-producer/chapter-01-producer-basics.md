# 生产者 API

## 1. 基本用法

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
props.put("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");

KafkaProducer<String, String> producer = new KafkaProducer<>(props);

// 同步发送
ProducerRecord<String, String> record = new ProducerRecord<>("my-topic", "key", "value");
producer.send(record).get();

// 异步发送
producer.send(record, (metadata, exception) -> {
    if (exception == null) {
        System.out.println("offset: " + metadata.offset());
    }
});

producer.close();
```

## 2. 发送流程

```
Producer → 拦截器 → 序列化器 → 分区器 → RecordAccumulator → Sender → Broker
```

## 3. 核心参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| bootstrap.servers | Broker 地址 | - |
| acks | 确认机制 | all |
| retries | 重试次数 | Integer.MAX_VALUE |
| batch.size | 批量大小 | 16384 |
| linger.ms | 等待时间 | 0 |
| buffer.memory | 缓冲区大小 | 33554432 |

## 4. 发送流程详解

生产者发送消息的完整流程如下：

1. **拦截器链（ProducerInterceptor）**：可以在消息发送前/后进行逻辑处理，如添加时间戳、记录日志等。
2. **序列化**：将 Key 和 Value 从 Java 对象转为 byte[]。
3. **分区路由**：根据分区策略决定消息发往哪个分区。
4. **RecordAccumulator**：消息按分区聚合到双端队列（Deque），每个队列对应一个分区的批次（ProducerBatch）。
5. **Sender 线程**：独立线程从 RecordAccumulator 取出就绪的批次，封装成 ClientRequest 发送到 Broker。
6. **Broker 处理**：写入 Leader 副本，根据 ISR 机制同步到 Follower，返回 ACK。

## 5. 拦截器示例

```java
public class TimestampInterceptor implements ProducerInterceptor<String, String> {
    @Override
    public ProducerRecord<String, String> onSend(ProducerRecord<String, String> record) {
        // 在消息发送前添加自定义 Header
        record.headers().add("app-timestamp", 
            String.valueOf(System.currentTimeMillis()).getBytes());
        return record;
    }

    @Override
    public void onAcknowledgement(RecordMetadata metadata, Exception exception) {
        if (exception != null) {
            System.err.println("Send failed: " + exception.getMessage());
        }
    }

    @Override
    public void close() {}

    @Override
    public void configure(Map<String, ?> configs) {}
}
```

配置拦截器：
```java
props.put("interceptor.classes", "com.example.TimestampInterceptor");
```

## 6. 自定义序列化器

```java
public class UserSerializer implements Serializer<User> {
    @Override
    public byte[] serialize(String topic, User user) {
        return String.format("%d:%s:%s", user.getId(), user.getName(), user.getEmail())
            .getBytes(StandardCharsets.UTF_8);
    }
}
```

**推荐使用 Avro/Protobuf/JSON Schema**，配合 Schema Registry 实现 Schema 演进：
```java
props.put("key.serializer", "io.confluent.kafka.serializers.KafkaAvroSerializer");
props.put("value.serializer", "io.confluent.kafka.serializers.KafkaAvroSerializer");
props.put("schema.registry.url", "http://localhost:8081");
```

## 7. 关闭生产者

```java
// 同步关闭，等待所有消息发送完成
producer.close();

// 带超时的关闭
producer.close(Duration.ofSeconds(30));
```

