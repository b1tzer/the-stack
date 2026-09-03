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

**经验法则**：Prefetch 设为 Consumer 每秒处理能力的 1-2 倍。如果 Consumer 每秒处理 50 条，Prefetch 设为 50-100。

## 5. 全局 Prefetch vs  Channel Prefetch

```java
// Channel 级别：这个 Channel 上所有消费者共享
channel.basicQos(10);

// 全局级别：这个 Connection 上所有 Channel 共享
channel.basicQos(100, true);  // global = true
```

**推荐用 Channel 级别**（global = false），每个消费者的 Prefetch 独立控制。

## 6. 背压（Backpressure）

当 Consumer 处理速度跟不上 Broker 推送速度时，Prefetch 起到背压作用：

```txt
Consumer 处理慢 → unacked 消息数达到 Prefetch → Broker 停止推送
Consumer ack 一条 → unacked 减 1 → Broker 恢复推送
```

这是一种优雅的流控机制：不需要 Consumer 主动拒绝，Prefetch 自动调节推送速率。

## 7. Quorum Queue 的 Prefetch 注意事项

Quorum Queue 的消息默认不在内存中缓存（`x-max-in-memory-length = 0`）。如果 Prefetch 设得很大，大量消息会被推送到 Consumer，但 Consumer 处理慢时，这些消息需要从磁盘重新读取。

建议：Quorum Queue 的 Prefetch 不要设太大，10-50 是合理范围。
