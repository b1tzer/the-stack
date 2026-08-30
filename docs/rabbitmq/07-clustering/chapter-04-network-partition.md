# 网络分区

> 网络分区（Network Partition）是集群最棘手的问题：节点间通信中断，可能导致数据不一致。

## 1. 什么是网络分区

```text
正常集群：
Node 1 ◀──▶ Node 2 ◀──▶ Node 3

网络分区：
Node 1          Node 2 ◀──▶ Node 3
(隔离)          (另一个分区)
```

## 2. 分区处理策略

### 2.1 ignore（推荐）

```ini
cluster_partition_handling = ignore
```

- 不自动处理分区
- 分区恢复后手动处理
- 适合大多数场景

### 2.2 pause_minority

```ini
cluster_partition_handling = pause_minority
```

- 少数派节点暂停
- 多数派继续服务
- 分区恢复后自动恢复

### 2.3 autoheal

```ini
cluster_partition_handling = autoheal
```

- 自动选择一个分区保留
- 其他分区的节点重启
- 可能丢失数据

## 3. 分区检测

```bash
# 检查分区状态
rabbitmq-diagnostics check_running
rabbitmq-diagnostics check_port_connectivity
rabbitmqctl cluster_status
```

### 3.1 分区指标

```text
rabbitmq_cluster_partitions = 0  # 正常
rabbitmq_cluster_partitions > 0  # 发生分区
```

## 4. 分区恢复

### 4.1 自动恢复（ignore 模式）

分区恢复后，节点自动重新同步。但需要检查：

- 队列 Leader 是否需要重新选举
- 镜像队列是否需要重新同步
- 消息是否丢失

### 4.2 手动恢复

```bash
# 在需要重启的节点上执行
rabbitmqctl stop_app
rabbitmqctl reset
rabbitmqctl join_cluster rabbit@primary_node
rabbitmqctl start_app
```

## 5. 预防措施

| 措施 | 说明 |
| :-- | :-- |
| 使用 Quorum Queue | 自动处理分区，数据安全 |
| 低延迟网络 | 减少分区概率 |
| 奇数节点 | 3 或 5 节点，保证多数派 |
| 监控告警 | 及时发现分区 |
| 跨可用区 | 避免单点故障 |

## 6. 最佳实践

- 使用 Quorum Queue 替代镜像队列
- 配置 `cluster_partition_handling = pause_minority`
- 3 节点或 5 节点部署
- 监控集群分区状态
- 定期演练分区恢复
