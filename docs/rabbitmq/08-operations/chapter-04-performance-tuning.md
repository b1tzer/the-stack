# 性能调优

> RabbitMQ 性能调优涉及 Broker 配置、队列选择、生产者和消费者参数优化。

## 1. Broker 调优

### 1.1 内存

```ini
# 内存高水位（物理内存的 40-60%）
vm_memory_high_watermark.relative = 0.5

# 内存告警后的处理
vm_memory_high_watermark_paging_ratio = 0.75
```

### 1.2 磁盘

```ini
# 磁盘空闲空间阈值
disk_free_limit.absolute = 2GB
```

### 1.3 TCP

```ini
tcp_listen_options.backlog = 128
tcp_listen_options.nodelay = true
tcp_listen_options.sndbuf = 196608
tcp_listen_options.recbuf = 196608
```

## 2. 队列选择

| 场景 | 推荐队列 |
| :-- | :-- |
| 高可靠性 | Quorum Queue |
| 高吞吐 | Classic Queue (lazy) |
| 消息回溯 | Stream Queue |
| 大量堆积 | Stream Queue / Lazy Queue |

## 3. 生产者调优

```java
// 异步 Confirm
channel.confirmSelect();
channel.addConfirmListener(confirmCallback, nackCallback);

// 批量发送
int batchSize = 200;
// ... 批量发送逻辑

// 消息压缩
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
    .contentEncoding("gzip")
    .build();
```

## 4. 消费者调优

```java
// 合理的 prefetch
channel.basicQos(100); // Quorum Queue 推荐较大值

// 多消费者并行
ExecutorService executor = Executors.newFixedThreadPool(10);
for (int i = 0; i < 10; i++) {
    executor.submit(() -> {
        channel.basicConsume(queue, false, deliverCallback, cancelCallback);
    });
}
```

## 5. 监控调优

```bash
# 查看队列性能指标
rabbitmqctl list_queues name messages message_bytes \
  message_bytes_ready message_bytes_unacknowledged \
  messages_ready messages_unacknowledged \
  consumers

# 查看连接性能
rabbitmqctl list_connections recv_oct recv_cnt send_oct send_cnt
```

## 6. 性能基准

| 配置 | 吞吐量 |
| :-- | :-- |
| Classic Queue, 单节点 | ~20,000 msg/s |
| Classic Queue, 异步 Confirm | ~30,000 msg/s |
| Quorum Queue, 3 节点 | ~10,000 msg/s |
| Stream Queue | ~1,000,000 msg/s |

## 7. 最佳实践

- 根据场景选择队列类型
- 生产者必须使用异步 Confirm
- 消费者 prefetch 根据处理能力调整
- 大消息压缩后再发送
- 定期清理过期队列和交换器
