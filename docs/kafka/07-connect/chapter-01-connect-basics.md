# Kafka Connect 概览

## 1. 什么是 Kafka Connect

- 数据集成框架
- Source Connector：从外部系统读取数据到 Kafka
- Sink Connector：从 Kafka 写入数据到外部系统

## 2. 核心概念

| 概念 | 说明 |
|------|------|
| Connector | 连接器，定义数据源/目标 |
| Task | 任务，实际执行数据传输 |
| Worker | 工作节点，运行 Task |
| Converter | 转换器，序列化/反序列化 |

## 3. Standalone vs Distributed

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| Standalone | 单节点 | 开发测试 |
| Distributed | 多节点 | 生产环境 |

## 4. 配置示例

```json
{
  "name": "jdbc-source",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
    "connection.url": "jdbc:mysql://localhost:3306/mydb",
    "table.whitelist": "users",
    "mode": "incrementing",
    "incrementing.column.name": "id",
    "topic.prefix": "jdbc-"
  }
}
```

## 5. Connect 工作原理

```
Source Connector:
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ 外部系统     │───►│ Source      │───►│ Kafka       │
│ (MySQL/ES)  │    │ Task        │    │ Topic       │
└─────────────┘    └─────────────┘    └─────────────┘

Sink Connector:
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Kafka       │───►│ Sink        │───►│ 外部系统     │
│ Topic       │    │ Task        │    │ (MySQL/ES)  │
└─────────────┘    └─────────────┘    └─────────────┘
```

## 6. Connector 生命周期

```
创建 Connector → STARTED → 运行中
    │
    ├── PAUSED → 暂停（可恢复）
    │
    ├── FAILED → 失败（需要重启）
    │
    └── RESTARTING → 自动重启（配置 restart.on.failure=true）
```

## 7. 关键配置参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| tasks.max | 最大任务数 | 1 |
| connector.class | 连接器类名 | - |
| key.converter | Key 转换器 | StringConverter |
| value.converter | Value 转换器 | StringConverter |
| errors.tolerance | 错误容忍级别 | none |
| errors.deadletterqueue.topic.name | 死信队列 Topic | - |

## 8. Standalone vs Distributed 模式详解

### 8.1 Standalone 模式
```bash
# 配置文件：connect-standalone.properties
bootstrap.servers=localhost:9092
key.converter=org.apache.kafka.connect.json.JsonConverter
value.converter=org.apache.kafka.connect.json.JsonConverter
offset.storage.file.filename=/tmp/connect.offsets

# 启动
connect-standalone.sh connect-standalone.properties my-connector.properties
```

### 8.2 Distributed 模式
```bash
# 配置文件：connect-distributed.properties
bootstrap.servers=localhost:9092
group.id=connect-cluster
config.storage.topic=connect-configs
offset.storage.topic=connect-offsets
status.storage.topic=connect-status

# 启动
connect-distributed.sh connect-distributed.properties

# 通过 REST API 创建 Connector
curl -X POST http://localhost:8083/connectors \
    -H "Content-Type: application/json" \
    -d '{"name": "my-connector", "config": {...}}'
```

## 9. 最佳实践

1. **生产环境使用 Distributed 模式**：支持高可用、负载均衡、动态扩展。
2. **合理设置 tasks.max**：通常等于源/目标系统的分区数或表数。
3. **配置死信队列**：处理失败的消息不会阻塞 Connector，而是发送到死信队列。
4. **监控 Connector 状态**：使用 REST API 或 JMX 监控 Connector 和 Task 的运行状态。
