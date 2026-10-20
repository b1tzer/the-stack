# 监控

> 监控的目标是尽早发现集群异常：Controller 是否唯一、分区是否可用、副本是否完整、消费是否积压。本文只覆盖运维侧的指标采集与告警配置；ISR 收缩、消费 Lag 等现象的排查步骤见 [消费者 Lag 过大](../05-troubleshooting/chapter-01-consumer-lag.md)与 [ISR 频繁收缩](../05-troubleshooting/chapter-02-isr-shrink.md)。

## 1. 核心指标

| 指标 | JMX 对象 | 说明 | 告警阈值（参考） |
| :-- | :-- | :-- | :-- |
| UnderReplicatedPartitions | `kafka.server:type=ReplicaManager,name=UnderReplicatedPartitions` | 副本不足的分区数 | `> 0` |
| ActiveControllerCount | `kafka.controller:type=KafkaController,name=ActiveControllerCount` | 节点是否承担 Active Controller 角色 | 存在有效 Controller |
| OfflinePartitionsCount | `kafka.controller:type=KafkaController,name=OfflinePartitionsCount` | 离线分区数 | `> 0` |
| IsrShrinksPerSec | `kafka.server:type=ReplicaManager,name=IsrShrinksPerSec` | ISR 收缩速率 | 持续 `> 0` |
| BytesInPerSec | `kafka.server:type=BrokerTopicMetrics,name=BytesInPerSec` | 每秒输入字节数 | 按带宽容量设定 |
| BytesOutPerSec | `kafka.server:type=BrokerTopicMetrics,name=BytesOutPerSec` | 每秒输出字节数 | 按带宽容量设定 |
| MessagesInPerSec | `kafka.server:type=BrokerTopicMetrics,name=MessagesInPerSec` | 每秒消息数 | 按业务吞吐设定 |

Controller 角色与元数据职责见 [Controller 与 KRaft](../02-core/chapter-08-controller-and-kraft.md)；ISR 变化含义见 [副本复制与 ISR](../02-core/chapter-04-replication-and-isr.md)。

阈值需结合集群规模与业务 SLA 调整。`ActiveControllerCount` 反映节点是否承担 Active Controller 角色：ZooKeeper 模式下通常只有一个 Broker 的该指标为 1，其余为 0；KRaft 模式下应结合 Controller 节点的部署方式监控，不能要求每个 Broker 的值都为 1。告警应检查集群是否存在有效的 Active Controller，而不是在每个节点上直接套用 `!= 1` 条件。`OfflinePartitionsCount > 0` 表示存在离线分区，应及时告警；`UnderReplicatedPartitions > 0` 需区分短暂的副本同步波动与持续异常。`BytesInPerSec`、`BytesOutPerSec` 更适合趋势观察与容量规划，应结合正常业务峰值、网卡带宽与磁盘吞吐判断，不宜所有集群共用固定阈值。ISR 收缩的定位见 [ISR 频繁收缩](../05-troubleshooting/chapter-02-isr-shrink.md)。

## 2. JMX 监控

通过环境变量为 Broker 开启 JMX：

```bash
export KAFKA_JMX_OPTS="-Dcom.sun.management.jmxremote \
    -Dcom.sun.management.jmxremote.port=9999 \
    -Dcom.sun.management.jmxremote.authenticate=false \
    -Dcom.sun.management.jmxremote.ssl=false"
```

上面示例仅适用于通过 Kafka 官方启动脚本启动 Broker 的场景，且只用于隔离环境演示。`authenticate=false` 与 `ssl=false` 不应直接用于生产。远程 JMX 不仅涉及端口开放，还涉及 RMI 连接地址、网络可达性与访问控制；生产环境应开启认证与加密，并通过网络策略限制访问来源。跨主机或容器部署时，应根据网络拓扑配置固定的 RMI 端口与客户端可达的主机名，并验证完整的 JMX 连接链路，只开放注册端口不一定足够。使用容器或自定义启动命令时，需确认这些 JVM 参数确实传递到了 Broker 进程。

按 Topic 查看某项指标：

