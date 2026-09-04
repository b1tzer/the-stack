# 常见问题排查

## 1. 消费者 Lag 过大

```bash
# 查看消费者 Lag
kafka-consumer-groups.sh --describe --group my-group --bootstrap-server localhost:9092
```

解决：
- 增加消费者数量
- 增加分区数
- 优化消费者处理速度

## 2. 消息丢失

| 阶段 | 原因 | 解决 |
| :-- | :-- | :-- |
| 生产者 | acks=0/1 | acks=all |
| Broker | 副本不足 | min.insync.replicas=2 |
| 消费者 | 自动提交 | 手动提交 Offset |

## 3. 消息重复

- 生产者重试 → 幂等生产者
- 消费者重复 → 幂等消费

## 4. 磁盘空间不足

```bash
# 清理日志
kafka-delete-records.sh --offset-json-file offsets.json --bootstrap-server localhost:9092
```

## 5. 高延迟问题

```bash
# 检查网络延迟
ping broker1
traceroute broker1

# 检查 Broker 负载
top -p $(pgrep -f kafka)
iostat -x 1

# 检查生产者延迟
kafka-run-class.sh kafka.tools.GetOffsetShell \
    --broker-list localhost:9092 --topic my-topic --time -1
```

**常见原因**：
- Broker 负载过高（CPU、磁盘 I/O、网络）。
- 分区过多导致 Controller 处理慢。
- 副本同步延迟。
- GC 停顿。

**解决方案**：
- 增加 Broker 数量，分散负载。
- 优化分区数，避免过多分区。
- 使用 SSD 替代 HDD。
- 调整 JVM 参数，减少 GC 停顿。

## 6. Broker 启动失败

```bash
# 检查日志
tail -f /var/log/kafka/server.log

# 常见错误
# java.net.BindException: Address already in use → 端口被占用
# kafka.common.InconsistentBrokerIdException → Broker ID 冲突
# java.io.IOException: No space left on device → 磁盘空间不足
```

**解决方案**：
- 检查端口占用：`lsof -i:9092`
- 检查 Broker ID 唯一性。
- 检查磁盘空间：`df -h`。
- 检查文件权限：确保 Kafka 用户有写入权限。

## 7. ISR 频繁收缩

```bash
# 检查 ISR 收缩
kafka-topics.sh --describe --under-replicated --bootstrap-server localhost:9092

# 检查网络质量
kafka-run-class.sh kafka.tools.ReplicaVerificationTool \
    --broker-list localhost:9092 --topic-white-list ".*"
```

**常见原因**：
- 网络延迟或丢包。
- Broker 负载过高。
- 磁盘 I/O 瓶颈。
- GC 停顿。

**解决方案**：
- 检查网络连接质量。
- 增加 `replica.lag.time.max.ms`（谨慎，可能延迟故障检测）。
- 优化 Broker 资源配置。

## 8. Controller 故障

```bash
# 检查 Controller 状态
kafka-metadata.sh --snapshot /var/kafka-logs/__cluster_metadata/00000000000000000000.log \
    --cluster-id <cluster-id>

# 检查 ZooKeeper 中的 Controller 信息
zookeeper-shell.sh localhost:2181 <<< "get /controller"
```

**常见原因**：
- Controller 所在 Broker 宕机。
- ZooKeeper 连接超时。
- 元数据加载慢。

**解决方案**：
- 检查 Controller 所在 Broker 的日志。
- 检查 ZooKeeper 集群健康状态。
- 考虑迁移到 KRaft 模式（多 Controller 冗余）。

## 9. 常用排查工具

| 工具 | 用途 |
| :-- | :-- |
| kafka-topics.sh | Topic 管理和状态查看 |
| kafka-consumer-groups.sh | 消费者组和 Lag 查看 |
| kafka-reassign-partitions.sh | 分区重分配 |
| kafka-dump-log.sh | 日志文件分析 |
| kafka-metadata.sh | 元数据查看 |
| kafka-broker-api-versions.sh | Broker API 版本检查 |
| kafka-configs.sh | 配置管理 |

## 10. 性能排查清单

```bash
# 1. 检查系统资源
iostat -x 1          # 磁盘 I/O
vmstat 1             # CPU 和内存
sar -n DEV 1         # 网络

# 2. 检查 JVM 状态
jstat -gc <pid> 1000 # GC 状态
jstack <pid>         # 线程状态

# 3. 检查 Kafka 指标
kafka-run-class.sh kafka.tools.JmxTool \
    --object-name "kafka.server:type=BrokerTopicMetrics,name=MessagesInPerSec" \
    --jmx-url service:jmx:rmi:///jndi/rmi://localhost:9999/jmxrmi

# 4. 检查日志
grep -E "ERROR|WARN|FATAL" /var/kafka-logs/server.log | tail -20
```

