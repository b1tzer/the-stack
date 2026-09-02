# 首次生产部署

> 本文给出生产集群的最小可用配置，重点不是参数清单，而是每个关键项「为什么这么设」。复制配置前先理解取舍，否则场景变化时无法自行调整。

## 1. 硬件规划

| 组件 | 建议 |
|------|------|
| 内存 | ≥ 32G |
| 磁盘 | 多块 SSD/HDD，JBOD 或 RAID 10 |
| CPU | ≥ 8 核 |
| 网络 | 万兆网卡（高吞吐场景） |

内存这一项最容易配错。Kafka 的消息数据放在操作系统页缓存里，不在 JVM 堆内，所以「内存越大越好」不是指给 JVM，而是给页缓存：

```text
总内存 = JVM 堆（约 6G） + 页缓存（剩余全部）
```

堆只存少量元数据和网络缓冲区，页缓存才是吞吐量来源：热点数据留在页缓存里，读取不落盘。因此 32G 机器上，堆给 6G，其余约 26G 交给页缓存。

磁盘选 JBOD（多块独立盘）而非 RAID 10。Kafka 通过「分区分散到多块盘」自行实现并行，副本机制已经提供数据冗余，RAID 的冗余对 Kafka 是重复建设，反而损失裸盘顺序写带宽。

## 2. Broker 关键配置

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

逐项拆解：

- `listeners` 与 `advertised.listeners`：前者是 Broker 实际监听的地址（本机 `0.0.0.0`），后者是返回给客户端的地址（客户端可解析的 `broker1`）。两者为什么分离，见 [安装部署](./chapter-01-installation.md) §2。
- `log.dirs` 多个目录：多块盘并列，Kafka 把分区分散到不同盘上并行读写，等于用 JBOD 叠加磁盘带宽。
- `min.insync.replicas=2` + `acks=all`：可靠性核心。`acks=all` 要求所有 ISR 副本确认，`min.insync.replicas=2` 保证 ISR 至少 2 个副本才接受写入。两者叠加的效果是——每条消息至少落在 2 个副本上，任一副本宕机都不丢。若 ISR 只剩 1 个，Broker 拒绝写入（`NotEnoughReplicasException`），宁可不写也不在可靠性不足时写。完整推理见 [ACK 机制与可靠性保证](../06-reliability/chapter-01-acks.md)。
- `unclean.leader.election.enable=false`：Leader 宕机时只允许从 ISR 里选新 Leader，禁止从落后副本（OSR）里选。牺牲一点可用性换取「绝不丢数据」——选 OSR 里的落后副本当 Leader，会直接丢失它没追上的那部分消息。
- `num.partitions=6`：新 Topic 的默认分区数。分区数决定并发上限，规划方法见 [性能调优](./chapter-06-performance-tuning.md) §6。

## 3. JVM 配置

```bash
export KAFKA_HEAP_OPTS="-Xms6g -Xmx6g -XX:+UseG1GC -XX:MaxGCPauseMillis=20"
```

三个参数各司其职：

- `-Xms6g -Xmx6g`：最小堆等于最大堆，避免运行中 JVM 动态扩容带来的停顿。堆设 6G 而非 32G，理由见 §1——数据在页缓存，堆大了反而挤压页缓存空间。
- `-XX:+UseG1GC`：G1 的停顿可预测，适合 Kafka 这种对延迟敏感、对象生命周期不一的场景。
- `-XX:MaxGCPauseMillis=20`：目标单次 GC 停顿不超过 20ms，避免 GC 停顿拖慢请求处理。

## 4. 监控指标

生产上线前先接监控，否则出问题只能事后翻日志。下表是必接的核心指标，完整 Prometheus/Grafana 配置见 [监控](../09-operations/chapter-02-monitoring.md)：

| 指标 | 说明 | 告警阈值 |
|------|------|----------|
| UnderReplicatedPartitions | 副本不同步的分区数 | > 0 |
| ActiveControllerCount | 活跃控制器数 | 必须 = 1 |
| RequestHandlerAvgIdlePercent | 请求处理线程空闲率 | < 0.3 |
| NetworkProcessorAvgIdlePercent | 网络线程空闲率 | < 0.3 |
| MessagesInPerSec | 每秒消息数 | 基线监控 |
| BytesInPerSec / BytesOutPerSec | 每秒字节数 | 基线监控 |
| Consumer Lag | 消费延迟 | 持续增长告警 |

其中 `UnderReplicatedPartitions > 0` 和 `Consumer Lag` 持续增长是两条最需要优先告警的信号：前者说明有副本跟不上、可靠性正在下降；后者说明消费速度跟不上生产、堆积在扩大。
