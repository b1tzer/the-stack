# 常见场景与上线检查

> 本文两部分：Kafka 的典型应用场景索引，以及首次生产部署的上线检查清单。清单的重点不是参数罗列，而是每个关键项「为什么这么设」——复制配置前先理解取舍，否则场景变化时无法自行调整。

## 1. 日志收集

```txt
App → Kafka → Logstash → Elasticsearch → Kibana
```

## 2. 事件驱动架构

```txt
Service A → Kafka → Service B
                → Service C
                → Service D
```

多个消费者可组成同一个消费者组分担分区，也可用不同的消费者组各自独立消费同一份事件流，具体语义取决于 Topic、分区和消费者组配置。服务间通信的通用模式（竞争消费者、发布订阅等）见 [消息模式综述](../../scenarios/03-messaging/chapter-02-messaging-patterns.md)。

## 3. 数据管道

```txt
MySQL → Debezium → Kafka → Elasticsearch
                        → Data Warehouse
```

Source / Sink 的接入与配置见 [Kafka Connect 概览](../09-connect/chapter-01-connect-basics.md)。

## 4. 流式处理

```txt
Kafka → Kafka Streams/Flink → Kafka
```

Kafka Streams 的定位与核心抽象见 [Kafka Streams 概览](../08-streams/chapter-01-streams-basics.md)。

## 5. 指标监控

```txt
Kafka Broker / JMX → 指标导出器 → Prometheus → Grafana
```

集群侧指标采集与告警配置见 [监控](../06-operations/chapter-01-monitoring.md)。

## 6. 上线检查清单

本清单用于首次部署前的检查，不替代容量规划和生产压测。以下配置值用于说明关键参数的作用，实际取值应结合目标 Kafka 版本、部署模式、消息吞吐量、数据保留要求和故障恢复目标确定。

### 6.1 硬件规划

| 组件 | 示例起点 |
| :-- | :-- |
| 内存 | ≥ 32G |
| 磁盘 | 多块 SSD/HDD，JBOD 或 RAID 10 |
| CPU | ≥ 8 核 |
| 网络 | 万兆网卡（高吞吐场景） |

内存这一项最容易配错。Kafka 的消息数据放在操作系统页缓存里，不在 JVM 堆内，所以「内存越大越好」不是指给 JVM，而是优先给页缓存留出空间。下面公式是规划示意，不是严格的内存分配等式，实际页缓存由操作系统按可用内存动态管理：

```txt
总内存 = JVM 堆（示例 6G） + 页缓存 + 堆外内存与系统开销
```

JVM 堆承载请求处理、对象分配等运行时数据，网络缓冲区等则多位于堆外内存。页缓存是吞吐量的重要基础，热点数据留在页缓存里，读取不落盘。页缓存为什么是高吞吐的基础，见 [为什么 Kafka 这么快](../04-performance/chapter-01-why-kafka-is-fast.md)。32G 机器堆给 6G 只是示例起点，剩余内存要在页缓存、堆外内存和系统服务之间分配，不能认定全部交给页缓存。

磁盘选 JBOD（多块独立盘）还是 RAID 10，取决于故障恢复要求和运维能力，不是非此即彼。Kafka 副本分布在不同 Broker 上，提供跨节点的数据冗余；RAID 10 保护的是单机磁盘故障，两者机制不同。JBOD 是常见选择，但需考虑单盘故障后的分区恢复和容量不均衡，不能仅凭「副本已提供冗余」就排除 RAID。

### 6.2 Broker 关键配置

下面配置用于展示关键配置项及其相互关系，不是可直接复制到任意生产集群的完整模板。参数可分成三类：可靠性策略（副本数、最小 ISR、不干净 Leader 选举）、容量与保留策略（日志目录、分区数、保留时长）、性能调优项（网络线程、Socket 缓冲、复制抓取参数）。分区数、线程数等取值需按目标版本、硬件和实际负载验证。

```properties
# 身份
broker.id=1  # 每个节点不同

# 监听
listeners=PLAINTEXT://0.0.0.0:9092
advertised.listeners=PLAINTEXT://broker1:9092

# 日志
log.dirs=/data1/kafka-logs,/data2/kafka-logs
num.partitions=6
default.replication.factor=3
min.insync.replicas=2
unclean.leader.election.enable=false
log.retention.hours=168
log.segment.bytes=1073741824

# 网络
num.network.threads=8
num.io.threads=16
socket.send.buffer.bytes=102400
socket.receive.buffer.bytes=102400
socket.request.max.bytes=104857600

# 副本
replica.fetch.max.bytes=10485760
replica.fetch.wait.max.ms=500
```

