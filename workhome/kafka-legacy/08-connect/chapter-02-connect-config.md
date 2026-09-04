# 连接器配置

## 1. 通用配置

```json
{
  "name": "my-connector",
  "config": {
    "connector.class": "com.example.MyConnector",
    "tasks.max": 3,
    "topics": "topic1,topic2",
    "key.converter": "org.apache.kafka.connect.storage.StringConverter",
    "value.converter": "org.apache.kafka.connect.json.JsonConverter"
  }
}
```

## 2. 转换器

| 转换器 | 说明 |
| :-- | :-- |
| StringConverter | 字符串 |
| JsonConverter | JSON |
| AvroConverter | Avro（Schema Registry） |
| ProtobufConverter | Protobuf |

## 3. 单消息转换 (SMT)

```json
{
  "transforms": "route",
  "transforms.route.type": "org.apache.kafka.connect.transforms.RegexRouter",
  "transforms.route.regex": "^(.*)$",
  "transforms.route.replacement": "target-topic"
}
```

## 4. 常用 SMT

- InsertField：添加字段
- ReplaceField：重命名/过滤字段
- TimestampRouter：按时间路由
- RegexRouter：正则路由

## 5. 转换器详解

### 5.1 JSON Converter
```json
{
  "key.converter": "org.apache.kafka.connect.json.JsonConverter",
  "key.converter.schemas.enable": true,
  "value.converter": "org.apache.kafka.connect.json.JsonConverter",
  "value.converter.schemas.enable": true
}
```

### 5.2 Avro Converter（需要 Schema Registry）
```json
{
  "key.converter": "io.confluent.kafka.serializers.KafkaAvroSerializer",
  "value.converter": "io.confluent.kafka.serializers.KafkaAvroSerializer",
  "value.converter.schema.registry.url": "http://localhost:8081"
}
```

## 6. 错误处理配置

```json
{
  "errors.tolerance": "all",
  "errors.deadletterqueue.topic.name": "dead-letter-queue",
  "errors.deadletterqueue.topic.replication.factor": 3,
  "errors.deadletterqueue.context.headers.enable": true,
  "errors.retry.timeout.ms": 60000,
  "errors.retry.delay.max.ms": 1000
}
```

**错误容忍级别**：
- `none`：遇到任何错误就停止 Connector。
- `all`：忽略所有错误，将失败消息发送到死信队列。

## 7. 批量配置

```json
{
  "batch.size": 1000,
  "max.poll.records": 500,
  "max.poll.interval.ms": 300000
}
```

批量配置可以提高 Connector 的吞吐量，但会增加延迟。

## 8. 数据格式转换示例

```json
{
  "name": "jdbc-sink",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSinkConnector",
    "connection.url": "jdbc:mysql://localhost:3306/mydb",
    "topics": "user-events",
    "insert.mode": "upsert",
    "pk.mode": "record_key",
    "pk.fields": "id",
    "fields.whitelist": "id,name,email",
    "table.name.format": "users_${topic}",
    "auto.create": true,
    "auto.evolve": true
  }
}
```

