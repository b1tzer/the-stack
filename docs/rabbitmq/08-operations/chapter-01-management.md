# 管理与监控

## 1. Management UI

```bash
# 启用管理插件
rabbitmq-plugins enable rabbitmq_management

# 访问
http://localhost:15672  # 默认用户 guest/guest
```

功能：队列管理、连接查看、消息发布、策略配置、用户管理。

## 2. rabbitmqctl 命令

```bash
# 集群状态
rabbitmqctl cluster_status

# 节点状态
rabbitmqctl status

# 列出队列
rabbitmqctl list_queues name messages consumers memory

# 列出连接
rabbitmqctl list_connections name peer_host state

# 列出通道
rabbitmqctl list_channels connection_name number consumer_count

# 列出交换机
rabbitmqctl list_exchanges

# 列出绑定
rabbitmqctl list_bindings

# 清空队列
rabbitmqctl purge_queue queue_name
```

## 3. Prometheus 监控

```bash
# 启用 Prometheus 插件
rabbitmq-plugins enable rabbitmq_prometheus

# 指标端点
http://localhost:15692/metrics
```

### 关键指标

| 指标 | 说明 | 告警阈值 |
| :-- | :-- | :-- |
| rabbitmq_queue_messages | 队列消息总数 | 持续增长 |
| rabbitmq_queue_messages_ready | 待消费消息数 | > 10000 |
| rabbitmq_queue_messages_unacked | 未确认消息数 | > Prefetch × 2 |
| rabbitmq_connections | 连接数 | > 80% max |
| rabbitmq_channels | 通道数 | > 80% max |
| rabbitmq_node_mem_used | 节点内存使用 | > 80% |
| rabbitmq_node_disk_free | 磁盘可用空间 | < disk_free_limit |
| rabbitmq_channel_messages_published_total | 发布速率 | 基线监控 |
| rabbitmq_channel_messages_delivered_total | 投递速率 | 基线监控 |

## 4. 日志

```bash
# 日志位置
/var/log/rabbitmq/rabbit@hostname.log

# 日志级别
rabbitmqctl set_log_level debug  # debug/info/warning/error
```

## 5. 常用运维操作

```bash
# 关闭节点
rabbitmqctl stop_app

# 重置节点（清除所有数据）
rabbitmqctl reset

# 强制移除故障节点
rabbitmqctl forget_cluster_node rabbit@failed_node

# 同步队列
rabbitmqctl sync_queue queue_name

# 取消同步
rabbitmqctl cancel_sync_queue queue_name
```
