# 监控

## 1. 核心指标

| 指标 | 说明 |
|------|------|
| UnderReplicatedPartitions | 副本不足的分区数 |
| ActiveControllerCount | 活跃 Controller 数 |
| OfflinePartitionsCount | 离线分区数 |
| BytesInPerSec | 每秒输入字节数 |
| BytesOutPerSec | 每秒输出字节数 |
| MessagesInPerSec | 每秒消息数 |

## 2. JMX 监控

```bash
# 启用 JMX
export KAFKA_JMX_OPTS="-Dcom.sun.management.jmxremote -Dcom.sun.management.jmxremote.port=9999"
```

## 3. Prometheus + Grafana

```yaml
# JMX Exporter
rules:
  - pattern: "kafka.server<type=BrokerTopicMetrics, name=MessagesInPerSec><>Count"
    name: "kafka_messages_in_total"
    type: COUNTER
```

## 4. 常用监控工具

- Kafka Manager
- Kafka Offset Monitor
- Burrow (消费者 Lag 监控)
- Confluent Control Center

## 5. JMX 指标详解

### 5.1 Broker 级别指标
```bash
# 启用 JMX
export KAFKA_JMX_OPTS="-Dcom.sun.management.jmxremote \
    -Dcom.sun.management.jmxremote.port=9999 \
    -Dcom.sun.management.jmxremote.authenticate=false \
    -Dcom.sun.management.jmxremote.ssl=false"
```

| 指标 | 说明 | 告警阈值 |
|------|------|----------|
| kafka.server:type=BrokerTopicMetrics,name=MessagesInPerSec | 每秒消息数 | 根据业务设定 |
| kafka.server:type=BrokerTopicMetrics,name=BytesInPerSec | 每秒输入字节数 | 根据带宽设定 |
| kafka.server:type=ReplicaManager,name=UnderReplicatedPartitions | 副本不足分区数 | > 0 |
| kafka.controller:type=KafkaController,name=ActiveControllerCount | 活跃 Controller 数 | != 1 |
| kafka.controller:type=KafkaController,name=OfflinePartitionsCount | 离线分区数 | > 0 |
| kafka.server:type=ReplicaManager,name=IsrShrinksPerSec | ISR 收缩速率 | > 0 持续 |

### 5.2 Topic 级别指标
```bash
# 查看 Topic 指标
kafka-run-class.sh kafka.tools.JmxTool \
    --object-name "kafka.server:type=BrokerTopicMetrics,name=MessagesInPerSec,topic=my-topic" \
    --jmx-url service:jmx:rmi:///jndi/rmi://localhost:9999/jmxrmi
```

## 6. Prometheus + Grafana 配置

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'kafka'
    static_configs:
      - targets: ['broker1:7071', 'broker2:7071', 'broker3:7071']
    metrics_path: /metrics
```

```yaml
# JMX Exporter 配置：kafka-jmx.yaml
rules:
  # Broker 指标
  - pattern: "kafka.server<type=BrokerTopicMetrics, name=(\w+), topic=(\w+)><>Count"
    name: "kafka_server_BrokerTopicMetrics_$1"
    labels:
      topic: "$2"
    type: COUNTER

  - pattern: "kafka.server<type=ReplicaManager, name=(\w+)><>Value"
    name: "kafka_server_ReplicaManager_$1"
    type: GAUGE

  # Controller 指标
  - pattern: "kafka.controller<type=KafkaController, name=(\w+)><>Value"
    name: "kafka_controller_KafkaController_$1"
    type: GAUGE

  # 消费者指标
  - pattern: "kafka.server<type=FetcherLagMetrics, name=ConsumerLag, clientId=(.+), topic=(.+), partition=(.+)><>Value"
    name: "kafka_server_ConsumerLag"
    labels:
      clientId: "$1"
      topic: "$2"
      partition: "$3"
    type: GAUGE
```

## 7. 告警规则配置

```yaml
# alert-rules.yml
groups:
  - name: kafka-alerts
    rules:
      - alert: KafkaUnderReplicatedPartitions
        expr: kafka_server_ReplicaManager_UnderReplicatedPartitions > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Kafka 副本不足"
          description: "{{ $labels.instance }} 有 {{ $value }} 个分区副本不足"

      - alert: KafkaOfflinePartitions
        expr: kafka_controller_KafkaController_OfflinePartitionsCount > 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Kafka 存在离线分区"
          description: "{{ $labels.instance }} 有 {{ $value }} 个离线分区"

      - alert: KafkaConsumerLag
        expr: kafka_server_ConsumerLag > 10000
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "消费者 Lag 过大"
          description: "{{ $labels.topic }} 的 Lag 为 {{ $value }}"
```

## 8. 日志监控

```bash
# 监控 Kafka 日志
tail -f /var/log/kafka/server.log | grep -E "ERROR|WARN|FATAL"

# 关键日志模式
# [Controller id=1] Starting controlled shutdown → Controller 切换
# [ReplicaFetcherThread] Partition [topic,0] marked as ISR shrink → ISR 收缩
# [Log Cleaner] Compaction completed for topic → 日志压缩完成
```

## 9. 最佳实践

1. **部署完整的监控栈**：JMX Exporter + Prometheus + Grafana + AlertManager。
2. **设置关键告警**：UnderReplicatedPartitions、OfflinePartitionsCount、ConsumerLag。
3. **监控系统资源**：CPU、内存、磁盘 I/O、网络带宽，这些直接影响 Kafka 性能。
4. **建立监控基线**：记录正常情况下的指标值，便于快速发现异常。
