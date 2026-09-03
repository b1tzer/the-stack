# 高延迟排查

> 端到端延迟高意味着消息从生产到消费的耗时超出了预期。本文按 Broker/网络/Consumer 三端定位。

## 1. 现象

- 消费者收到消息的时间远晚于生产者发送的时间
- 监控中 end-to-end latency 指标升高

## 2. 快速判断

```txt
单个 Topic 延迟高 → 该 Topic 的 Broker/分区有问题
所有 Topic 延迟高 → 网络或 Broker 整体负载问题
单个消费者组延迟高 → 消费者处理速度问题
```

## 3. 逐步排查

### Step 1：检查 Broker 负载

```bash
# CPU
top -p $(pgrep -f kafka)

# 磁盘 I/O
iostat -x 1

# GC 状态
jstat -gc <kafka-pid> 1000
```

| 指标 | 正常 | 异常 |
| :-- | :-- | :-- |
| CPU | < 70% | > 80% |
| 磁盘 %util | < 70% | > 80% |
| GC 停顿 | < 1s | > 3s |

### Step 2：检查网络

```bash
# Broker 间延迟
ping broker2

# 端到端延迟
ping consumer-host

# 带宽使用
sar -n DEV 1
```

### Step 3：检查消费者

```bash
kafka-consumer-groups.sh --describe --group my-group --bootstrap-server localhost:9092
```

Lag 过大 → 消费者处理速度不足，见 [消费者 Lag 过大](./chapter-01-consumer-lag.md)。

### Step 4：检查生产者

```java
// 生产者端延迟日志
props.put("linger.ms", 0);           // 减少等待
props.put("batch.size", 16384);      // 减小批次
```

## 4. 常见根因

| 根因 | 现象 | 解决方案 |
| :-- | :-- | :-- |
| Broker 负载过高 | CPU/磁盘/内存使用率高 | 增加 Broker、分散分区 |
| 磁盘 I/O 瓶颈 | %util > 80% | 使用 SSD |
| GC 停顿 | GC 时间长 | 调整 JVM 参数 |
| 分区过多 | Controller 处理慢 | 减少分区数（已创建的无法减少） |
| 副本同步延迟 | ISR 频繁收缩 | 检查网络和磁盘 |
| 消费者处理慢 | Lag 持续增长 | 优化消费者或增加实例 |

## 5. 生产者端优化

```java
// 高吞吐配置（牺牲一些延迟）
props.put("batch.size", 65536);
props.put("linger.ms", 20);
props.put("compression.type", "lz4");

// 低延迟配置
props.put("batch.size", 16384);
props.put("linger.ms", 0);
props.put("compression.type", "none");
```

详见 [吞吐调优](../performance/chapter-02-throughput-tuning.md)。
