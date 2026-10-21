# 高延迟排查

> 端到端延迟高意味着消息从生产到消费的耗时超出了预期。本文从生产者、Broker、网络和消费者几个环节定位。

## 1. 现象

排查前先确认延迟的测量边界：起止事件（生产者发送到收到确认、Broker 写入、消费者拉取到业务处理）和时间戳来源，不同埋点测的不是同一种延迟。

- 消费者收到消息的时间远晚于生产者发送的时间
- 监控中 end-to-end latency 指标升高

## 2. 快速判断

```txt
单个 Topic 延迟高 → 优先检查该 Topic 的 Broker/分区
所有 Topic 延迟高 → 优先检查网络或 Broker 整体负载
单个消费者组延迟高 → 优先检查消费者处理速度
```

> 以上映射是初步的排查方向，不是根因结论，最终需结合下方指标核实。

## 3. 逐步排查

### Step 1：检查 Broker 负载

```bash
# CPU
top -p $(pgrep -f kafka)

# 磁盘 I/O
iostat -x 1

# GC 状态（jstat -gc 展示 GC 次数与内存，停顿时长需看 GC 日志或 JFR）
jstat -gc <kafka-pid> 1000
```

| 指标 | 参考范围 | 需关注 |
| :-- | :-- | :-- |
| CPU | < 70% | > 80% |
| 磁盘 %util | < 70% | > 80% |
| GC 停顿 | 未引发请求延迟尖峰 | 与延迟尖峰时间相关 |

> 上表为经验参考值，需结合机器基线和使用趋势判断，不能作为通用判据。例如 %util 对 SSD 与多队列设备不敏感，数值高不一定代表瓶颈。

### Step 2：检查网络

```bash
# Broker 间连通性（ICMP 正常不代表 Kafka 数据路径正常，仅作基础检查）
ping broker2

# 端到端连通性
ping consumer-host

# Kafka TCP 连接状态（RTT、重传）
ss -ti

# 带宽使用
sar -n DEV 1
```

> ping 只能验证连通性，ICMP 往返时间与 Kafka TCP 请求延迟不等价。需结合 `ss -ti` 的 RTT/重传和 Broker 请求耗时指标，判断数据路径是否真的存在延迟。

### Step 3：检查消费者

```bash
kafka-consumer-groups.sh --describe --group my-group --bootstrap-server localhost:9092
```

Lag 持续增长时，检查消费速率是否低于生产速率，结合再均衡与单条消息处理耗时判断，见 [消费者 Lag 过大](./chapter-01-consumer-lag.md)。

### Step 4：检查生产者

```java
// 低延迟排查配置（对照验证用，确认瓶颈前不要直接改线上）
props.put("linger.ms", 0);           // 减少等待
props.put("batch.size", 16384);      // 减小批次
```

## 4. 常见根因

| 根因 | 现象 | 解决方案 |
| :-- | :-- | :-- |
| Broker 负载过高 | CPU/磁盘/内存使用率高 | 增加 Broker、分散分区 |
| 磁盘 I/O 瓶颈 | %util > 80% | 使用 SSD |
| GC 停顿 | GC 时间长、请求延迟尖峰 | 先确认停顿类型与成因，再调 JVM 参数 |
| 分区过多 | Controller 负载升高、元数据开销大 | 先确认 Controller 是否成为瓶颈，Kafka 不支持直接缩减现有 Topic 分区数 |
| 副本同步延迟 | ISR 频繁收缩 | 检查网络和磁盘，见 [ISR 频繁收缩排查](./chapter-02-isr-shrink.md) |
| 消费者处理慢 | Lag 持续增长 | 优化消费者或增加实例 |

## 5. 生产者端优化

以下参数是场景化取舍，不是通用默认方案。调整前先确认瓶颈确实在生产者端，调整后对比生产者请求延迟指标（原生指标为平均值与最大值，分位数需监控系统实际采集）验证效果。

```java
// 高吞吐配置（牺牲一些延迟）
props.put("batch.size", 65536);
props.put("linger.ms", 20);
props.put("compression.type", "lz4");

// 低延迟配置（CPU 充足、网络不紧张时更适用）
props.put("batch.size", 16384);
props.put("linger.ms", 0);
props.put("compression.type", "none");
```

> 关闭压缩不必然降低延迟：网络带宽受限时，`compression.type=none` 会增加传输量，反而可能恶化端到端延迟。压缩选择应结合消息大小、到达速率、CPU 开销与带宽综合判断。

详见 [吞吐调优](../04-performance/chapter-02-throughput-tuning.md)。
