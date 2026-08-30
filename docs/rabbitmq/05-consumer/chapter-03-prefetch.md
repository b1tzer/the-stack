# Prefetch 与背压控制

> Prefetch 是 RabbitMQ 控制消费者一次能接收多少未确认消息的机制，是实现背压控制的核心。

## 1. 什么是 Prefetch

```text
prefetch = 10

Consumer ← [消息1][消息2]...[消息10] ← Queue
              │
              ▼
         处理 + ACK
              │
              ▼
         再接收最多 10 条
```

消费者在 ACK 之前最多持有 prefetch 条消息。

## 2. 设置 Prefetch

```java
// 全局 prefetch（该 Channel 上所有消费者共享）
channel.basicQos(10);

// 单消费者 prefetch
channel.basicQos(10, false);  // per-consumer = false
channel.basicQos(10, true);   // per-consumer = true
```

## 3. Prefetch 与吞吐量

| prefetch | 吞吐量 | 延迟 | 内存占用 |
| :-- | :-- | :-- | :-- |
| 1 | 低 | 高 | 低 |
| 10 | 中 | 中 | 中 |
| 100 | 高 | 低 | 高 |
| 无限 | 最高 | 最低 | 最高 |

## 4. Quorum Queue 的 Prefetch

Quorum Queue 推荐设置较大的 prefetch：

```java
// Quorum Queue 推荐 prefetch >= 投递限制
channel.basicQos(100); // x-delivery-limit 默认不限
```

原因：Quorum Queue 的消息确认需要多数节点参与，过小的 prefetch 会降低吞吐。

## 5. 背压控制策略

### 5.1 固定 Prefetch

```java
channel.basicQos(50); // 固定 50
```

### 5.2 动态 Prefetch

```java
// 根据消费者处理速度动态调整
int processingTime = measureProcessingTime();
int prefetch = Math.max(10, 1000 / processingTime);
channel.basicQos(prefetch);
```

### 5.3 全局限流

```java
// 限制整个队列的投递速率
// 使用 x-max-length + reject-publish
Map<String, Object> args = new HashMap<>();
args.put("x-max-length", 10000);
args.put("x-overflow", "reject-publish");
channel.queueDeclare("bounded.queue", true, false, false, args);
```

## 6. 最佳实践

- 根据消费者处理速度设置 prefetch
- CPU 密集型任务：prefetch = CPU 核心数
- IO 密集型任务：prefetch = 2~4 倍 CPU 核心数
- 不要设置过大的 prefetch，避免消息堆积在消费者内存
- Quorum Queue 使用较大的 prefetch（100+）
