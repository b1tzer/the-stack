# Schema Registry 原理与 API

Schema Registry 是一个独立于 Broker 的 REST 服务。它不属于 Apache Kafka 本身，由 Confluent 用 Confluent Community License 开源。生产环境里它承担三个角色：**Schema 存储**、**版本管理**、**兼容性校验**。

## 1. 三个核心概念：Subject、Version、Schema ID

理解 Schema Registry 只需要理清这三个词的关系。

**Subject** 是一个"命名空间"，通常对应一个 Topic 的 key 或 value。默认命名策略（`TopicNameStrategy`）下：

- Topic `orders` 的 value schema 存在 subject `orders-value`
- Topic `orders` 的 key schema 存在 subject `orders-key`

**Version** 是 subject 内的序号。同一 subject 每注册一次新的 schema，version 递增。version 1、2、3…是这个 subject 的演进历史。

**Schema ID** 是全局唯一的 32 位整数，直接标识一个 schema 的字节内容。同一个 schema 如果被注册到两个不同 subject，只会有一个 schema id，但对应两个 `(subject, version)` 二元组。

三者关系示例：

```text
Subject: orders-value
├─ Version 1 → Schema ID 42   (初始 schema)
├─ Version 2 → Schema ID 51   (加了 email 字段)
└─ Version 3 → Schema ID 76   (加了 country 字段)

Subject: shipments-value
└─ Version 1 → Schema ID 42   (碰巧结构相同，复用 ID)
```

