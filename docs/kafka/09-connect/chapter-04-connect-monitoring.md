# Connect 监控

## 1. REST API

```bash
# 查看所有连接器
curl http://localhost:8083/connectors

# 查看连接器状态（含各 Task 的 state 与 worker_id）
curl -s http://localhost:8083/connectors/my-connector/status | jq .

# 暂停 / 恢复
curl -X PUT http://localhost:8083/connectors/my-connector/pause
curl -X PUT http://localhost:8083/connectors/my-connector/resume

# 重启特定 Task
curl -X POST http://localhost:8083/connectors/my-connector/tasks/0/restart

# 重启 Connector 及其所有 Task
curl -X POST http://localhost:8083/connectors/my-connector/restart?includeTasks=true

# 仅重启 Connector
curl -X POST http://localhost:8083/connectors/my-connector/restart
```

状态响应示例：

```json
{
  "name": "my-connector",
  "connector": {
    "state": "RUNNING",
    "worker_id": "192.168.1.100:8083"
  },
  "tasks": [
    {
      "id": 0,
      "state": "RUNNING",
      "worker_id": "192.168.1.100:8083"
    }
  ]
}
```

排查状态时，Connector 与各 Task 的状态要分别检查：Connector 显示 RUNNING 不代表所有 Task 都正常，还需结合 `worker_id` 判断任务由哪个 Worker 承载。三种重启操作的作用域不同：`tasks/0/restart` 只重启编号为 0 的任务，`restart?includeTasks=true` 同时重启连接器与其全部任务，不带参数的 `restart` 只重启连接器本身。

## 2. JMX 指标

Connect 的 JMX 指标按 Worker、Connector、Task 三个维度划分。排查时先看 Connector 与 Task 的状态，再结合 Source/Sink 的吞吐量和错误指标定位故障位置。

| 指标 | 说明 |
| :-- | :-- |
| connector-metrics 的 status | 连接器状态，取值为 unassigned、running、paused、failed、destroyed |
| connector-task-metrics 的 status | Task 状态，取值同 Connector，另含 restarting |
| connector-startup-attempts-total | Worker 启动连接器的尝试次数 |
| connector-startup-failure-total | Worker 启动连接器失败的累计次数 |
| connector-failed-task-count | 该 Worker 上该连接器失败的任务数 |
| source-record-poll-rate | Source 从外部系统拉取记录的速率 |
| source-record-write-rate | Source 转换后写入 Kafka 的速率 |
| sink-record-send-rate | Sink 发送记录的速率 |
| task-error-metrics 的 total-record-errors | 记录处理错误的累计次数 |
| task-error-metrics 的 total-record-failures | 记录处理失败的累计次数 |

## 3. Prometheus 监控

JMX Exporter 读取 Connect 的 JMX 属性，按规则转换为 Prometheus 指标。规则决定指标名称、标签和值，修改规则后应先验证实际导出结果，再编写 Grafana 查询。

```yaml
# JMX Exporter 配置文件：kafka-connect-jmx.yaml
rules:
  # Worker 累计计数指标（-total 后缀，COUNTER）
  - pattern: 'kafka\.connect<type=connect-worker-metrics><>([^:]+-total): (.*)'
    name: kafka_connect_worker_$1
    value: $2
    type: COUNTER

  # Worker 瞬时值指标（connector-count、task-count、-percentage 等，GAUGE）
  - pattern: 'kafka\.connect<type=connect-worker-metrics><>([^:]+): (.*)'
    name: kafka_connect_worker_$1
    value: $2
    type: GAUGE

  # Connector 状态：status 是字符串，不能直接作为数值样本。
  # 转为 state 标签、样本值固定为 1，Prometheus 才能查询与告警。
  - pattern: 'kafka\.connect<type=connector-metrics,connector=([^,]+)><>status: (.*)'
    name: kafka_connect_connector_status
    value: 1
    labels:
      connector: $1
      state: $2
    type: GAUGE

  # Task 状态
  - pattern: 'kafka\.connect<type=connector-task-metrics,connector=([^,]+),task=([^,]+)><>status: (.*)'
    name: kafka_connect_task_status
    value: 1
    labels:
      connector: $1
      task: $2
      state: $3
    type: GAUGE

  # Source 速率指标（-rate 后缀，GAUGE）
  - pattern: 'kafka\.connect<type=source-task-metrics,connector=([^,]+),task=([^,]+)><>([^:]+-rate): (.*)'
    name: kafka_connect_source_$3
    value: $4
    labels:
      connector: $1
      task: $2
    type: GAUGE

  # Source 累计计数指标（-total 后缀，COUNTER）
  - pattern: 'kafka\.connect<type=source-task-metrics,connector=([^,]+),task=([^,]+)><>([^:]+-total): (.*)'
    name: kafka_connect_source_$3
    value: $4
    labels:
      connector: $1
      task: $2
    type: COUNTER

  # Sink 速率指标（-rate 后缀，GAUGE）
  - pattern: 'kafka\.connect<type=sink-task-metrics,connector=([^,]+),task=([^,]+)><>([^:]+-rate): (.*)'
    name: kafka_connect_sink_$3
    value: $4
    labels:
      connector: $1
      task: $2
    type: GAUGE

  # Sink 累计计数指标（-total 后缀，COUNTER）
  - pattern: 'kafka\.connect<type=sink-task-metrics,connector=([^,]+),task=([^,]+)><>([^:]+-total): (.*)'
    name: kafka_connect_sink_$3
    value: $4
    labels:
      connector: $1
      task: $2
    type: COUNTER

  # 任务错误指标（COUNTER）
  - pattern: 'kafka\.connect<type=task-error-metrics,connector=([^,]+),task=([^,]+)><>([^:]+): (.*)'
    name: kafka_connect_task_error_$3
    value: $4
    labels:
      connector: $1
      task: $2
    type: COUNTER
```