重点项的取舍：

- `listeners` 与 `advertised.listeners`：前者是 Broker 实际监听的地址（本机 `0.0.0.0`），后者是返回给客户端的地址（客户端可解析的 `broker1`）。两者为什么分离、配错会怎样，见[准备本地环境](./chapter-01-first-app.md#prepare-local-env)。示例用 `PLAINTEXT` 仅用于可信网络内的演示与连通性验证，生产环境应按要求配置 TLS、SASL 等认证机制，并限制 Broker 端口网络访问范围。
- `log.dirs` 多个目录：让 Kafka 把不同分区的日志存到不同目录，为多盘并行 I/O 提供条件。实际负载分布取决于分区分配和各目录容量、写入速率，不能假定所有磁盘始终均匀工作。
- `min.insync.replicas=2` + `acks=all`：`acks=all` 要求写入时 ISR 中的副本完成确认；`min.insync.replicas=2` 要求接受写入时 ISR 至少包含 2 个副本。若 ISR 因故障少于 2 个，Broker 会拒绝写入（如 `NotEnoughReplicasException` 或 `NotEnoughReplicasAfterAppend`），而不是在副本不足时继续接受。这组配置提高了写入的复制保障，但不等于数据已通过 fsync 刷入所有物理磁盘，也不能替代备份和故障恢复演练。完整机制见 [ACK 与幂等](../02-core/chapter-05-ack-and-idempotence.md)。
- `unclean.leader.election.enable=false`：禁止把 ISR 之外的副本作为最后手段选为 Leader。这可以避免因选中 ISR 之外的副本而丢失它尚未同步的消息，但当 ISR 中没有可用候选者时，分区可能暂时无法写入。该配置降低了一类数据丢失风险，不构成绝对的数据不丢失保证。ISR 机制见 [副本与 ISR](../02-core/chapter-04-replication-and-isr.md)。
- `num.partitions=6`：未显式指定分区数的新 Topic 的默认分区数。分区数影响该 Topic 的分区级并行能力，但分区越多不等于吞吐量越高，还需考虑消费者组规模、Broker 资源和分区管理开销，规划方法见 [分区数选择](../04-performance/chapter-03-partition-sizing.md)。
- `replica.fetch.max.bytes=10485760`：控制副本单次拉取数据的目标上限，配置较小时大批次复制可能需要更多轮拉取。它与 `socket.request.max.bytes` 不是同一限制，规划时应同时核对 Topic 的消息大小限制、生产者请求大小和消费者拉取限制，不要仅凭数值大小判断消息是否可被复制或消费。

### 6.3 JVM 配置

下面配置可作为测试环境的起点，生产环境需结合堆使用情况和 GC 日志调整：

```bash
export KAFKA_HEAP_OPTS="-Xms6g -Xmx6g -XX:+UseG1GC"
```

- `-Xms6g -Xmx6g`：初始堆等于最大堆，避免运行中堆容量动态扩展。堆设 6G 而非 32G，理由见 §6.1，数据在页缓存，堆大了反而挤压页缓存空间；但 6G 只是示例，需按实际负载验证。
- `-XX:+UseG1GC`：G1 支持按目标停顿时间进行调优，适合 Kafka 这种对延迟敏感、对象生命周期不一的场景，但不能保证每次停顿都满足目标。
- `-XX:MaxGCPauseMillis`：可选，用于设置停顿时间目标。它是调优目标而非硬性上限，20ms 这类具体值需结合 GC 日志和压测确定，仅在必要时调整。

### 6.4 监控接入

上线前应确认监控采集、告警规则和通知链路均已验证，至少覆盖副本健康、消费积压、Broker 资源使用和请求处理四类信号。其中两条最需要优先告警：

- `UnderReplicatedPartitions` 持续大于 0：存在副本未达到预期同步状态。应结合持续时间、ISR 变化和 Broker 健康状态判断是否告警，滚动升级或副本迁移期间短暂出现不一定意味着故障扩大；若指标持续不恢复或同时出现 ISR 缩减，应提高告警级别并排查副本复制问题。
- Consumer Lag 持续增长：消费速度跟不上生产，积压在扩大。告警应关注持续时间和变化趋势，避免仅凭单次指标波动判断。

其余核心指标与告警阈值见 [监控](../06-operations/chapter-01-monitoring.md)；Lag 的排查步骤见 [消费者 Lag 过大](../05-troubleshooting/chapter-01-consumer-lag.md)。
