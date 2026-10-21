# Kafka Connect 概览

## 1. 什么是 Kafka Connect

Kafka Connect 是 Kafka 提供的数据集成框架，用于在 Kafka 与外部系统之间传输数据：

- Source Connector：从外部系统读取数据到 Kafka
- Sink Connector：从 Kafka 写入数据到外部系统

```text
Source: 外部系统 ──► Source Task ──► Kafka Topic
Sink:   Kafka Topic ──► Sink Task ──► 外部系统
```

## 2. 核心概念

| 概念 | 说明 |
| :-- | :-- |
| Connector | 连接器，定义数据源/目标 |
| Task | 任务，实际执行数据传输 |
| Worker | 工作节点，运行 Task |
| Converter | 转换器，序列化/反序列化 |

四者承担不同职责，不是并列关系：

- **Connector 是声明，Task 是执行**。Connector 负责校验配置、决定拆成多少个 Task、为每个 Task 生成参数；真正的数据搬运由 Task 完成。一个 Connector 对应多个 Task，Task 是 Distributed 模式下分布到 Worker 执行的任务单位。
- **Worker 运行 Connector 和 Task**。Distributed 模式下多个 Worker 组成集群，Task 被调度到不同 Worker；哪个 Worker 挂了，它身上的 Task 会被重新调度到存活节点。
- **Converter 负责数据格式转换**，处理 Kafka 消息与 Connect 内部数据表示之间的序列化与反序列化。

`tasks.max` 决定一个 Connector 最多能拆出多少个 Task，而不是实际并行度：

```txt
tasks.max = 一个 Connector 最多能拆出多少个 Task
实际 Task 数量 = min(tasks.max, 数据源可切分的份数)
```

以 Confluent JDBC Source 为例：按表读取且未配置自定义 query 时，4 张表即使 `tasks.max=8` 最多也只能拆出 4 个 Task——Connector 按表切分任务，表数量就是可切分份数。把 `tasks.max` 设得比可切分份数还大，多余的任务容量不会被利用；`tasks.max=1` 则无论数据源有多少份都只能串行。

不过「可切分的份数」由 Connector 实现决定，不同 Connector 差异很大：有些按表或文件切分，有些根本不支持拆分。调整 `tasks.max` 前，应先确认所用 Connector 支持怎样的任务拆分。

Converter 的选型与 Schema 管理详见 [Schema 与序列化](../02-core/chapter-06-schema-and-serialization.md)。

## 3. Standalone vs Distributed

| 对比项 | Standalone | Distributed |
| :-- | :-- | :-- |
| 运行方式 | 单个 Worker 进程 | 多个 Worker 组成集群 |
| Connector 配置 | 通常通过本地配置文件传入 | 通常通过 REST API 管理 |
| 偏移量存储 | 本地文件 | Kafka 内部 Topic |
| 任务调度与故障恢复 | 不具备集群级任务重新分配 | Task 可在 Worker 间重新分配 |
| 常见用途 | 开发测试、简单采集 | 生产环境 |

两种运行模式都提供 REST API。Distributed 模式通常用它管理 Connector，Standalone 模式则通常在启动时通过配置文件传入 Connector。

```bash
# Standalone：配置文件 connect-standalone.properties
bootstrap.servers=localhost:9092
key.converter=org.apache.kafka.connect.json.JsonConverter
value.converter=org.apache.kafka.connect.json.JsonConverter
offset.storage.file.filename=/tmp/connect.offsets

connect-standalone.sh connect-standalone.properties my-connector.properties
```

```bash
# Distributed：配置文件 connect-distributed.properties
bootstrap.servers=localhost:9092
group.id=connect-cluster
config.storage.topic=connect-configs
offset.storage.topic=connect-offsets
status.storage.topic=connect-status

connect-distributed.sh connect-distributed.properties

# 通过 REST API 创建 Connector（config 为占位，完整 JSON 见第 4 节）
curl -X POST http://localhost:8083/connectors \
    -H "Content-Type: application/json" \
    -d '{"name": "my-connector", "config": {...}}'
```

## 4. 配置示例

下面以 Confluent JDBC Source Connector 为例，把 MySQL 的 users 表写入 Kafka。示例假设表中存在严格递增的整数列 id，数据库认证与 JDBC 驱动已配置：

```json
{
  "name": "jdbc-source",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
    "connection.url": "jdbc:mysql://localhost:3306/mydb",
    "connection.user": "connect_user",
    "connection.password": "change-me",
    "table.whitelist": "users",
    "mode": "incrementing",
    "incrementing.column.name": "id",
    "topic.prefix": "jdbc-"
  }
}
```

`incrementing` 模式依赖严格递增的整数列，只发现新增行，不检测已有行的更新或删除。如需检测更新，应根据表结构考虑 `timestamp` 或 `timestamp+incrementing` 模式；其中 `timestamp` 依赖时间戳列在更新时同步变化，且时间戳不唯一时可能遗漏记录。`table.whitelist` 是 Confluent JDBC Source 插件的特有配置，不是所有 Connector 的通用配置。

## 5. Connector 状态与故障处理

Kafka Connect 通过 REST API 暴露 Connector 与 Task 的运行状态。状态不是固定的流转顺序，而是运行过程中可能出现的不同状态：

- RUNNING：正在运行。
- PAUSED：已暂停，可通过恢复操作继续运行。
- FAILED：运行失败，需查看错误信息排查原因。
- RESTARTING：正在重启，具体可见状态以目标 Kafka 版本为准。

Connector 与 Task 的状态需分别检查，Connector 处于 RUNNING 不代表其所有 Task 都正常。查询状态：

```bash
curl http://localhost:8083/connectors/my-connector/status
```

排查失败时，先看返回的错误信息，再决定修复配置或外部依赖，还是重启 Connector 或 Task。

## 6. 关键配置参数

| 参数 | 作用域 | 说明 | 默认值 |
| :-- | :-- | :-- | :-- |
| tasks.max | Connector | 最大任务数 | 1 |
| connector.class | Connector | 连接器实现类 | - |
| key.converter | Worker | Key 转换器 | org.apache.kafka.connect.json.JsonConverter |
| value.converter | Worker | Value 转换器 | org.apache.kafka.connect.json.JsonConverter |
| errors.tolerance | Worker | 错误容忍级别 | none |
| errors.deadletterqueue.topic.name | Worker | 死信队列 Topic | - |

Converter 默认使用 `org.apache.kafka.connect.json.JsonConverter`，是否携带 Schema 还取决于 `schemas.enable`。部分 Worker 级配置可被 Connector 同名配置覆盖，但并非所有配置项都支持，具体以所用 Kafka 版本为准。
