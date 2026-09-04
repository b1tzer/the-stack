# Schema 与序列化

> Kafka Broker 只认字节数组。生产者发出去的 `byte[]` 和消费者收到的 `byte[]` 之间是否属于同一种"格式"，Broker 完全不管。这层责任被交给了两端应用。问题是：当几十个团队共用一个 Topic，谁来保证大家发的消息格式一致？

## 1. "字符串 + JSON"为什么撑不住生产环境

几乎所有入门教程都用 `StringSerializer` 把 JSON 塞进 Kafka。原型阶段没问题，但生产环境会逐个暴露三个硬伤：

**无结构校验**。生产者今天写 `amount: 100`（整数），明天改成 `amount: "100"`（字符串），消费者侧的 `Integer.parseInt` 直接挂掉。Broker 不会拦——它只看到一堆字节，不知道也不关心这堆字节代表什么。

**体积浪费**。JSON 是自描述格式——每条消息都要把字段名 `"orderId":`、`"customerName":` 一起传过去。一个 20 字段的订单消息，40% 的字节花在字段名上。这些重复的字节会累积到磁盘存储、跨机房带宽、消费者 Fetch 延迟三个地方。

**无版本管理**。"上周谁把 `email` 字段删了？"——这个问题在 JSON 世界里没有工具能回答。没有版本号，没有兼容性检查，出了问题只能翻日志倒推。

## 2. Schema：把契约从代码里抽出来

Schema 是一份**独立于代码的消息结构定义**。以 Avro 为例：

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

这份 `.avsc` 文件有三重身份：

**契约**：生产者和消费者对着同一份定义写代码。生产者不能私自加字段，消费者不能假设字段一定存在。

**序列化格式**：`amount` 是 double 就用固定 8 字节写入，不需要把字段名 `amount` 也塞进消息体。三个字段的 Order 用 Avro 大约 20 字节，等价 JSON 大约 60 字节。

**演进规则的判断依据**：新增字段带 `default` 值就向后兼容，去掉字段就要看兼容策略。兼容性不再是"靠约定"，而是"靠工具强制检查"。

## 3. Schema Registry：把契约放进服务端

只有 Schema 文件不够。多个团队各自维护 `.avsc` 文件会很快失控——版本互相不认、字段冲突、演进无规则。

Schema Registry 是一个独立于 Broker 的 REST 服务进程。它自身不维护独立数据库——schema 数据存在 Kafka 内部主题 `_schemas`（单分区、log-compacted）里，Registry 既是该主题的生产者又是消费者。进程独立于 Broker，存储仍依赖 Kafka。它做三件事：

**存储与版本化**：每个 Topic 的每个版本 Schema 都被登记，分配全局唯一 ID。你注册了 v1、v2、v3，Registry 都记得。

**兼容性校验**：新版本注册前，按预设策略自动检查。如果 v3 和 v2 不兼容（比如删了一个没有 default 值的字段），注册直接拒绝。这把"兼容性"从靠人工 review 变成了靠工具强制。

**运行期分发**：消息只带 4 字节 Schema ID，消费者拿到 ID 后向 Registry 拉取 Schema 用于反序列化。Schema 本身不随消息传输——省空间，也避免了版本不一致。

```txt
消息的字节结构（Confluent Wire Format）：
Byte 0        : Magic Byte, 固定 0x00
Byte 1..4     : Schema ID (int32, big-endian)
Byte 5..end   : Avro/Protobuf/JSON binary payload
```

## 4. 三种格式怎么选

| 格式 | 为什么选它 | 为什么不选它 |
| :-- | :-- | :-- |
| Avro | 二进制最紧凑、Schema 演进支持最好、Kafka 生态首选 | 需要 Schema Registry |
| Protobuf | 二进制紧凑、语言中立、gRPC 生态天然对齐 | 不是 Kafka 原生生态 |
| JSON Schema | 人眼可读、生态最广、不需要额外工具 | 体积大、性能差 |

**选型准则**：新建 Kafka pipeline 且没有约束时优先 Avro。已有 Protobuf 定义（gRPC 服务、内部 IDL）则复用。只有必须"人眼可读"或与前端直接对接时才选 JSON Schema。

## 5. Schema 演进：怎么改才不翻车

Schema 不是一成不变的。业务发展，字段会增删改。问题是：怎么改才不会让已有的消费者挂掉？

| 策略 | 含义 | 谁先升级 |
| :-- | :-- | :-- |
| BACKWARD | 新 Schema 能读旧数据 | 消费者先升级 |
| FORWARD | 旧 Schema 能读新数据 | 生产者先升级 |
| FULL | 双向兼容 | 任意顺序 |

**BACKWARD 与 FORWARD 的方向正好相反，升级顺序也因此不同。**

