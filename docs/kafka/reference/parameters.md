# Kafka 参数速查

## Broker 配置

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| `broker.id` | 0 | 唯一整数 | Broker 唯一标识 |
| `num.partitions` | 1 | 3~6 | 默认分区数 |
| `default.replication.factor` | 1 | 3 | 默认副本因子 |
| `min.insync.replicas` | 1 | 2 | 最小同步副本数 |
| `unclean.leader.election.enable` | false | false | 禁止不同步副本成为 leader |
| `log.retention.hours` | 168 | 168~720 | 消息保留时间（小时） |
| `log.retention.bytes` | -1 | 按磁盘规划 | 按大小保留 |
| `log.segment.bytes` | 1G | 1G | 日志分段大小 |
| `message.max.bytes` | 1M | 10M~50M | 最大消息大小 |

## Producer 配置

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| `acks` | all | all | 所有 ISR 确认 |
| `retries` | 2147483647 | 10~100 | 重试次数 |
| `batch.size` | 16384 | 65536~131072 | 批量大小（字节） |
| `linger.ms` | 0 | 5~20 | 等待凑批时间 |
| `buffer.memory` | 33554432 | 67108864 | 发送缓冲区大小 |
| `compression.type` | none | lz4 | 压缩算法 |
| `max.in.flight.requests.per.connection` | 5 | 5 | 每连接最大在途请求 |
| `enable.idempotence` | true | true | 幂等生产者 |

## Consumer 配置

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| `group.id` | - | 必填 | 消费者组 ID |
| `auto.offset.reset` | latest | earliest/latest | 无 offset 时的重置策略 |
| `enable.auto.commit` | true | false | 手动提交更可靠 |
| `max.poll.records` | 500 | 100~500 | 每次 poll 最大记录数 |
| `max.poll.interval.ms` | 300000 | 300000 | 两次 poll 最大间隔 |
| `session.timeout.ms` | 45000 | 10000~30000 | 心跳超时 |
| `fetch.min.bytes` | 1 | 1 | 最小拉取字节数 |
| `fetch.max.wait.ms` | 500 | 100~500 | 最大等待时间 |

## JVM 配置

```bash
# 推荐 JVM 参数
-Xms4g -Xmx4g
-XX:+UseG1GC
-XX:MaxGCPauseMillis=20
-XX:InitiatingHeapOccupancyPercent=35
```
