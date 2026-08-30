# 常见问题排查

> 本章总结 RabbitMQ 生产环境中最常见的问题和排查方法。

## 1. 消息堆积

### 1.1 症状

- 队列消息数持续增长
- 消费者数量正常
- 消费速度远低于生产速度

### 1.2 排查

```bash
# 检查消费者状态
rabbitmqctl list_queues name messages consumers

# 检查未确认消息
rabbitmqctl list_queues name messages_unacknowledged

# 检查消费者 prefetch
rabbitmqctl list_channels consumer_count prefetch_count
```

### 1.3 解决

- 增加消费者数量
- 调整 prefetch 值
- 优化消费者处理逻辑
- 使用 Quorum Queue 的 delivery-limit 避免无限重试

## 2. 消息丢失

### 2.1 可能原因

| 环节 | 原因 |
| :-- | :-- |
| 生产者 | 未开启 Confirm |
| Broker | 队列未持久化 |
| Broker | 镜像队列未同步 |
| 消费者 | 自动 ACK |

### 2.2 排查

```bash
# 检查队列持久化
rabbitmqctl list_queues name durable

# 检查镜像状态
rabbitmqctl list_queues name slave_pids synchronised_slave_pids
```

### 2.3 解决

- 生产者开启 Publisher Confirm
- 队列和消息都设置持久化
- 使用 Quorum Queue
- 消费者使用手动 ACK

## 3. 内存告警

### 3.1 症状

- Broker 进入内存告警状态
- 生产者被阻塞
- 日志出现 `memory resource limit alarm`

### 3.2 排查

```bash
# 查看内存使用
rabbitmqctl status | grep memory

# 查看队列内存占用
rabbitmqctl list_queues name memory messages
```

### 3.3 解决

- 调整 `vm_memory_high_watermark`
- 使用惰性队列（x-queue-mode=lazy）
- 减少消息堆积
- 增加节点内存

## 4. 连接数过多

### 4.1 症状

- 连接数达到上限
- 新连接被拒绝
- 日志出现 `connection_closed_max_limit`

### 4.2 排查

```bash
# 查看连接数
rabbitmqctl list_connections name peer_host state channels

# 查看连接来源
rabbitmqctl list_connections client_properties
```

### 4.3 解决

- 检查连接泄漏（未关闭的连接）
- 使用连接池
- 调整 `channel_max`
- 启用心跳检测

## 5. 网络分区

### 5.1 症状

- 集群节点间通信中断
- 日志出现 `network_partition`
- 部分队列不可用

### 5.2 排查

```bash
rabbitmqctl cluster_status
# 检查 partitions 字段
```

### 5.3 解决

- 使用 Quorum Queue
- 配置 pause_minority 策略
- 检查网络连通性
- 必要时手动恢复分区
