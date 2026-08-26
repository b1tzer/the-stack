# Connect 监控

## 1. REST API

```bash
# 查看连接器状态
curl http://localhost:8083/connectors/my-connector/status

# 查看所有连接器
curl http://localhost:8083/connectors

# 暂停连接器
curl -X PUT http://localhost:8083/connectors/my-connector/pause

# 恢复连接器
curl -X PUT http://localhost:8083/connectors/my-connector/resume
```

## 2. JMX 指标

| 指标 | 说明 |
|------|------|
| connector-startup-attempts-total | 启动尝试次数 |
| connector-failed-tasks | 失败任务数 |
| task-startup-attempts-total | 任务启动尝试次数 |
| source-record-poll-rate | Source 记录拉取速率 |
| sink-record-send-rate | Sink 记录发送速率 |

## 3. Prometheus 监控

```yaml
# JMX Exporter 配置
rules:
  - pattern: "kafka.connect<type=connect-worker-metrics>([^:]+):"
    name: "kafka_connect_worker_$1"
    type: GAUGE
```

## 4. Connector 状态监控

```bash
# 查看 Connector 状态
curl -s http://localhost:8083/connectors/my-connector/status | jq .

# 输出示例
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

## 5. 重启失败的 Task

```bash
# 重启特定 Task
curl -X POST http://localhost:8083/connectors/my-connector/tasks/0/restart

# 重启所有 Task
curl -X POST http://localhost:8083/connectors/my-connector/restart?includeTasks=true

# 重启 Connector（包括所有 Task）
curl -X POST http://localhost:8083/connectors/my-connector/restart
```

## 6. Prometheus 监控配置

```yaml
# JMX Exporter 配置文件：kafka-connect-jmx.yaml
rules:
  # Worker 指标
  - pattern: "kafka.connect<type=connect-worker-metrics>([^:]+):"
    name: "kafka_connect_worker_$1"
    type: GAUGE

  # Connector 指标
  - pattern: "kafka.connect<type=connector-metrics, connector=([^,]+)><>status"
    name: "kafka_connect_connector_status"
    labels:
      connector: "$1"
    type: GAUGE

  # Task 指标
  - pattern: "kafka.connect<type=connector-task-metrics, connector=([^,]+), task=([^,]+)><>([^:]+):"
    name: "kafka_connect_task_$3"
    labels:
      connector: "$1"
      task: "$2"
    type: GAUGE

  # Source 指标
  - pattern: "kafka.connect<type=source-task-metrics, connector=([^,]+), task=([^,]+)><>([^:]+):"
    name: "kafka_connect_source_$3"
    labels:
      connector: "$1"
      task: "$2"
    type: GAUGE

  # Sink 指标
  - pattern: "kafka.connect<type=sink-task-metrics, connector=([^,]+), task=([^,]+)><>([^:]+):"
    name: "kafka_connect_sink_$3"
    labels:
      connector: "$1"
      task: "$2"
    type: GAUGE
```

## 7. Grafana Dashboard 配置

```json
{
  "panels": [
    {
      "title": "Connector 状态",
      "type": "stat",
      "targets": [{
        "expr": "kafka_connect_connector_status{connector=\"my-connector\"}",
        "legendFormat": "{{connector}}"
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

## 8. 常见问题排查

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| Connector 状态为 FAILED | 配置错误或依赖缺失 | 检查日志，修复配置 |
| Task 频繁重启 | 外部系统连接失败 | 检查网络和权限 |
| 数据延迟高 | 批量大小过大或处理慢 | 调整 batch.size 和 poll 间隔 |
| 消息丢失 | 错误容忍级别设置不当 | 检查 errors.tolerance 配置 |

## 9. 最佳实践

1. **部署 JMX Exporter**：在每个 Connect Worker 上部署 JMX Exporter，暴露 Prometheus 指标。
2. **配置 Grafana Dashboard**：可视化监控 Connector 状态、吞吐量、延迟等关键指标。
3. **设置告警规则**：Connector 状态变为 FAILED、Task 频繁重启、数据延迟过高时触发告警。
4. **定期检查日志**：Connect 日志包含详细的错误信息，是排查问题的重要依据。
