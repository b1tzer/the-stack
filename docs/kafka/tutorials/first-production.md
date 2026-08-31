# 首次生产部署

## 硬件规划

| 组件 | 建议 |
|------|------|
| 内存 | ≥ 32G（Page Cache 是 Kafka 性能关键） |
| 磁盘 | 多块 HDD/SSD，JBOD 或 RAID 10 |
| CPU | ≥ 8 核 |
| 网络 | 万兆网卡（高吞吐场景） |

## Broker 关键配置

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

## JVM 配置

```bash
export KAFKA_HEAP_OPTS="-Xms6g -Xmx6g -XX:+UseG1GC -XX:MaxGCPauseMillis=20"
```

## 监控指标

| 指标 | 说明 | 告警阈值 |
|------|------|----------|
| UnderReplicatedPartitions | 副本不同步的分区数 | > 0 |
| ActiveControllerCount | 活跃控制器数 | 必须 = 1 |
| RequestHandlerAvgIdlePercent | 请求处理线程空闲率 | < 0.3 |
| NetworkProcessorAvgIdlePercent | 网络线程空闲率 | < 0.3 |
| MessagesInPerSec | 每秒消息数 | 基线监控 |
| BytesInPerSec / BytesOutPerSec | 每秒字节数 | 基线监控 |
| Consumer Lag | 消费延迟 | 持续增长告警 |
