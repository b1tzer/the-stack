# 常见问题排查

## 1. 消息堆积

**症状**：Queue 消息数持续增长，消费者处理不过来。

**排查**：
```bash
# 检查消费者数量
rabbitmqctl list_queues name messages consumers

# 检查消费者状态
rabbitmqctl list_channels consumer_count
```

**解决**：
- 增加消费者数量
- 优化消费者处理速度
- 检查是否有消费者卡死（未 ack）
- 增大 Prefetch

## 2. 消息丢失

**症状**：消息发了但消费者没收到。

**排查链路**：
```text
Producer → Publisher Confirm → Broker → Queue → Consumer → ACK
```

**检查项**：
- Publisher Confirm 是否开启？
- Queue 是否 Durable？消息是否 Persistent？
- Consumer 是否手动 ACK？
- 是否有死信队列？

## 3. 连接被拒

**症状**：客户端报 `connection refused`。

**排查**：
```bash
# 检查端口
telnet host 5672

# 检查连接数
rabbitmqctl list_connections

# 检查 max_connections
rabbitmqctl status | grep connection_limit
```

## 4. 内存告警

**症状**：生产者被阻塞（flow control）。

**排查**：
```bash
# 检查内存使用
rabbitmqctl status | grep mem_used

# 检查队列内存
rabbitmqctl list_queues name memory messages
```

**解决**：
- 消费堆积的消息
- 增大 `vm_memory_high_watermark`
- 清理不必要的 Queue

## 5. 磁盘告警

**症状**：生产者被阻塞。

**排查**：
```bash
# 检查磁盘空间
df -h

# 检查 RabbitMQ 磁盘限制
rabbitmqctl status | grep disk_free
```

## 6. 网络分区

**症状**：集群节点互相不可达。

**排查**：
```bash
rabbitmqctl cluster_status
# 检查 partitions 字段
```

**解决**：参考 [网络分区](../07-clustering/chapter-04-network-partition.md) 章节。

## 7. 慢消费者

**症状**：消息处理延迟高。

**排查**：
- 检查消费者日志
- 检查外部依赖（数据库、API）延迟
- 检查 Prefetch 设置

**解决**：
- 增加消费者并发
- 优化处理逻辑
- 增大 Prefetch
