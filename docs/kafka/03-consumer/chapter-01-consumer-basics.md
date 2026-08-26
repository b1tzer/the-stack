# 消费者 API

## 1. 基本用法

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "my-group");
props.put("key.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");
props.put("value.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("my-topic"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, String> record : records) {
        System.out.printf("offset=%d, key=%s, value=%s%n", 
            record.offset(), record.key(), record.value());
    }
}
```

## 2. 订阅方式

```java
// 订阅主题
consumer.subscribe(Arrays.asList("topic1", "topic2"));

// 正则订阅
consumer.subscribe(Pattern.compile("topic.*"));

// 指定分区
consumer.assign(Arrays.asList(new TopicPartition("topic", 0)));
```

## 3. 核心参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| group.id | 消费者组 | - |
| enable.auto.commit | 自动提交 | true |
| auto.commit.interval.ms | 提交间隔 | 5000 |
| max.poll.records | 单次拉取最大条数 | 500 |
| session.timeout.ms | 会话超时 | 45000 |

## 4. Poll 循环原理

`poll()` 是消费者的核心方法，它做了两件事：
1. **发送心跳**：内部通过心跳线程保持与 Group Coordinator 的连接。
2. **拉取消息**：向 Broker 发送 Fetch 请求，获取新消息。

```java
// 推荐的消费循环模式
try {
    while (running) {
        ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
        for (ConsumerRecord<String, String> record : records) {
            processRecord(record);
        }
        consumer.commitSync();  // 处理完一批后提交
    }
} finally {
    consumer.close();
}
```

## 5. 消费者线程模型

```
┌───────────────────────────────────────┐
│            Consumer 实例              │
│  ┌─────────────────────────────────┐  │
│  │  应用线程（调用 poll()）          │  │
│  └──────────┬──────────────────────┘  │
│             │                          │
│  ┌──────────▼──────────────────────┐  │
│  │  Fetcher（获取消息）              │  │
│  └──────────┬──────────────────────┘  │
│             │                          │
│  ┌──────────▼──────────────────────┐  │
│  │  NetworkClient（网络 I/O）        │  │
│  └──────────┬──────────────────────┘  │
│             │                          │
│  ┌──────────▼──────────────────────┐  │
│  │  Heartbeat Thread（心跳线程）     │  │
│  └─────────────────────────────────┘  │
└───────────────────────────────────────┘
```

**注意**：KafkaConsumer **不是线程安全的**。多线程使用同一个实例会导致 `ConcurrentModificationException`。

## 6. 反序列化器

```java
// 自定义反序列化器
public class UserDeserializer implements Deserializer<User> {
    @Override
    public User deserialize(String topic, byte[] data) {
        String[] parts = new String(data, StandardCharsets.UTF_8).split(":");
        return new User(Long.parseLong(parts[0]), parts[1], parts[2]);
    }
}

// 配置
props.put("key.deserializer", "com.example.UserDeserializer");
props.put("value.deserializer", "com.example.UserDeserializer");
```

## 7. 消费者关闭

```java
// 优雅关闭
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    running = false;
    consumer.wakeup();  // 中断 poll()
}));

try {
    while (running) {
        ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
        // 处理消息
    }
} catch (WakeupException e) {
    // 忽略，正常关闭
} finally {
    consumer.close();
}
```

## 8. 最佳实践

1. **消费者不是线程安全的**：每个线程一个消费者实例，或者使用 KafkaConsumer 的包装器。
2. **poll() 间隔不能太长**：超过 `max.poll.interval.ms`（默认 5 分钟）会触发 Rebalance。
3. **使用 wakeup() 优雅关闭**：不要直接 kill 进程，会导致 Offset 未提交。
4. **监控 fetch-latency-avg**：如果延迟过高，可能是网络问题或 Broker 负载过高。
