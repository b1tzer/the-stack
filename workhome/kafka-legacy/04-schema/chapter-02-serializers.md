# 序列化格式对比：Avro / Protobuf / JSON Schema

三种格式都能配合 Schema Registry 使用，但设计取向差异明显。选型不是看谁"最先进"，而是看你的团队原本在用什么、优先解决哪一类问题。

## 1. Avro：Kafka 生态的默认选择

Avro 是 Apache 基金会的项目，从 Hadoop 生态起源，被 Confluent 深度绑定进 Kafka 生态。

### 1.1 字节布局

一份 Avro 二进制消息**只包含数据**，不含字段名。反序列化时必须同时拥有写入 schema（writer schema）与读取 schema（reader schema）——Registry 恰好承担了"用 schema id 找到 writer schema"这一步。

编码规则要点：

- 整型用 [ZigZag 变长编码](https://avro.apache.org/docs/1.11.1/specification/#binary-encoding)，小数值只占 1 字节
- 字符串前置长度（变长），再跟 UTF-8 字节
- 记录（record）按字段顺序拼接，无字段名、无分隔符
- 联合类型（union）前置 1 字节的类型索引

例如 `Order{orderId: 100, amount: 99.5, email: null}`：

```txt
orderId (long, ZigZag)  : 0xC8 0x01           // 100 → 200 → 2 bytes
amount  (double, IEEE)  : 8 bytes
email   (union, null=0) : 0x00                // 1 byte
Total                                          ≈ 11 bytes
```

### 1.2 优势与代价

优势集中在三点：

- **紧凑**。相同数据下比 JSON 小 3–5 倍，比 Protobuf 略大或相当。
- **Schema Evolution 规则最完备**。Avro spec 明确规定了 reader/writer schema 之间的每种 resolution，包括默认值、别名（alias）、类型提升（int → long → float → double）。
- **不需要预编译**。运行时可以用 `GenericRecord` 读写任意 schema，也可以用 avro-maven-plugin 生成 `SpecificRecord`。

代价也集中在三点：

- **可读性差**。字节流里没有字段名，脱离 schema 无法解析。生产事故排查时不能直接 `hexdump | grep`。
- **必须联网**。反序列化端必须能连到 Schema Registry 或本地缓存 schema，否则彻底解析不出。
- **对 IDL 支持一般**。Avro 有自己的 `.avsc`（JSON 语法），也有 `.avdl`（IDL 语法），但普及度都不如 Protobuf 的 `.proto`。

### 1.3 典型选型场景

新建 Kafka pipeline、下游有 Flink / Spark / 数据湖入湖需求，团队没有既有 IDL 约束时，Avro 是默认答案。Confluent 官方教程与示例几乎清一色用 Avro。

## 2. Protobuf：gRPC 生态的天然复用

Google Protocol Buffers 在 Kafka Schema Registry 从 5.5 起获得原生支持。

### 2.1 字节布局

Protobuf 每个字段前置一个 `tag`（field number 与 wire type 打包成 varint），再跟字段值。这意味着：

- **有 field number 就有字段身份**。字段名可以随便改（对线上无影响），字段位置也无所谓，但 field number 不能重复利用。
- **未知字段可以透传**。老版本 reader 读到新字段直接跳过，天生前向兼容友好。
- **所有字段可选**（proto3 起）。删除字段等同于不再发送，语义清晰。

同样的 Order 消息用 Protobuf 编码约 12–14 字节，与 Avro 接近。

### 2.2 兼容性规则（相对宽松）

Confluent 文档明确列出的 Protobuf 兼容变换（[Compatibility checks](https://docs.confluent.io/platform/current/schema-registry/fundamentals/serdes-develop/index.html)）包括：

- 字段可增可减；field number 一旦分配不可复用
- `int32/uint32/int64/uint64/bool` 之间在同一 field number 上可互换
- `sint32 ↔ sint64`、`fixed32 ↔ sfixed32`、`fixed64 ↔ sfixed64`、`string ↔ bytes` 均可互换
- 单值字段可以升级成 `oneof` 的一个成员

这种宽松是 Protobuf 的哲学——它把"如何演进"更多地交给 field number 这一稳定 ID，而不是像 Avro 那样通过 reader/writer schema resolution 做严格类型匹配。

### 2.3 典型选型场景

团队原本就有 gRPC 服务、`.proto` 文件在多语言之间共享时，Kafka 侧复用 Protobuf 可以省掉一份 IDL、一次 code generation、一套代码。字节紧凑度与 Avro 打平。

## 3. JSON Schema：可读性优先的兜底方案

JSON Schema 用 JSON 文件描述 JSON 数据的结构。Kafka Schema Registry 从 5.5 起支持。

### 3.1 特点

- **消息体仍然是 JSON 文本**。字段名、结构层次都在字节里，可直接 `kafka-console-consumer.sh` 看。
- **体积最大**。相同数据比 Avro / Protobuf 大 3–5 倍。
- **兼容性判定最复杂**。JSON Schema 的类型系统（`allOf` / `anyOf` / `oneOf` / `additionalProperties`）本身语义就重，兼容性规则最不直观。

### 3.2 典型选型场景

- 消息需要被前端 / 浏览器直接消费，或需要在网关做人工可读的调试
- 已经有 OpenAPI / JSON Schema 定义（例如 REST API 的请求响应结构直接进入 Kafka）
- 团队对二进制序列化不熟，宁可牺牲带宽换可读性

## 4. 三者横向对比

| 维度 | Avro | Protobuf | JSON Schema |
| :-- | :-- | :-- | :-- |
| 消息体形态 | 二进制（无字段名） | 二进制（有 tag，无字段名） | 文本 JSON |
| 相对体积（同数据） | 1.0× | 1.0×–1.1× | 3–5× |
| 演进机制 | Reader/Writer schema resolution | Field number 稳定 ID | JSON Schema 组合规则 |
| 兼容性规则 | 最严格、最完备 | 宽松（field number 主导） | 复杂 |
| 是否需要 schema 才能反序列化 | 是 | 否（但类型信息缺失） | 否 |
| IDL 语法 | `.avsc` (JSON) / `.avdl` | `.proto` | `.json` |
| 代码生成 | 可选（`GenericRecord` 免代码生成） | 强制或半强制 | 可选 |
| Confluent 支持起始版本 | 一开始就有 | 5.5+ | 5.5+ |
| 生态深度（Kafka 侧） | 最深，官方教程默认 | 中等 | 较浅 |

数据来源：[Confluent Formats, Serializers, and Deserializers](https://docs.confluent.io/platform/current/schema-registry/fundamentals/serdes-develop/index.html)、[Avro 1.11 Specification](https://avro.apache.org/docs/1.11.1/specification/)。

## 5. 一个决策清单

面对新项目时的选型问题，可以走这条最短路径：

1. 团队已有 `.proto` 文件、`.proto` 生成的类在多语言复用？→ **Protobuf**。
2. 需要在网关 / 前端直接看 / 改 JSON，或强调可读性？→ **JSON Schema**。
3. 其余情况，尤其是要接入 Flink / Spark / 数据湖？→ **Avro**。

::: warning 一个 Topic 只用一种格式
Schema Registry 允许**不同 Topic 使用不同格式**，但**同一 Topic 内部**必须用同一种格式——序列化时 magic byte 之后的字节结构无法在 Avro / Protobuf / JSON 之间自动区分。中途切换格式意味着新开 Topic。
:::