数据来源：[Confluent Best Practices for Schema Registry](https://www.confluent.io/blog/best-practices-for-confluent-schema-registry/)。

## 2. Wire Format：消息里到底装了什么

`KafkaAvroSerializer` / `KafkaProtobufSerializer` / `KafkaJsonSchemaSerializer` 三个 Serializer 输出的字节结构完全一致，都遵循 Confluent Wire Format：

```text
+-----------+---------------+----------------------+
| Magic Byte| Schema ID     | Serialized Payload   |
| (1 byte)  | (4 bytes, BE) | (Avro/Proto/JSON bin)|
+-----------+---------------+----------------------+
    0x00       int32           剩余全部字节
```

- **Magic Byte** 目前只有 `0x00` 一个值，为将来协议演进保留。
- **Schema ID** 用 big-endian int32 存储，是消费者查 Registry 的钥匙。
- **Payload** 是纯粹的 Avro / Protobuf / JSON binary，不含字段名、不含类型信息。

::: warning Magic Byte 检查
Deserializer 拿到消息第一件事就是校验 `bytes[0] == 0x00`。如果不为 0，直接抛 `SerializationException("Unknown magic byte!")`。生产上常见的原因是有生产者绕过 `KafkaAvroSerializer` 直接 `send(byte[])`，把非注册 schema 的数据写进了 topic。
:::

## 3. 序列化与反序列化流程

Producer 侧一次 `send()` 的完整链路：

```text
producer.send(new ProducerRecord("orders", key, orderObj))
   │
   ▼
KafkaAvroSerializer.serialize()
   │
   ├─ 1. 计算 orderObj 对应的 schema
   ├─ 2. 检查本地 schema→id 缓存
   │     ├─ 命中 → 直接拿到 id
   │     └─ 未命中 → POST /subjects/orders-value/versions
   │                Registry 做兼容性校验 → 返回 id
   ├─ 3. 拼装：[0x00][id (4 bytes)][Avro binary]
   └─ 4. 返回 byte[]
   │
   ▼
KafkaProducer 发送到 Broker
```

Consumer 侧的反向链路：

```text
KafkaConsumer.poll() 收到 byte[]
   │
   ▼
KafkaAvroDeserializer.deserialize()
   │
   ├─ 1. 校验 magic byte == 0x00
   ├─ 2. 读取 4 字节 schema id
   ├─ 3. 检查本地 id→schema 缓存
   │     ├─ 命中 → 直接拿到 schema
   │     └─ 未命中 → GET /schemas/ids/{id}
   ├─ 4. 用 schema 反序列化 payload
   └─ 5. 返回 GenericRecord / SpecificRecord
```

关键点是**双向缓存**：Producer 缓存 `schema → id`（避免每次 send 都调 Registry），Consumer 缓存 `id → schema`（避免每条消息都调 Registry）。Registry 只在缓存未命中时才是链路上的同步依赖。生产上 Registry 抖动通常不会直接影响读写吞吐——除非集群刚启动或 schema 发生变更。

## 4. REST API 速览

Registry 的所有能力都通过 REST 暴露，端口默认 8081。以下是最常用的 8 个端点。

### 4.1 注册 Schema

```bash
curl -X POST \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  --data '{"schema": "{\"type\":\"record\",\"name\":\"Order\",\"fields\":[...]}"}' \
  http://localhost:8081/subjects/orders-value/versions
# Response: { "id": 42 }
```

若 subject 不存在，Registry 自动创建；若存在，则按当前 compatibility level 校验，通过后分配新 version。

### 4.2 按 ID 查 Schema

```bash
curl http://localhost:8081/schemas/ids/42
```

Consumer 反序列化时走的就是这条。

### 4.3 列出所有 Subject / 所有 Version

```bash
curl http://localhost:8081/subjects
curl http://localhost:8081/subjects/orders-value/versions
```

### 4.4 查看指定 Version 的 Schema

```bash
curl http://localhost:8081/subjects/orders-value/versions/latest
curl http://localhost:8081/subjects/orders-value/versions/2
```

`latest` 是保留字，表示最新一版。

### 4.5 兼容性测试（不注册）

```bash
curl -X POST \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  --data '{"schema": "..."}' \
  http://localhost:8081/compatibility/subjects/orders-value/versions/latest
# Response: { "is_compatible": true }
```

CI 流水线在合并 PR 前跑这个接口，可以拦下 breaking change。

### 4.6 查看 / 修改兼容性策略

```bash
# 全局
curl http://localhost:8081/config
curl -X PUT --data '{"compatibility": "BACKWARD"}' http://localhost:8081/config

# 单个 subject（覆盖全局）
curl http://localhost:8081/config/orders-value
curl -X PUT --data '{"compatibility": "FULL"}' http://localhost:8081/config/orders-value
```

策略语义详见 [§4 Schema 演进与兼容性](./chapter-04-schema-evolution.md)。

### 4.7 软删除与硬删除

Schema Registry 的删除是两步：

```bash
# 软删除：标记为 deleted，schema 仍保留
curl -X DELETE http://localhost:8081/subjects/orders-value/versions/2

# 硬删除：真正清除（须先软删除）
curl -X DELETE 'http://localhost:8081/subjects/orders-value/versions/2?permanent=true'
```

生产环境几乎不用硬删除——一旦硬删，历史消息就再也解析不出来了。

数据来源：[Schema Registry API Reference](https://docs.confluent.io/platform/current/schema-registry/develop/api.html)。

## 5. Java 集成：完整 Producer / Consumer

Producer 侧最小配置：

```java
Properties props = new Properties();
props.put("bootstrap.servers", "kafka:9092");
props.put("key.serializer",   "org.apache.kafka.common.serialization.StringSerializer");
props.put("value.serializer", "io.confluent.kafka.serializers.KafkaAvroSerializer");
props.put("schema.registry.url", "http://schema-registry:8081");

// 生产环境建议关闭自动注册
props.put("auto.register.schemas", false);
// 建议启用归一化，让语义相同、语法不同的 schema 归为一致
props.put("normalize.schemas", true);

try (Producer<String, GenericRecord> producer = new KafkaProducer<>(props)) {
    Schema schema = new Schema.Parser().parse(new File("order.avsc"));
    GenericRecord order = new GenericData.Record(schema);
    order.put("orderId", 100L);
    order.put("amount",  99.5);
    producer.send(new ProducerRecord<>("orders", "key1", order)).get();
}
```

Consumer 侧：

```java
Properties props = new Properties();
props.put("bootstrap.servers", "kafka:9092");
props.put("group.id", "order-consumers");
props.put("key.deserializer",   "org.apache.kafka.common.serialization.StringDeserializer");
props.put("value.deserializer", "io.confluent.kafka.serializers.KafkaAvroDeserializer");
props.put("schema.registry.url", "http://schema-registry:8081");

// 使用 SpecificRecord 生成类而非 GenericRecord
props.put("specific.avro.reader", true);

try (Consumer<String, Order> consumer = new KafkaConsumer<>(props)) {
    consumer.subscribe(List.of("orders"));
    while (true) {
        for (ConsumerRecord<String, Order> record : consumer.poll(Duration.ofSeconds(1))) {
            Order order = record.value();
            System.out.println(order.getOrderId() + " -> " + order.getAmount());
        }
    }
}
```

## 6. 生产环境的三条硬规则

以下三条是被大量线上事故沉淀出来的强约束（[Confluent Best Practices](https://www.confluent.io/blog/best-practices-for-confluent-schema-registry/)）：

**规则一：关闭 producer 侧自动注册。**

默认 `auto.register.schemas=true` 允许 producer 首次 send 时自动向 Registry 注册新版本。开发期方便，生产期灾难——任何一个新版本代码上线都会自动改变契约。改成：

```properties
auto.register.schemas=false
use.latest.version=true  # 生产者一律用最新已注册版本
```

Schema 注册改由 CI/CD（如 Confluent Schema Registry Maven Plugin）在合并 PR 时执行。

**规则二：启用 Schema Normalization。**

```properties
normalize.schemas=true
```

或在 Registry 全局配置里 `PUT /config { "normalize": true }`。它会把语义等价、语法不同的 schema（例如 JSON 字段顺序不同、Protobuf import 顺序不同、Avro 命名空间的短名 vs 全限定名）归为同一版本，避免产生大量语义重复的 version。

**规则三：Registry 集群 ≥ 2 节点。**

Registry 内部通过一个特殊 Topic `_schemas`（compact + 单分区）达成一致。集群多节点部署时通过 Kafka leader election 选举主节点，只有主节点接收写请求，其它节点转发。至少两个节点才能在滚动升级或宕机时不中断服务。

## 7. 与本目录其他章节的关系

- 各种序列化格式的字节层差异 → [§2 序列化格式对比](./chapter-02-serializers.md)
- BACKWARD / FORWARD / FULL 策略如何影响升级顺序 → [§4 Schema 演进与兼容性](./chapter-04-schema-evolution.md)
