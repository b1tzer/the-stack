# 网络分区

> 网络分区是集群最棘手的问题：节点之间网络不通，可能导致数据不一致。

## 1. 什么是网络分区

```txt
正常状态：
  Node 1 ←──→ Node 2 ←──→ Node 3

网络分区：
  Node 1 ←──→ Node 2    Node 3（隔离）
  [分区 1]              [分区 2]
```

两个分区的节点互相认为对方"挂了"，各自继续工作。

## 2. 网络分区的影响

| 队列类型 | 分区行为 |
| :-- | :-- |
| Classic Queue + 镜像 | 可能出现多个 Master，数据不一致 |
| Quorum Queue | 少数派分区停止写入，多数派正常工作 |
| 无镜像的 Queue | Queue 只在所属节点，其他节点访问不到 |

## 3. 分区检测策略

RabbitMQ 提供三种分区处理策略：

| 策略 | 说明 | 推荐 |
| :-- | :-- | :-- |
| `ignore` | 不自动处理，手动修复 | 生产环境 |
| `pause_minority` | 少数派分区自动暂停 | Quorum Queue |
| `autoheal` | 自动选择一个分区重启其他节点 | 简单场景 |

```bash
# 设置分区策略
rabbitmqctl set_cluster_partition_handling pause_minority
```

## 4. Quorum Queue 的分区行为

Quorum Queue 天然处理网络分区：

```txt
3 节点集群，Node 3 被隔离：
  Node 1 + Node 2（多数派）→ 正常读写
  Node 3（少数派）→ 拒绝写入，等待网络恢复

网络恢复后：
  Node 3 从 Node 1/2 同步缺失的数据
```

## 5. 分区恢复

```bash
# 查看分区状态
rabbitmqctl cluster_status

# 手动修复：重启少数派节点
rabbitmqctl stop_app
rabbitmqctl start_app

# 或者使用 autoheal 策略自动修复
```

## 6. 预防网络分区

- 保证节点间网络稳定（同一机房、低延迟）
- 使用 Quorum Queue（自动处理分区）
- 监控网络延迟和丢包率
- 设置合理的 heartbeat（30-60 秒）
