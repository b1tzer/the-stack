# 性能调优

## 1. 生产者调优

```properties
batch.size=16384
linger.ms=5
compression.type=lz4
buffer.memory=33554432
```

## 2. 消费者调优

```properties
max.poll.records=500
fetch.min.bytes=1
fetch.max.wait.ms=500
```

## 3. Broker 调优

```properties
num.network.threads=3
num.io.threads=8
log.flush.interval.messages=10000
log.flush.interval.ms=1000
```

## 4. 分区数

- 分区数 = 消费者数（理想情况）
- 分区过多：增加元数据开销
- 分区过少：限制并发

## 5. 副本数

- 副本数 = 3（推荐）
- min.insync.replicas = 2

## 6. 分区数调优

| 分区数 | 优势 | 劣势 |
| :-- | :-- | :-- |
| 1-10 | 元数据开销小 | 并发度受限 |
| 10-100 | 平衡 | 合理范围 |
| 100-1000 | 高并发 | Controller 压力大 |
| >1000 | 极高并发 | Leader 选举慢，恢复慢 |

**经验公式**：
```
分区数 = max(生产者并发数, 消费者并发数) × 2

示例：
- 期望 10 个消费者并发 → 分区数 = 20
- 期望 50 个消费者并发 → 分区数 = 100
```

## 7. 副本数调优

```properties
# 副本因子
default.replication.factor=3  # 推荐 3

# ISR 最小副本数
min.insync.replicas=2  # 推荐 2

# 副本同步配置
replica.fetch.max.bytes=10485760  # 10MB
replica.fetch.wait.max.ms=500
replica.fetch.min.bytes=1
```

## 8. 磁盘 I/O 调优

```bash
# 1. 使用 SSD
# SSD 随机读写性能远优于 HDD

# 2. 文件系统选择
# 推荐 XFS 或 ext4
mkfs.xfs /dev/sdb1

# 3. 挂载选项
# noatime：不更新访问时间，减少写入
mount -o noatime /dev/sdb1 /var/kafka-logs

# 4. 预读设置
# 增大预读值，提升顺序读取性能
blockdev --setra 2048 /dev/sdb1

# 5. I/O 调度器
# 使用 deadline 或 noop 调度器
echo deadline > /sys/block/sdb/queue/scheduler
```

## 9. 网络调优

```bash
# 1. 增大 TCP 缓冲区
sysctl -w net.core.rmem_max=16777216
sysctl -w net.core.wmem_max=16777216
sysctl -w net.ipv4.tcp_rmem="4096 87380 16777216"
sysctl -w net.ipv4.tcp_wmem="4096 65536 16777216"

# 2. 增大 socket 缓冲区
sysctl -w net.core.netdev_max_backlog=5000

# 3. 启用 TCP 窗口缩放
sysctl -w net.ipv4.tcp_window_scaling=1
```

```properties
# Kafka 网络配置
num.network.threads=8  # 网络线程数
num.io.threads=16      # I/O 线程数
socket.send.buffer.bytes=102400
socket.receive.buffer.bytes=102400
socket.request.max.bytes=104857600
```

## 10. 操作系统调优

```bash
# 1. 禁用 swap
sysctl -w vm.swappiness=1

# 2. 增大文件描述符限制
ulimit -n 100000

# 3. 增大虚拟内存区域
sysctl -w vm.max_map_count=262144

# 4. 调整脏页刷新策略
sysctl -w vm.dirty_ratio=60
sysctl -w vm.dirty_background_ratio=5
```

## 11. 性能测试工具

```bash
# 生产者性能测试
kafka-producer-perf-test.sh \
    --topic test-topic \
    --num-records 1000000 \
    --record-size 1024 \
    --throughput -1 \
    --producer-props bootstrap.servers=localhost:9092 \
        acks=all batch.size=65536 linger.ms=20 compression.type=lz4

# 消费者性能测试
kafka-consumer-perf-test.sh \
    --topic test-topic \
    --messages 1000000 \
    --broker-list localhost:9092 \
    --group test-group

# 端到端延迟测试
kafka-run-class.sh kafka.tools.EndToEndLatency \
    --broker-list localhost:9092 \
    --topic test-topic \
    --num-records 10000
```

## 12. 性能调优检查清单

```bash
# 生产者
# [ ] batch.size >= 16384
# [ ] linger.ms >= 5
# [ ] compression.type = lz4/zstd
# [ ] acks = all
# [ ] enable.idempotence = true
# [ ] buffer.memory >= 33554432

# 消费者
# [ ] max.poll.records 适中（500-1000）
# [ ] fetch.min.bytes >= 1024
# [ ] max.partition.fetch.bytes 适中
# [ ] enable.auto.commit = false

# Broker
# [ ] num.network.threads >= 8
# [ ] num.io.threads >= 16
# [ ] log.flush.interval.messages 合理
# [ ] 使用 SSD
# [ ] 禁用 swap
# [ ] 文件描述符限制 >= 100000
```