上线前先在 Prometheus 查询页面确认指标存在，例如 `kafka_connect_connector_status`。查询不到时依次检查 JMX 是否暴露该属性、Exporter 规则是否匹配成功、Prometheus 是否成功抓取 Exporter，不要把一个未经验证的指标名当成固定默认名称。

Kafka 整体监控体系与告警实践详见 [Kafka 监控](../06-operations/chapter-01-monitoring.md)。

## 4. Grafana Dashboard 配置

下面面板分别展示 Connector 状态、Source 拉取速率和 Sink 发送速率。速率单位为记录数/秒，查询中的指标名以 Prometheus 实际采集结果为准，对 `-total` 累计计数指标用 `rate()` 计算时间窗口内的平均速率。示例中的 `graph` 是旧版面板类型，新版 Grafana 可用 `timeseries` 展示速率曲线。Connector 状态面板会为每个状态各返回一个值为 1 的样本，用于展示各状态序列；若用于告警，应判断 `state="running"` 的样本是否存在，而非把指标存在误判为连接器正常。

```json
{
  "panels": [
    {
      "title": "Connector 状态",
      "type": "stat",
      "targets": [{
        "expr": "kafka_connect_connector_status{connector=\"my-connector\"}",
        "legendFormat": "{{connector}}-{{state}}"
      }]
    },
    {
      "title": "Source 记录速率",
      "type": "graph",
      "targets": [{
        "expr": "rate(kafka_connect_source_source_record_poll_total[5m])",
        "legendFormat": "{{connector}}-{{task}}"
      }]
    },
    {
      "title": "Sink 记录速率",
      "type": "graph",
      "targets": [{
        "expr": "rate(kafka_connect_sink_sink_record_send_total[5m])",
        "legendFormat": "{{connector}}-{{task}}"
      }]
    }
  ]
}
```

## 5. 常见问题排查

排查时按数据流向逐段定位：Source 读取、Kafka 传输、Sink 写入。一个现象通常对应多种可能原因，先看状态与指标，再判断瓶颈位于哪一段。

| 现象 | 优先检查 | 排查方向 |
| :-- | :-- | :-- |
| Connector 状态为 FAILED | Connector 状态、错误日志、配置与插件依赖 | 确认启动失败原因，再修复配置、依赖或外部系统连接 |
| Task 为 FAILED 或频繁重启 | Task 状态、Worker 日志、外部系统连接 | 区分连接失败、任务异常退出与重启后再次失败 |
| Source 吞吐量下降 | source-record-poll-rate、source-record-write-rate | 判断是外部数据源没提供记录，还是转换、过滤或写 Kafka 环节出现瓶颈 |
| Sink 吞吐量下降 | sink-record-send-rate、消费者与目标系统状态 | 检查输入不足、目标系统响应变慢或写入失败 |
| 数据延迟增加 | Source/Sink 吞吐量、消费者 Lag、外部系统耗时 | 判断延迟来自源端读取、Kafka 内积压还是目标系统写入 |
| 怀疑消息丢失 | Source 写入量、Sink 发送量、错误指标、DLQ 与业务侧记录 | 按数据流向逐段核对记录数量，确认是否被过滤、跳过、重复处理或未写入 |

更系统的排查思路见 [消费者 Lag 过大](../05-troubleshooting/chapter-01-consumer-lag.md)，它主要覆盖 Kafka 消费侧积压；Source 侧与外部目标系统的故障仍需结合 Connector 自身指标和日志。Broker 侧故障处理见 [Broker 故障](../05-troubleshooting/chapter-06-broker-failure.md)。
