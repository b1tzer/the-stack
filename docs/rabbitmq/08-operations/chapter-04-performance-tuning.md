# 性能调优

## 1. Producer 端优化

| 优化项 | 方法 | 效果 |
|--------|------|------|
| 异步 Confirm | 用 addConfirmListener 替代 waitForConfirms | 吞吐量提升 3-5 倍 |
| 批量发送 | 累积一批消息后统一发送 | 减少网络往返 |
| 多 Channel | 每个线程一个 Channel | 并行发送 |
| 消息压缩 | GZIP/Snappy 压缩消息体 | 减少网络传输量 |
| 连接复用 | 所有线程共享一个 Connection | 减少连接开销 |

## 2. Broker 端优化

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| vm_memory_high_watermark | 0.6 | 0.7 | 内存高水位 |
| disk_free_limit | 50M | 1G | 磁盘低水位 |
| channel_max | 2047 | 2047 | 最大 Channel 数 |
| heartbeat | 60 | 30 | 心跳间隔 |
| tcp_listen_options.backlog | 128 | 1024 | TCP 连接队列 |
| tcp_listen_options.nodelay | true | true | 关闭 Nagle 算法 |

## 3. Consumer 端优化

| 优化项 | 方法 | 效果 |
|--------|------|------|
| 合理 Prefetch | 设为每秒处理能力的 1-2 倍 | 平衡吞吐和延迟 |
| 批量 ACK | 多条消息处理完后统一 ACK | 减少 ACK 往返 |
| 多消费者 | 增加消费者数量 | 水平扩展 |
| 异步处理 | 消费者内部用异步 IO | 提升单消费者吞吐 |

## 4. Queue 选型对性能的影响

| Queue 类型 | 写入吞吐 | 读取吞吐 | 延迟 |
|-----------|----------|----------|------|
| Classic (内存) | 最高 | 最高 | 微秒 |
| Classic (磁盘) | 中 | 中 | 毫秒 |
| Quorum | 中 | 高 | 1-5ms |
| Stream | 高 | 高 | 毫秒 |

## 5. 监控驱动调优

```bash
# 检查队列深度
rabbitmqctl list_queues name messages_ready messages_unacknowledged

# 检查连接和通道
rabbitmqctl list_connections name channels

# 检查内存使用
rabbitmqctl list_queues name memory | sort -t$'\t' -k2 -rn | head -10
```

## 6. 压测工具

```bash
# 使用 PerfTest 压测
bin/runjava com.rabbitmq.perf.PerfTest \
  -h amqp://localhost \
  -x 5 -y 5 \  # 5 生产者 5 消费者
  -u test.queue \
  -a \  # 异步确认
  --queue-args x-queue-type=quorum \
  --rate 10000
```