```bash
kafka-run-class.sh kafka.tools.JmxTool \
    --object-name "kafka.server:type=BrokerTopicMetrics,name=MessagesInPerSec,topic=my-topic" \
    --jmx-url service:jmx:rmi:///jndi/rmi://localhost:9999/jmxrmi
```

`kafka.tools.JmxTool` 的包名随 Kafka 版本变化：较新版本已将工具类迁移到 `org.apache.kafka.tools`，`kafka.tools` 旧包名在新版中可能不可用，请以实际部署版本的发行包为准。`localhost` 指运行 JMX 客户端的机器，客户端与 Broker 不在同一台时需替换为可达地址。JmxTool 适合临时检查，持续采集应使用下方 Exporter 等监控组件。

## 3. Prometheus + Grafana

使用 JMX Exporter 把 JMX 指标暴露为 Prometheus 格式，再由 Prometheus 抓取、Grafana 展示。下面示例假定每个 Broker 已部署 JMX Exporter 并在 7071 端口提供 `/metrics`，`targets` 应填写 Prometheus 实际可访问的 Exporter 地址，而不是 Broker 的 JMX 端口。`kafka-jmx.yaml` 是 JMX Exporter 的指标转换规则文件，需与所用部署方式（Java Agent 或独立进程）的启动参数对应。

Prometheus 抓取配置（`prometheus.yml`）：

```yaml
scrape_configs:
  - job_name: 'kafka'
    static_configs:
      - targets: ['broker1:7071', 'broker2:7071', 'broker3:7071']
    metrics_path: /metrics
```

JMX Exporter 规则示例（`kafka-jmx.yaml`）：

```yaml
rules:
  # Broker 级吞吐累计计数（不带 topic 属性），导出为 Counter，用 rate() 计算每秒速率
  - pattern: "kafka.server<type=BrokerTopicMetrics, name=([\\w.]+)><>Count"
    name: "kafka_server_BrokerTopicMetrics_$1_total"
    type: COUNTER

  # Topic 级吞吐累计计数
  - pattern: "kafka.server<type=BrokerTopicMetrics, name=([\\w.]+), topic=([\\w.-]+)><>Count"
    name: "kafka_server_BrokerTopicMetrics_$1_total"
    labels:
      topic: "$2"
    type: COUNTER

  - pattern: "kafka.server<type=ReplicaManager, name=(\\w+)><>Value"
    name: "kafka_server_ReplicaManager_$1"
    type: GAUGE

  # ISR 收缩累计次数，用 rate() 计算收缩速率
  - pattern: "kafka.server<type=ReplicaManager, name=IsrShrinksPerSec><>Count"
    name: "kafka_server_ReplicaManager_IsrShrinks_total"
    type: COUNTER

  # Controller 指标
  - pattern: "kafka.controller<type=KafkaController, name=(\\w+)><>Value"
    name: "kafka_controller_KafkaController_$1"
    type: GAUGE

  # 副本 Fetcher 追赶进度（不是消费组 Lag）
  - pattern: "kafka.server<type=FetcherLagMetrics, name=ConsumerLag, clientId=(.+), topic=(.+), partition=(.+)><>Value"
    name: "kafka_server_FetcherLag"
    labels:
      clientId: "$1"
      topic: "$2"
      partition: "$3"
    type: GAUGE
```

`kafka_server_BrokerTopicMetrics_*_total` 导出的是 JMX 的 `Count` 累计值，需用 `rate()` 计算每秒速率，不要因 JMX 属性名含 `PerSec` 就当作 Prometheus 的 Gauge 速率。吞吐类指标同时存在 Broker 级（不带 `topic` 属性）与 Topic 级两种 MBean，上面两条规则分别覆盖，同名指标靠 `topic` 标签区分。`IsrShrinksPerSec` 是 Kafka 的速率类指标，Exporter 规则通过其 JMX `Count` 属性采集累计收缩次数，再用 Prometheus `rate()` 计算单位时间内的收缩速率；部署前应确认目标 Kafka 版本确实暴露该属性。

