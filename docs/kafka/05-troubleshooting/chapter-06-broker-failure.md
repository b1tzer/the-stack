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
# 先确认占用进程的身份与用途，再决定停止该进程或更换端口，不要直接 kill
lsof -i:9092 -P -n
ps -p <pid> -o pid,cmd
```

### Broker ID 冲突

ZooKeeper 模式下，`broker.id` 与已有节点冲突时会报：

```txt
kafka.common.InconsistentBrokerIdException
```

检查 `server.properties` 中的 `broker.id` 是否唯一。KRaft 模式检查 `node.id`，冲突时的异常表现与 ZooKeeper 模式不同，需结合实际启动日志确认节点标识是否与元数据中注册的一致。

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

先确认故障属于哪一类，再走对应的排查路径。

### 进程已退出

```bash
# 退出前日志
tail -100 /var/kafka-logs/server.log
grep -E "ERROR|FATAL" /var/kafka-logs/server.log | tail -20

# 系统日志，OOM Killer 可能杀掉了 Kafka 进程
dmesg | tail -20
```

### 进程存活但服务异常

```bash
# 内存与磁盘
free -h
df -h

# 线程栈与 GC
jstack <pid>
jstat -gc <pid> 1000
tail -100 /var/log/kafka/gc.log
```

### 进程存活但集群认为不可用

Broker 进程正常，但集群不再把它当作可用节点。可能原因包括 Broker 与 Controller 之间的心跳超时、网络分区、Controller 自身异常或 Broker 注册配置问题。此时重点检查节点间网络连通性与 Controller 侧日志（见第 4 节），并观察受影响分区的 Leader 与 ISR 变化。

## 4. Controller 故障

先区分两个目标：确认 Controller 是否正常，与检查元数据快照内容。前者用 Quorum 状态命令，后者用元数据 Shell，不能用快照读取工具替代健康检查。

```bash
# 确认 Controller Quorum 状态（仅适用于 KRaft 模式）
kafka-metadata-quorum.sh --bootstrap-server localhost:9092 describe --status

# 检查元数据快照内容，路径替换为实际元数据目录中的有效快照文件
kafka-metadata-shell.sh --snapshot /var/kafka-logs/__cluster_metadata/<snapshot-file>
```

KRaft 模式下，只要 Quorum 仍有多数派可用，Raft 就会自动选举新的 Active Controller，无需人工干预；多数派不可用时需排查 Controller 节点与 Quorum 状态。ZooKeeper 模式下需等待新 Controller 重新加载元数据。

## 5. 分区 Leader 丢失

先分清两类不同的问题：无 Leader 的分区（不可用）与副本不足同步（under-replicated）不是同一件事。检查前者用 `--unavailable-partitions`，检查后者才用 `--under-replicated-partitions`。

```bash
# 检查不可用（无 Leader）的分区
kafka-topics.sh --describe --unavailable-partitions --bootstrap-server localhost:9092

# 检查副本不足同步的分区
kafka-topics.sh --describe --under-replicated-partitions --bootstrap-server localhost:9092
```

确认分区不可用后，先检查该分区的 Leader、Replicas、ISR 与剩余副本是否存活。只有当 ISR 为空、确实存在可用的非 ISR 副本、且已接受潜在数据丢失时，才把 Unclean Leader 选举作为应急措施；若相关副本都已不可用，选举也无法凭空恢复。其原理与风险见 [副本与 ISR - Unclean Leader 选举](../02-core/chapter-04-replication-and-isr.md#unclean-leader-election)。

```bash
# 应急措施：Unclean Leader 选举（可能丢失未同步到落后副本的消息）
kafka-leader-election.sh --election-type UNCLEAN --topic my-topic --partition 0 \
    --bootstrap-server localhost:9092
```

## 6. 预防

- 使用 KRaft 模式，多 Controller 冗余
- 监控 Broker 进程存活状态
- 监控磁盘空间和系统资源
- 配置合理的 JVM 参数和 GC 策略
- 使用 `unclean.leader.election.enable=false` 禁用 Unclean 选举，避免因选举落后副本而丢失已提交消息；代价是 ISR 为空时分区可能持续不可用
