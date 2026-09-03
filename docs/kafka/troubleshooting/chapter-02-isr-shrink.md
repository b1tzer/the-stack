# ISR 频繁收缩

> ISR 收缩意味着副本同步出了问题。频繁收缩会导致 acks=all 的写入被拒绝，影响生产端可用性。

## 1. 现象

```bash
kafka-topics.sh --describe --under-replicated --bootstrap-server localhost:9092

# 输出中有大量 Under-replicated 分区
```

JMX 指标 `IsrShrinksPerSec` 和 `IsrExpandsPerSec` 频繁波动。

## 2. 快速判断

```txt
ISR 稳态 = 副本数 → 正常
ISR 偶尔收缩 → 网络抖动或 GC 停顿
ISR 持续收缩 → 网络故障、磁盘瓶颈或 Broker 负载过高
```

## 3. 逐步排查

### Step 1：检查网络

```bash
# 检查 Broker 之间的网络延迟
ping broker2
ping broker3

# 检查丢包
ping -c 100 broker2 | tail -1
```

### Step 2：检查磁盘 I/O

```bash
iostat -x 1

# 关注：
# - %util: 磁盘利用率，> 80% 说明磁盘是瓶颈
# - await: 平均 I/O 等待时间，> 10ms 说明磁盘慢
```

### Step 3：检查 GC 停顿

```bash
jstat -gc <kafka-pid> 1000

# 关注：
# - FGCT: Full GC 累计时间
# - FGC: Full GC 次数
```

GC 停顿超过 `replica.lag.time.max.ms` 会导致 Follower 被移出 ISR。

### Step 4：检查 Broker 负载

```bash
top -p $(pgrep -f kafka)

# 关注 CPU 和内存使用率
```

## 4. 常见根因

| 根因 | 现象 | 解决方案 |
| :-- | :-- | :-- |
| 网络延迟/丢包 | ISR 随机收缩，不同 Broker 上的分区交替 | 检查网络设备、带宽 |
| 磁盘 I/O 瓶颈 | %util > 80%，await 高 | 使用 SSD、增加磁盘 |
| GC 停顿 | ISR 收缩与 GC 时间吻合 | 调整 JVM 参数、增加堆内存 |
| Broker 负载过高 | CPU > 80% | 增加 Broker、分散分区 |
| replica.lag.time.max.ms 过小 | 轻微抖动就触发收缩 | 保持默认 30 秒 |

## 5. 参数调优

```properties
# 保持默认，不要盲目调小
replica.lag.time.max.ms=30000

# 提升 Follower 并行度
num.replica.fetchers=2
```

> 不要通过调小 `replica.lag.time.max.ms` 来"快速检测故障"。GC 停顿、网络抖动都会把它触发出 spurious shrink，导致 ISR 反复抖动。

## 6. 预防

- 监控 `UnderReplicatedPartitions` 和 `IsrShrinksPerSec`
- 保持 `replica.lag.time.max.ms` 默认值
- Broker 使用 SSD，减少磁盘 I/O 延迟
- JVM 堆内存合理配置，减少 GC 停顿