Broker 侧的 `FetcherLagMetrics` 反映副本 Fetcher 追赶进度，与消费组 Lag 是两个不同指标：前者观察副本同步，后者判断消费是否落后于分区日志末端，二者不共用同一指标。消费组 Lag 需通过消费组 Offset 数据源（如 Burrow 或 Lag Exporter）另行采集。

验证 Exporter 是否正常暴露指标：

```bash
curl http://broker1:7071/metrics
```

预期返回 Prometheus 格式的指标文本。若连接失败，检查 Exporter 进程、监听端口与网络策略；能访问但缺少 Kafka 指标，则检查 JMX 连接与规则匹配。在 Prometheus 侧需区分两种状态：指标值为零表示已采集且当前无异常；指标不存在可能意味着采集失败、规则不匹配、目标失联或该节点不暴露该指标，可用 `up{job="kafka"}` 检查抓取状态。

## 4. 常用监控工具

- Kafka Manager：集群与 Topic 的管理查看；使用前应核实所选分支对当前 Kafka 版本的兼容性与维护状态。
- Kafka Offset Monitor：消费组 Offset 与 Lag 展示；使用前确认项目仍在维护且适配当前 Kafka 版本。
- Burrow：侧重消费组 Lag 监控与消费健康判定，不能替代 Broker 的副本状态、Controller 状态与磁盘容量监控。
- Confluent Control Center：适用于采用 Confluent 平台的环境，功能范围与授权条件以所用版本的产品文档为准。

## 5. 告警规则配置

Prometheus 告警示例（`alert-rules.yml`）：

以下规则假定 Prometheus 已覆盖承载相应指标的节点；采用独立 Controller 部署时，应确认 Controller 节点也在抓取范围内，并验证相关指标的实际暴露位置。`up{job="kafka"} == 0` 只能发现已配置目标的抓取失败，无法发现目标从抓取配置中消失，若需覆盖后者应额外检查目标数量。

```yaml
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

      - alert: KafkaExporterDown
        expr: up{job="kafka"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Kafka Exporter 抓取失败"
          description: "{{ $labels.instance }} 的 Exporter 无法被 Prometheus 抓取"

      # 消费组 Lag 需通过消费组 Offset 数据源（如 Burrow 或 Lag Exporter）另行采集，
      # 指标名以实际 Exporter 导出为准，此处用 kafka_consumergroup_lag 示意。
      - alert: KafkaConsumerLag
        expr: kafka_consumergroup_lag > 10000
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "消费者 Lag 过大"
          description: "{{ $labels.topic }} 的 Lag 为 {{ $value }}"
```

Lag 告警依赖消费组 Lag 指标，其采集方式以第 3 节的说明为准，这里用 `kafka_consumergroup_lag` 仅作示意，告警表达式与描述模板中的指标名、标签名（如 `topic`）均以实际 Exporter 输出为准。阈值 `10000` 只是示例，固定条数在不同吞吐的 Topic 上含义差别很大，应结合消费速率与业务时效性调整；排查方法见 [消费者 Lag 过大](../05-troubleshooting/chapter-01-consumer-lag.md)。

`for: 5m`、`for: 1m` 等持续时间均为示例，实际取值应结合故障容忍时间与业务 SLA 调整。

## 6. 日志监控

```bash
# 监控 Kafka 日志
tail -f /var/log/kafka/server.log | grep -E "ERROR|WARN|FATAL"
```

`server.log` 的路径与文件名取决于部署方式，并非所有安装都使用 `/var/log/kafka/server.log`，应以实际部署配置为准。过滤 `WARN` 会混入大量与故障无关的记录，匹配到记录后应回看相邻日志并结合指标判断影响范围。持续运行的日志采集应使用集中式日志系统，而非把 `tail -f | grep` 当作生产环境的完整日志监控方案。

常见日志线索：

| 日志线索 | 运维判断 |
| :-- | :-- |
| Controlled shutdown 相关日志 | 检查是否为计划内下线；若伴随非预期的节点退出，再核对 Controller 变化与副本状态 |
| ISR 收缩相关日志 | 结合分区、Broker、时间戳与 ISR 指标，确认是否持续发生 |
| Log Cleaner 完成相关日志 | 通常属于正常后台操作，只有耗时异常、积压或伴随错误时才需进一步调查 |
