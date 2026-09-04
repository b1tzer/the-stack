# Schema 与序列化概览

Kafka Broker 只关心字节数组。Producer 发出去的 `byte[]`、Consumer 收到的 `byte[]` 之间是否属于同一种"格式"，Kafka 不做任何检查。这层责任被完整地交给了两端应用。

于是就有了两个几乎每个 Kafka 使用者都会遇到的问题：

- 生产者今天多写了一个字段、明天改了字段类型，消费者第二天启动时 `NullPointerException` 或 `ClassCastException`。
- 一个 Topic 被几十个下游订阅，谁都没有权威的"消息长什么样"的文档；出了问题就靠翻线上日志倒推字段。

这就是**数据契约（data contract）** 缺位的典型症状。Schema 与 Schema Registry 是 Kafka 生态中为解决这个问题给出的答案。

## 1. 为什么"字符串 + JSON"不够用

写演示时，几乎所有教程都用 `StringSerializer` 把 JSON 塞进 Kafka：

```java
producer.send(new ProducerRecord<>("orders", key, "{\"id\":1,\"amount\":100}"));
```

这在原型阶段没问题。生产环境的三个硬伤会逐个浮现：

**1. 无结构校验。** 生产者今天写 `amount: 100`（int），明天改成 `amount: "100"`（string），消费者一侧的 `Integer.parseInt` 挂掉。Broker 不会拦。

**2. 体积浪费。** JSON 是自描述格式，每条消息都要重复带上字段名。一个 20 字段的订单消息，其中 40% 的字节是花在 `"orderId":`、`"customerName":` 这类字符串上。跨机房带宽以及本地磁盘保留成本随之翻倍。

**3. 无版本管理。** "上周谁把 `email` 字段删了？" —— 这类问题在 JSON 世界里没有工具能回答。

## 2. Schema：把契约显式化

Schema 就是把消息结构声明成一份**独立的、可版本化的定义**。以 Avro 为例：

```json
{
  "type": "record",
  "name": "Order",
  "fields": [
    {"name": "orderId", "type": "long"},
    {"name": "amount",  "type": "double"},
    {"name": "email",   "type": ["null", "string"], "default": null}
  ]
}
```

这份 `.avsc` 具有三重身份：

- **契约**：生产者和消费者双方对着它写代码，两边都不能私自加字段、改类型。
- **序列化格式**：`amount` 是 double 就用 8 字节写入，不需要把字段名 `amount` 也塞进消息体。
- **演进规则的判断依据**：新增字段带默认值就兼容，去掉字段就要看兼容策略。

三个字段的 Order 用 Avro 二进制序列化后大约 20 字节；等价的 JSON 大约 60 字节。省下来的 2/3 会直接体现在 Broker 磁盘、跨机房带宽、Consumer Fetch 延迟三个地方。

## 3. Schema Registry：把契约放进服务端

只有 Schema 本身不够。多个团队各自维护 `.avsc` 文件会很快失控——版本互相不认、字段冲突、演进无规则。Schema Registry 是一个独立于 Broker 的服务，做三件事：

1. **存储与版本化**：每个 Topic 的每个版本 Schema 都被登记，分配全局唯一 `schema id`。
2. **兼容性校验**：新版本注册前，按预设策略（backward / forward / full）自动校验，不通过就拒绝注册。
3. **运行期分发**：消息只带 4 字节 `schema id`，消费者拿到 id 后向 Registry 拉取 Schema 用于反序列化。

序列化后的字节结构（Confluent Wire Format）：

```txt
Byte 0        : Magic Byte, 固定 0x00
Byte 1..4     : Schema ID (int32, big-endian)
Byte 5..end   : Avro/Protobuf/JSON binary payload
```

Schema 本身不随消息传输，只传 4 字节 id；Registry 用一个 compact 类型的内部 Topic `_schemas` 持久化所有 Schema，天生高可用。

数据来源：[Confluent Schema Registry Concepts](https://docs.confluent.io/platform/current/schema-registry/index.html)。

## 4. 三种序列化格式的取舍

Schema Registry 支持三种格式，各自定位不同（详见 [§2 序列化格式对比](./chapter-02-serializers.md)）：

| 格式 | 特点 | 典型场景 |
| :-- | :-- | :-- |
| **Avro** | 二进制紧凑、支持 schema evolution、Kafka 生态首选 | Kafka pipeline、数据仓库入湖 |
| **Protobuf** | 二进制紧凑、语言中立、gRPC 生态天然对齐 | 已有 gRPC 服务的团队 |
| **JSON Schema** | 文本可读、生态最广 | Web 应用、需要人肉调试的场景 |

::: tip 选型准则
新建 Kafka pipeline 且没有既有约束时优先 Avro；已有 Protobuf 定义（gRPC 服务、内部 IDL）则复用 Protobuf；只有在必须"人眼可读"或与前端直接对接时才选 JSON Schema。
:::

## 5. 完整链路

```txt
       .avsc / .proto / .json
              │
              ▼
   ┌────────────────────┐            ┌───────────────────┐
   │     Producer       │ register   │  Schema Registry  │
   │  KafkaAvroSerializer│──────────▶│   (REST + Kafka)  │
   └─────────┬──────────┘            └────────┬──────────┘
             │  {magic,id,payload}            │  {id, schema}
             ▼                                │
   ┌────────────────────┐                     │
   │      Kafka         │                     │
   │      Broker        │                     │
   └─────────┬──────────┘                     │
             │  {magic,id,payload}            │
             ▼                                │
   ┌────────────────────┐    fetch by id      │
   │     Consumer       │◀────────────────────┘
   │KafkaAvroDeserializer│
   └────────────────────┘
```

## 6. 本目录导航

| 章节 | 主题 |
| :-- | :-- |
| [§2 序列化格式对比](./chapter-02-serializers.md) | Avro / Protobuf / JSON Schema 的字节布局、性能与选型 |
| [§3 Schema Registry 原理与 API](./chapter-03-schema-registry.md) | Subject / Version / ID、REST API、Wire Format |
| [§4 Schema 演进与兼容性](./chapter-04-schema-evolution.md) | BACKWARD / FORWARD / FULL 及 Transitive 变体、客户端升级顺序 |
