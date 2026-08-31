# 性能基准与调优

> 本章提供 RabbitMQ 不同配置下的性能基准数据，以及调优方法论。

## 1. 测试环境

| 配置 | 说明 |
| :-- | :-- |
| 机器 | 4C8G SSD |
| 网络 | 同机房内网 |
| RabbitMQ | 3.12 |
| Java | 17 |
| 消息大小 | 1KB |

## 2. 性能基准

### 2.1 生产者

| 队列类型 | 同步发送 | 异步 Confirm | 批量 Confirm |
| :-- | :-- | :-- | :-- |
| Classic Queue | 2,000 msg/s | 25,000 msg/s | 40,000 msg/s |
| Quorum Queue | 1,500 msg/s | 10,000 msg/s | 15,000 msg/s |
| Stream Queue | 5,000 msg/s | 50,000 msg/s | 100,000 msg/s |

### 2.2 消费者

| 队列类型 | prefetch=1 | prefetch=10 | prefetch=100 |
| :-- | :-- | :-- | :-- |
| Classic Queue | 1,000 msg/s | 10,000 msg/s | 20,000 msg/s |
| Quorum Queue | 800 msg/s | 8,000 msg/s | 12,000 msg/s |
| Stream Queue | 5,000 msg/s | 50,000 msg/s | 100,000 msg/s |

### 2.3 延迟

| 操作 | 延迟 |
| :-- | :-- |
| 单条发布 | 0.1~0.5ms |
| 发布到消费 | 1~5ms |
| Quorum Queue 写入 | 2~10ms |

## 3. 调优方法论

### 3.1 识别瓶颈

```text
Producer 慢？──▶ 检查 Confirm 策略
Broker 慢？   ──▶ 检查队列类型和内存
Consumer 慢？ ──▶ 检查 prefetch 和处理逻辑
```

### 3.2 调优步骤

1. 基准测试：单线程、单队列
2. 逐步增加并发
3. 观察吞吐量和延迟
4. 找到拐点（吞吐量不再增长）
5. 分析瓶颈（CPU/内存/网络/磁盘）

## 4. 常见调优项

| 项目 | 调优方向 |
| :-- | :-- |
| 生产者 | 异步 Confirm + 批量发送 |
| 队列 | 根据场景选择队列类型 |
| 消费者 | 合理 prefetch + 多消费者 |
| 消息 | 压缩 + 二进制格式 |
| 连接 | 连接池 + Channel 复用 |
| Broker | 内存 + 磁盘 + TCP 参数 |

## 5. 性能陷阱

| 陷阱 | 说明 |
| :-- | :-- |
| 同步 Confirm | 每条消息等确认，吞吐量极低 |
| prefetch=1 | 消费者空闲时间长 |
| 大消息 | 网络和内存开销大 |
| 频繁声明 | 重复声明交换器/队列 |
| 消息堆积 | Classic Queue 堆积时性能下降 |
| 事务 | 事务性能远低于 Confirm |
