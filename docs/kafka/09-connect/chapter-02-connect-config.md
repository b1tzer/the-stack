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

Connector 配置通过 REST API 提交给 Kafka Connect。`connector.class` 指定已安装的 Connector 实现，示例中的 `com.example.MyConnector` 是占位类名。`tasks.max` 是 Task 数量上限，实际并行度取决于 Connector 能创建多少个 Task。`topics` 是 Sink Connector 等特定 Connector 订阅输入 Topic 的配置，不是所有 Connector 都支持。

## 2. 转换器

Converter 负责在 Kafka 消息的字节表示与 Kafka Connect 内部记录之间转换。Key 和 Value 可以分别指定 Converter，两者不必使用相同格式。Converter 必须存在于 Worker 可加载的插件或运行时依赖中。

| 转换器 | 说明 |
| :-- | :-- |
| StringConverter | 将数据作为字符串处理，不负责 JSON 解析 |
| JsonConverter | 处理 Kafka Connect 的 JSON 表示，`schemas.enable` 决定是否内嵌 Connect Schema |
| AvroConverter | 转为 Avro 格式，Confluent 实现通过 Schema Registry 管理 Schema |
| ProtobufConverter | 转为 Protobuf 格式，Confluent 实现通过 Schema Registry 管理 Schema |

JSON Converter 的配置如下所示。

```json
{
  "key.converter": "org.apache.kafka.connect.json.JsonConverter",
  "key.converter.schemas.enable": true,
  "value.converter": "org.apache.kafka.connect.json.JsonConverter",
  "value.converter.schemas.enable": true
}
```

Avro Converter 需要 Schema Registry，`schema.registry.url` 配置在 Converter 的属性下，类名使用实际安装的 Connect Converter，例如 `io.confluent.connect.avro.AvroConverter`。

```json
{
  "key.converter": "io.confluent.connect.avro.AvroConverter",
  "value.converter": "io.confluent.connect.avro.AvroConverter",
  "value.converter.schema.registry.url": "http://localhost:8081"
}
```

Kafka Producer 使用的 Serializer 与 Kafka Connect 使用的 Converter 不是同类组件，配置 Connect 时不能直接把 Producer 的 Serializer 类名当作 Converter 使用。三种二进制格式的选型、Schema 演进与 Registry 原理详见 [Schema 与序列化](../02-core/chapter-06-schema-and-serialization.md)。

## 3. 单消息转换（SMT）

SMT 在消息进入 Kafka（Source）或写入外部系统（Sink）之前对单条记录做轻量改写：InsertField（添加字段）、ReplaceField（重命名/过滤字段）、TimestampRouter（按时间路由）、RegexRouter（正则路由）。

```json
{
  "transforms": "route",
  "transforms.route.type": "org.apache.kafka.connect.transforms.RegexRouter",
  "transforms.route.regex": "^(.*)$",
  "transforms.route.replacement": "target-topic"
}
```

## 4. 错误处理配置

```json
{
  "errors.tolerance": "all",
  "errors.deadletterqueue.topic.name": "dead-letter-queue",
  "errors.deadletterqueue.topic.replication.factor": 3,
  "errors.deadletterqueue.context.headers.enable": true,
  "errors.retry.timeout": 60000,
  "errors.retry.delay.max.ms": 1000
}
```

错误处理包括重试、容忍失败记录、记录错误日志和写入死信队列，几个动作不是互斥路径。`errors.retry.timeout` 控制错误处理机制覆盖的重试过程允许持续的时间，默认 0 表示不重试，重试耗尽后是失败还是跳过仍取决于错误容忍策略和错误发生阶段。`errors.retry.delay.max.ms` 限制连续重试之间的最大延迟。`errors.tolerance=none` 表示不容忍错误记录，相关错误会导致 Task 失败。`errors.tolerance=all` 允许跳过错误记录。配置死信队列后，符合错误处理条件的 Sink 记录可写入指定 Topic，但并非所有错误都会进入死信队列。

## 5. 消费与批量写入参数

```json
{
  "batch.size": 1000,
  "max.poll.records": 500,
  "max.poll.interval.ms": 300000
}
```

下面的代码块只是不同作用域配置的示意片段，三个参数不能当作一组通用吞吐量开关直接放入同一个 Connector 配置。`max.poll.records` 限制 Consumer 每次 `poll()` 返回的记录数。`max.poll.interval.ms` 限制两次 `poll()` 之间的最大间隔，超过该间隔可能导致消费者离开消费者组并触发分区重新分配。`batch.size` 是 JDBC Sink 等具体 Connector 的批量写入配置。增大批次可能减少单条记录的处理开销，也可能增加单批处理时间、内存占用和延迟，实际效果取决于目标系统与负载。

## 6. JDBC Sink 配置示例

以下示例将 `user-events` Topic 中的记录写入 MySQL，假设记录 Key 中包含 `id` 字段，且 Converter 能将其解析为 Connect 记录结构。示例只展示核心配置，实际使用前还需配置数据库驱动、连接凭据及相应插件依赖。

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

`insert.mode=upsert` 决定写入采用插入或更新语义，具体 SQL 行为依赖目标数据库。`pk.mode=record_key` 从记录 Key 获取主键，`pk.fields=id` 指定主键字段，要求上游记录的 Key 中存在对应字段。`fields.whitelist` 用于筛选写入的字段，具体字段名以实际使用的 JDBC Connector 版本为准。`table.name.format=users_${topic}` 按输入 Topic 生成表名，`user-events` 对应 `users_user-events`，若数据库命名规范不允许连字符需调整。`auto.create` 与 `auto.evolve` 只处理受限的表结构变化，不能替代生产环境的表结构变更管理。
