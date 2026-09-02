# Schema 演进与兼容性

> 前置知识：[§3 Schema Registry 原理与 API](./chapter-03-schema-registry.md) 已讲清 Registry 的存储与 REST。本文只关注一个问题——**新版本的 Schema 是否能被安全注册，客户端要不要按顺序升级**。

一句话总结：**兼容性策略决定了"谁读得懂谁"，进而决定了 producer 和 consumer 的升级顺序。** 选错策略会在灰度发布时让线上大面积报 SerializationException。

## 1. 七种兼容性模式

Confluent Schema Registry 支持 7 种模式，全部见 [Compatibility concepts](https://docs.confluent.io/platform/current/schema-registry/develop/api.html)：

| 模式 | 校验对象 | 语义 |
| :-- | :-- | :-- |
| **BACKWARD**（默认） | 与**最新**已注册版本 | 新 schema 的**消费者**能读**旧 schema 的数据** |
| **BACKWARD_TRANSITIVE** | 与**所有**已注册版本 | 新 schema 的消费者能读所有历史数据 |
| **FORWARD** | 与最新已注册版本 | 旧 schema 的消费者能读**新 schema 的数据** |
| **FORWARD_TRANSITIVE** | 与所有已注册版本 | 所有历史 schema 的消费者都能读新数据 |
| **FULL** | 与最新已注册版本 | 同时满足 BACKWARD + FORWARD |
| **FULL_TRANSITIVE** | 与所有已注册版本 | 同时满足两种 TRANSITIVE |
| **NONE** | 不校验 | 关闭 |

**理解主 / 传递（transitive）差异的关键**：非 transitive 只保证 v1 ↔ v2、v2 ↔ v3 相邻兼容，不保证 v1 ↔ v3。相邻的多次"合法演进"叠起来后不一定还兼容——这是生产上常被忽略的坑。

Confluent 官方默认 `BACKWARD`（非 transitive），保守但存在这个"跨版本可能不兼容"的隐患。团队协作松散时倾向选 `BACKWARD_TRANSITIVE` 或 `FULL_TRANSITIVE`。

## 2. 三种主模式的规则（以 Avro 为例）

Avro 的兼容性规则出自 Avro Spec 的 [Schema Resolution](https://avro.apache.org/docs/1.11.1/specification/#schema-resolution)。它是 Confluent Schema Registry 判定的直接依据。

### 2.1 BACKWARD：可以做什么

**允许的变更**：

- **删除字段**（无论有无默认值）
- **添加带默认值的字段**

**禁止的变更**：

- 添加**没有**默认值的字段
- 修改字段名（除非用 alias 记录旧名）
- 修改字段类型（除非满足 Avro 的 promotion 规则：int → long → float → double、string ↔ bytes）

**为什么允许"删字段"**：新 consumer 读到旧数据里的字段，直接忽略就行。新 consumer 读到新数据里的字段——因为字段被删了，根本不会读。

**为什么允许"加带默认值的字段"**：新 consumer 读到旧数据（不含这个字段），用默认值填充。

### 2.2 FORWARD：可以做什么

**允许的变更**：

- **添加字段**（无论有无默认值）
- **删除带默认值的字段**

**禁止的变更**：

- 删除没有默认值的字段

**为什么允许"加字段"**：旧 consumer 读到新数据里的新字段——旧代码根本不认这个字段，直接跳过。

**为什么允许"删带默认值的字段"**：旧 consumer 读到新数据里没有这个字段，用旧 schema 里的默认值填充。

### 2.3 FULL：两者的交集

FULL = BACKWARD ∩ FORWARD。允许的变更只有一种：

- **添加带默认值的字段**
- **删除带默认值的字段**

其他都不行。这是最严格的策略，好处是**producer 和 consumer 可以任意顺序升级**（详见 §3）。

### 2.4 三者对照表

数据来源：[Confluent Testing Schema Compatibility](https://developer.confluent.io/courses/schema-registry/schema-compatibility/) + [DeepWiki: Schema Evolution and Compatibility](https://deepwiki.com/confluentinc/schema-registry/7-schema-evolution-and-compatibility)。

| 变更类型 | BACKWARD | FORWARD | FULL |
| :--: | :--: | :--: | :--: |
| 添加带默认值的字段 | ✅ | ✅ | ✅ |
| 添加无默认值的字段 | ❌ | ✅ | ❌ |
| 删除带默认值的字段 | ✅ | ✅ | ✅ |
| 删除无默认值的字段 | ✅ | ❌ | ❌ |
| 修改字段名 | ❌ | ❌ | ❌ |
| 类型 promotion（int→long 等） | 视具体类型 | 视具体类型 | 视具体类型 |

::: warning 改字段名的正确做法
Avro 的 alias 可以让新 schema 用新名字读旧数据里的旧字段：`{"name": "email", "aliases": ["e_mail"], "type": "string"}`。但 alias 只是"读端"技巧，不改变字节结构——真正规避方案是**两次演进**：先加新字段（带默认值），迁移完再删旧字段。
:::

## 3. 客户端升级顺序：策略决定谁先动

选定策略之后，客户端升级顺序有硬性约束。搞错顺序 = 线上崩。

| 策略 | 升级顺序 | 原因 |
| :-- | :-- | :-- |
| **BACKWARD** / BACKWARD_TRANSITIVE | **先升级所有 Consumer，再升级 Producer** | 新 consumer 才能读旧 schema 数据；旧 consumer 读新 schema 数据可能崩 |
| **FORWARD** / FORWARD_TRANSITIVE | **先升级所有 Producer，再升级 Consumer** | 旧 consumer 才能读新数据；反之新 consumer 读旧数据可能崩 |
| **FULL** / FULL_TRANSITIVE | **任意顺序** | 双向兼容，独立升级 |
| **NONE** | **自行协调** | 无护栏 |

数据来源：[Schema Evolution and Compatibility](https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html)。

::: warning Kafka Streams 只支持 BACKWARD 系
Confluent 明确规定：Kafka Streams 应用**只能用 BACKWARD、BACKWARD_TRANSITIVE、FULL、FULL_TRANSITIVE**，不能用 FORWARD 系。原因是 Streams 应用会读自己的 state store / changelog——那里存的是**旧数据**，新版本 Streams 必须能读旧数据，即必须 backward。
:::

## 4. 一个真实演进案例

以 Order schema 从 v1 → v2 → v3 为例，策略选 `BACKWARD`。

**v1 初始**：

```json
{
  "type": "record", "name": "Order",
  "fields": [
    {"name": "orderId", "type": "long"},
    {"name": "amount",  "type": "double"}
  ]
}
```

**v2 加邮箱**：合法（新字段带 default）

```json
{
  "type": "record", "name": "Order",
  "fields": [
    {"name": "orderId", "type": "long"},
    {"name": "amount",  "type": "double"},
    {"name": "email",   "type": ["null", "string"], "default": null}
  ]
}
```

**v3 删 amount**：BACKWARD 允许（删字段合法），演进通过：

```json
{
  "type": "record", "name": "Order",
  "fields": [
    {"name": "orderId", "type": "long"},
    {"name": "email",   "type": ["null", "string"], "default": null}
  ]
}
```

看似都合法，但如果策略是 `BACKWARD`（非 transitive）而不是 `BACKWARD_TRANSITIVE`：

- v1 → v2：合法（v2 consumer 能读 v1 数据）
- v2 → v3：合法（v3 consumer 能读 v2 数据）
- **v1 → v3：不一定合法**——Registry 不会拦。如果 topic 里还留着 v1 时代的数据，新部署的 v3 consumer 读到时会因为 `amount` 字段在 writer schema 里、reader schema 里没有而**能读**（Avro 会忽略 writer 有 reader 没有的字段），但反过来如果 v1 时代的数据里没有 `email` 字段而 v3 reader 期望有——`email` 有 default，也能读。这个例子刚好安全。

真正踩坑的场景是**修改类型 + 中间版本作跳板**：

- v1: `age: int`
- v2: `age: long`（类型 promotion，BACKWARD 允许）
- v3: `age: string`（v2 → v3 兼容？long ↛ string，不合法）

Registry 会拦 v2 → v3。但如果先 v1 → v3 直接改，Registry 只对最新版本 v1 做校验，也一样拦。所以这个例子还是安全的。

真正会漏的是**"渐进式"改动，每一步都合法，累计起来出问题**——例如反复添加/删除字段导致数据里存在多种历史结构，跨版本的联合语义。此时 `BACKWARD_TRANSITIVE` 会拦下这一步、非 transitive 不会。

## 5. 三个实操建议

1. **默认选 BACKWARD_TRANSITIVE 而非 BACKWARD**。多一次全历史校验，性能开销可忽略，能规避"每一步都合法，跨版本不兼容"的隐患。
2. **在 CI 拦兼容性问题，别把 Registry 当唯一防线**。用 Schema Registry Maven Plugin 或 REST `POST /compatibility/subjects/{subject}/versions/latest` 在 PR 阶段校验，失败直接阻断合并。
3. **发布顺序写进 runbook**。选 BACKWARD 就在部署 SOP 里写"先升级消费者"，选 FORWARD 就写"先升级生产者"。灰度顺序错了、又赶上流量高峰的时候，故障恢复窗口以分钟计。

::: tip 一份完整的选型建议
- 单团队维护的内部 topic → **FULL_TRANSITIVE**（最严格，客户端升级最自由）
- 跨团队、消费者众多的公共 topic → **BACKWARD_TRANSITIVE**（保护存量消费者不崩）
- 只有单一消费者、生产者控制严的场景 → **FORWARD_TRANSITIVE**（生产者先升）
- Kafka Streams 应用 → **BACKWARD** 系（Confluent 强制）
- 完全没有 schema 治理需求 → **不用 Schema Registry**，别用 NONE
:::
