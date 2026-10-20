# ISR 频繁收缩

> ISR 收缩意味着副本同步状态不稳定，可用副本冗余下降。当 ISR 成员数低于 `min.insync.replicas` 时，`acks=all` 写入才会被拒绝；即使写入仍能成功，也不能据此认定副本冗余充足。

## 1. 现象

```bash
kafka-topics.sh --describe --under-replicated --bootstrap-server localhost:9092

# 输出中有大量 Under-replicated 分区
```

JMX 指标 `IsrShrinksPerSec` 和 `IsrExpandsPerSec` 频繁波动。

## 2. 快速判断

```txt
ISR 稳态 = 副本数 → 当前副本均在 ISR 中，但不足以单独判定复制链路健康
ISR 偶尔收缩 → 网络抖动或 GC 停顿
ISR 持续收缩 → 网络故障、磁盘瓶颈或 Broker 负载过高
```

## 3. 逐步排查

### Step 0：定位收缩分区与责任 Broker

先确认收缩发生在哪些分区、集中在哪个 Broker，再往下找原因。这一步是后续资源检查的前提，避免把「某个 Broker 压力大」直接当成 ISR 收缩的根因。

```bash
# 列出当前欠副本（Under-replicated）分区及其 Leader、ISR 分布
kafka-topics.sh --describe --under-replicated --bootstrap-server localhost:9092
```

这条命令只反映当前的欠副本状态，短暂收缩后已恢复的分区不会出现在结果里。要还原历史收缩事件，需结合 Broker 日志中的 ISR 变更记录与 `IsrShrinksPerSec` 时间序列，定位事件发生的时间与范围；同时对比受影响分区的 Leader、ISR 和副本分布，确认收缩是否集中在特定 Broker，再与后续资源指标做时间对齐。

### Step 1：检查网络

这一步只用于发现 Broker 之间的连通性、丢包或延迟异常，不能直接证明副本复制链路存在问题，需与 Step 0 的收缩分区对应起来看。

```bash
# 检查 Broker 之间的网络延迟
ping broker2
ping broker3

# 检查丢包
ping -c 100 broker2 | tail -1
```

### Step 2：检查磁盘 I/O

磁盘指标只能说明磁盘压力，不能单独判定它就是 ISR 收缩的根因；需结合 Step 0 定位到的 Broker 与时间窗口判断。

```bash
iostat -x 1

# 关注（作为诊断线索，而非跨设备通用的固定阈值）：
# - %util: 磁盘利用率，持续接近 100% 提示磁盘可能是瓶颈，SSD 与 HDD 基准不同
# - await: 平均 I/O 等待时间，明显高于该设备常态提示磁盘慢
```

### Step 3：检查 GC 停顿

GC 主要影响 Follower 所在 Broker 能否及时拉取复制，Leader 侧的停顿也会通过拖慢复制进度间接影响追赶；需结合 Step 0 定位到的 Broker 角色与当时的复制状态判断。

```bash
jstat -gc <kafka-pid> 1000

# 关注：
# - FGCT: Full GC 累计时间
# - FGC: Full GC 次数
```

长时间 GC 停顿可能阻碍 Follower 在时间窗口内追上 Leader，是否被移出 ISR 取决于实际追赶状态与 `replica.lag.time.max.ms` 时间窗口，而非停顿时长本身。

### Step 4：检查 Broker 负载

进程负载只能说明 CPU 与内存压力，无法直接确认是哪个 Broker 或副本拉取线程造成了同步问题；需结合 Step 0 的收缩分区验证。

```bash
top -p $(pgrep -f kafka)

# 关注 CPU 和内存使用率
```

## 4. 常见根因

| 根因 | 现象 | 解决方案 |
| :-- | :-- | :-- |
| 网络延迟/丢包 | ISR 随机收缩，收缩分区无固定模式 | 检查网络设备、带宽 |
| 磁盘 I/O 瓶颈 | %util 持续接近 100%，await 明显高于常态 | 确认瓶颈类型后升级 SSD 或增加磁盘 |
| GC 停顿 | ISR 收缩与 GC 时间吻合 | 先确认 GC 类型与停顿原因，再调整 JVM 参数 |
| Broker 负载过高 | CPU 持续高位 | 增加 Broker、分散分区 |
| replica.lag.time.max.ms 过小 | 轻微抖动就触发收缩 | 保持默认值（2.5+ 为 30 秒） |

## 5. 参数调优

```properties
# 保持默认，不要盲目调小
replica.lag.time.max.ms=30000

# 仅在确认副本拉取并行度不足时，才评估增加线程数；增加线程不能解决磁盘、网络或 Leader 侧瓶颈
# num.replica.fetchers=2
```

> `replica.lag.time.max.ms` 默认值随版本变化：Kafka 2.5+ 为 30000ms，2.4 及以前为 10000ms，详见[参数速查](../reference/parameters.md)。不要通过调小它来"快速检测故障"，时间窗口缩短后，GC 停顿、网络抖动这类短暂延迟更容易让 Follower 被移出 ISR，引发不必要的反复收缩。

## 6. 预防

- 监控 `UnderReplicatedPartitions` 和 `IsrShrinksPerSec`
- 保持 `replica.lag.time.max.ms` 默认值
- Broker 使用 SSD，减少磁盘 I/O 延迟
- JVM 堆内存合理配置，减少 GC 停顿
