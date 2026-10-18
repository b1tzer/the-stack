# 队列参数

> Queue 的扩展参数（x-arguments）决定了队列的行为特性。多数参数在声明时设置、创建后固定，少数可通过 Policy 调整（见 §5）。

## 1. 参数总览

| 参数 | 类型 | Classic | Quorum | Stream | 说明 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| x-queue-type | string | ✅ | ✅ | ✅ | 队列类型 |
| x-max-length | int | ✅ | ✅ | ❌ | 最大消息数 |
| x-max-length-bytes | int | ✅ | ✅ | ✅ | 最大字节数 |
| x-overflow | string | ✅ | ✅ | ❌ | 超限行为 |
| x-message-ttl | int | ✅ | ✅ | ❌ | 消息 TTL（ms） |
| x-expires | int | ✅ | ✅ | ❌ | Queue 空闲超时（ms） |
| x-max-priority | int | ✅ | ❌ | ❌ | 最大优先级 |
| x-dead-letter-exchange | string | ✅ | ✅ | ❌ | 死信 Exchange |
| x-dead-letter-routing-key | string | ✅ | ✅ | ❌ | 死信 routing key |
| x-delivery-limit | int | ❌ | ✅ | ❌ | 最大投递次数 |
| x-quorum-initial-group-size | int | ❌ | ✅ | ❌ | 初始组大小 |
| x-max-in-memory-length | int | ❌ | ✅ | ❌ | 内存中最大消息数（3.10 起被忽略） |
| x-max-in-memory-bytes | int | ❌ | ✅ | ❌ | 内存中最大字节数（3.10 起被忽略） |
| x-stream-max-segment-size-bytes | int | ❌ | ❌ | ✅ | Segment 大小 |
| x-max-age | string | ❌ | ❌ | ✅ | 消息保留时间 |

> 两点补充：Quorum Queue 的消息 TTL（`x-message-ttl`）自 RabbitMQ 3.10 起才支持；`x-message-ttl`、`x-max-length`、死信配置等参数还可通过 Policy 统一调整，但 Policy 并非适用于所有参数（见 §5）。

## 2. 超限行为（x-overflow）

| 值 | 说明 |
| :-- | :-- |
| `drop-head` | 丢弃队头最老的消息（默认） |
| `reject-publish` | 拒绝新消息（需 Publisher Confirm 才能收到 nack） |
| `reject-publish-dlx` | 拒绝新消息并发送到 DLX |

`reject-publish-dlx` 仅 Classic Queue 支持，Quorum Queue 只支持 `drop-head` 和 `reject-publish`。此外 Quorum Queue 的 `reject-publish` 并不严格限制上限，可能短时超出 `x-max-length` 若干条消息；启用该策略时，生产者应使用 Publisher Confirm 接收 Broker 返回的 nack，而不是把发布调用成功等同于消息已被接受。

```java
Map<String, Object> args = new HashMap<>();
args.put("x-max-length", 10000);
args.put("x-overflow", "reject-publish");
channel.queueDeclare("bounded.queue", true, false, false, args);
```

## 3. 消息 TTL（x-message-ttl）

消息在 Queue 中的最大存活时间。超时后消息会被移除；仅当 Queue 配置了死信 Exchange 时，过期消息才会按死信规则路由，否则直接丢弃。TTL 表示存活上限，不提供精确定时投递。

```java
// Queue 级别 TTL：所有消息统一 60 秒
Map<String, Object> args = new HashMap<>();
args.put("x-message-ttl", 60000);
args.put("x-dead-letter-exchange", "dlx.exchange");
channel.queueDeclare("delay.queue", true, false, false, args);
```

也可以在发送消息时设置单条消息的 TTL（`expiration` 属性），两者取较小值。

## 4. Queue 过期（x-expires）

Queue 在指定时间内未被使用（无消费者、无 `basic.get`、未被重新声明）则自动删除。

```java
Map<String, Object> args = new HashMap<>();
args.put("x-expires", 300000);  // 持续 5 分钟未被使用则删除
channel.queueDeclare("temp.queue", false, false, false, args);
```

适用于临时 Queue 的自动清理。

## 5. 参数可变性

扩展参数并非全部不可变，要区分两类：

- 创建时固定：队列类型（`x-queue-type`）、Classic Queue 的最大优先级数（`x-max-priority`）等，声明后无法修改。
- 可通过 Policy 调整：`x-message-ttl`、`x-max-length`、死信配置等，能用 Policy 统一管理，无需在代码里硬编码。注意 Policy 与声明参数冲突时声明参数优先，因此用 Policy 管理的参数不应在声明时重复硬编码。

对于创建时固定的参数，要改只能：

1. 创建一个新 Queue（新参数）
2. 将生产者切换到新 Queue
3. 等待旧 Queue 消费完毕
4. 删除旧 Queue
