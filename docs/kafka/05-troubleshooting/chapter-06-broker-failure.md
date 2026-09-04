# Broker 故障

> Broker 故障会导致分区 Leader 丢失，影响消息的生产和消费。本文讲清常见 Broker 故障的排查和恢复。

## 1. 现象

- Broker 进程退出
- Broker 启动失败
- Controller 故障

## 2. Broker 启动失败

### 端口被占用

```bash
lsof -i:9092
# 如果有进程占用，kill 或更换端口
```

### Broker ID 冲突

```txt
kafka.common.InconsistentBrokerIdException
```

检查 `server.properties` 中的 `broker.id` 是否唯一。

### 磁盘空间不足

```txt
java.io.IOException: No space left on device
```

检查磁盘空间，见 [磁盘空间不足](./chapter-05-disk-space.md)。

### 文件权限

```bash
ls -la /var/kafka-logs/
# 确保 Kafka 用户有写入权限
```

## 3. Broker 运行中宕机

### Step 1：检查日志

```bash
tail -100 /var/kafka-logs/server.log
grep -E "ERROR|FATAL" /var/kafka-logs/server.log | tail -20
```

### Step 2：检查系统资源

```bash
# 内存
free -h

# 磁盘
df -h

# 系统日志
dmesg | tail -20
# OOM Killer 可能杀掉了 Kafka 进程
```

### Step 3：检查 JVM 状态

```bash
# 如果进程还在
jstack <pid>
jstat -gc <pid> 1000

# 检查 GC 日志
tail -100 /var/log/kafka/gc.log
```

## 4. Controller 故障

```bash
# 检查 Controller 状态
kafka-metadata.sh --snapshot /var/kafka-logs/__cluster_metadata/00000000000000000000.log \
    --cluster-id <cluster-id>
```

KRaft 模式下 Controller 故障会自动选举新 Leader。ZooKeeper 模式下需要等待 Controller 重新加载元数据。

## 5. 分区 Leader 丢失

```bash
# 检查没有 Leader 的分区
kafka-topics.sh --describe --under-replicated --bootstrap-server localhost:9092

# 如果 ISR 为空，考虑 Unclean Leader 选举（有数据丢失风险）
kafka-leader-election.sh --election-type UNCLEAN --topic my-topic --partition 0 \
    --bootstrap-server localhost:9092
```

## 6. 预防

- 使用 KRaft 模式，多 Controller 冗余
- 监控 Broker 进程存活状态
- 监控磁盘空间和系统资源
- 配置合理的 JVM 参数和 GC 策略
- 使用 `unclean.leader.election.enable=false` 防止数据丢失
