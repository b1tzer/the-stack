# Prefetch 与背压

> Prefetch 控制 Broker 向 Consumer 推送消息的速率，防止 Consumer 被压垮。

## 1. 问题：没有 Prefetch 会怎样

```txt
Broker ──msg1──▶ Consumer（正在处理 msg1）
Broker ──msg2──▶ Consumer（msg2 在缓冲区等待）
Broker ──msg3──▶ Consumer（msg3 在缓冲区等待）
...
Broker ──msg1000──▶ Consumer（缓冲区爆了，内存溢出）
```

没有 Prefetch，Broker 会尽可能快地推送消息，不管 Consumer 处理得过来不。

## 2. Prefetch 设置

```java
// 设置 Prefetch 为 10
channel.basicQos(10);
```

| 值 | 含义 |
| :-- | :-- |
| 0 | 不限制（默认，危险） |
| 1 | 一次只推 1 条，处理完再推下一条 |
| N | 最多有 N 条未确认消息 |

Prefetch 只在手动确认下生效。使用自动确认（autoAck）时消息投递即被确认，`未确认消息数` 恒为 0，Prefetch 起不到限流作用。

## 3. Prefetch 的工作原理

```txt
Prefetch = 5
  当前 unacked 消息数 = 3
  Broker 可以继续推 2 条（5 - 3 = 2）
  
  Consumer ack 1 条 → unacked = 2 → Broker 可以推 3 条
```

Broker 维护一个滑动窗口：`未确认消息数 < Prefetch` 时才推送。

## 4. Prefetch 值的选择

| Prefetch | 适用场景 |
| :-- | :-- |
| 1 | 消息处理很慢（如调用外部 API）、需要严格公平 |
| 10-50 | 一般业务处理（数据库操作、简单计算） |
| 100+ | 消息处理很快（内存操作）、高吞吐场景 |
| 0 | 不推荐（除非 Consumer 有自己完善的背压机制） |

**经验法则**：上表分档只是调优起点。Prefetch 的合理值还受消息大小、确认延迟和消费者并发影响，没有固定公式，最终值以压测为准。

## 5. Prefetch 的作用范围

`basicQos(n)` 设置的是 per-consumer 预取额度，同一 Channel 上每个消费者各自独立拥有 n 条未确认消息的额度，互不影响：

```java
channel.basicQos(10);  // 每个消费者各自最多 10 条未确认消息
```

旧版的 `basicQos(n, true)` 会把额度设为整个 Channel 共享（global QoS）。该用法已在 RabbitMQ 4.0 移除，4.3 起默认拒绝，除非显式开启 `deprecated_features.permit.global_qos`，新代码不要使用。

## 6. 背压（Backpressure）

当 Consumer 处理速度跟不上 Broker 推送速度时，Prefetch 起到背压作用：

```txt
Consumer 处理慢 → unacked 消息数达到 Prefetch → Broker 停止推送
Consumer ack 一条 → unacked 减 1 → Broker 恢复推送
```

这是一种被动式流控：不需要 Consumer 主动拒绝，达到 Prefetch 上限后 Broker 自然暂停推送。

## 7. Quorum Queue 的 Prefetch 注意事项

Quorum Queue 基于 Raft 实现，消息体始终存储到磁盘，内存中只保留每条消息的元数据。`x-max-in-memory-length` 参数虽然仍被接受，但已不再起作用，效果等同于设为 0。

即使把 Prefetch 设成 0（不限制），单个消费者在 Quorum Queue 上最多也只能持有 2000 条未确认消息，这是 Broker 为避免 Raft 日志失控而设的上限。

官方建议 Quorum Queue 使用较高的 Prefetch 值，避免消费者在等待 ACK 流转期间被饿死。因此不要照搬 Classic Queue 的「Prefetch 越小越安全」直觉，10-50 只能作为初始试验值，最终值应结合消息大小、处理耗时和吞吐量压测确定。