- **BACKWARD（新 Schema 读旧数据）**：新 Schema 新增了带 `default` 的字段，旧生产者还在发旧数据，新消费者用新 Schema 读旧数据时，用 `default` 填上缺失的新字段。所以**消费者先升级**。
- **FORWARD（旧 Schema 读新数据）**：生产者先升级、开始发带新字段的数据，旧消费者用旧 Schema 读时，忽略它不认识的新字段。所以**生产者先升级**。
- **FULL**：同时满足上面两者，任意顺序升级。

**怎么实现兼容？** 新增字段带 `default` 值即可：旧数据反序列化时，缺失的新字段用 `default` 填（满足 BACKWARD）；旧 Schema 读新数据时，新字段被忽略（满足 FORWARD）。因此「新增带 `default` 的字段」天然满足 FULL，是最安全的演进方式。删除字段几乎总是破坏兼容，需谨慎评估。

## 6. 实际使用：从依赖到收发消息

前几章讲清了「为什么」和「是什么」，这一章把链路串起来。完整流程分四步：引入依赖 → 定义 Schema 并生成类 → 写生产者 → 写消费者。

### 6.1 引入依赖

`kafka-avro-serializer` 由 Confluent 发布，不在 Maven Central，需要额外声明 Confluent 仓库：

```xml
<repositories>
  <repository>
    <id>confluent</id>
    <url>https://packages.confluent.io/maven/</url>
  </repository>
</repositories>

<dependencies>
  <dependency>
    <groupId>org.apache.avro</groupId>
    <artifactId>avro</artifactId>
    <version>1.11.3</version>
  </dependency>
  <dependency>
    <groupId>io.confluent</groupId>
    <artifactId>kafka-avro-serializer</artifactId>
    <version>7.5.0</version>
  </dependency>
</dependencies>
```

### 6.2 定义 Schema 并生成 Java 类

把第 2 章的 `Order.avsc` 放到 `src/main/avro/`，用 `avro-maven-plugin` 在编译期把它生成类型安全的 `Order.java`：

```xml
<build>
  <plugins>
    <plugin>
      <groupId>org.apache.avro</groupId>
      <artifactId>avro-maven-plugin</artifactId>
      <version>1.11.3</version>
      <executions>
        <execution>
          <phase>generate-sources</phase>
          <goals><goal>schema</goal></goals>
          <configuration>
            <sourceDirectory>${project.basedir}/src/main/avro</sourceDirectory>
            <outputDirectory>${project.basedir}/target/generated-sources/avro</outputDirectory>
          </configuration>
        </execution>
      </executions>
    </plugin>
  </plugins>
</build>
```

执行 `mvn generate-sources` 后得到 `Order` 类，之后用它的 builder 构造消息，字段类型在编译期就被 Schema 约束住了。

### 6.3 生产者：写 Avro 消息

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("key.serializer", "io.confluent.kafka.serializers.KafkaAvroSerializer");
props.put("value.serializer", "io.confluent.kafka.serializers.KafkaAvroSerializer");
props.put("schema.registry.url", "http://localhost:8081");

try (KafkaProducer<String, Order> producer = new KafkaProducer<>(props)) {
    Order order = Order.newBuilder()
        .setOrderId(1001L)
        .setAmount(99.9)
        .build();
    producer.send(new ProducerRecord<>("orders", order));
}
```

发送时 `KafkaAvroSerializer` 会做两件事：向 Registry 注册 `Order` 的 Schema 拿回 ID，然后把「4 字节 ID + Avro 二进制」写进消息。

### 6.4 消费者：读 Avro 消息

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "order-group");
props.put("key.deserializer", "io.confluent.kafka.serializers.KafkaAvroDeserializer");
props.put("value.deserializer", "io.confluent.kafka.serializers.KafkaAvroDeserializer");
props.put("schema.registry.url", "http://localhost:8081");
props.put("specific.avro.reader", true);

try (KafkaConsumer<String, Order> consumer = new KafkaConsumer<>(props)) {
    consumer.subscribe(Collections.singletonList("orders"));
    while (true) {
        for (ConsumerRecord<String, Order> record : consumer.poll(Duration.ofMillis(100))) {
            Order order = record.value();
            System.out.println(order.getOrderId() + " -> " + order.getAmount());
        }
    }
}
```

### 6.5 两个关键配置项

| 配置项 | 作用 | 说明 |
| :-- | :-- | :-- |
| `schema.registry.url` | Registry 地址 | 生产、消费两端都要配 |
| `specific.avro.reader` | 反序列化是否用生成类 | `true` 返回 `Order` 类型（Specific）；`false` 返回 `GenericRecord`，适合 Schema 动态变化、不想维护生成类的场景 |
