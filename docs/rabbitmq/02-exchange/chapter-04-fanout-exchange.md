# Fanout Exchange

> Fanout Exchange 忽略 routing key，将消息广播到所有绑定的 Queue。最简单也最快。

## 1. 路由规则

```txt
Producer ──▶ Fanout Exchange ──▶ Queue A
                              ──▶ Queue B
                              ──▶ Queue C
                              (所有绑定的 Queue 都收到)
```

- 不看 routing key
- 不看 binding key
- 只要 Queue 绑定了这个 Exchange，就能收到消息

## 2. 典型场景

### 2.1 广播通知

```java
channel.exchangeDeclare("notification.fanout", BuiltinExchangeType.FANOUT, true);

// 多个服务各自创建自己的 Queue 并绑定
channel.queueDeclare("sms.queue", true, false, false, null);
channel.queueBind("sms.queue", "notification.fanout", "");  // routing key 无意义

channel.queueDeclare("email.queue", true, false, false, null);
channel.queueBind("email.queue", "notification.fanout", "");

channel.queueDeclare("push.queue", true, false, false, null);
channel.queueBind("push.queue", "notification.fanout", "");

// 发送一条消息，三个服务都收到
channel.basicPublish("notification.fanout", "", null, body);
```

### 2.2 实时推送（配合临时 Queue）

```java
// 每个客户端创建一个排他 Queue，绑定到 Fanout Exchange
String queueName = channel.queueDeclare().getQueue();  // 自动生成唯一名
channel.queueBind(queueName, "realtime.fanout", "");

// 客户端断开连接时，排他 Queue 自动删除
```

适用于：实时通知、聊天消息、股票行情推送。

### 2.3 事件广播

```txt
配置变更事件 → Fanout Exchange → 缓存服务（清除本地缓存）
                                → 日志服务（记录变更）
                                → 监控服务（触发检查）
```

## 3. Fanout vs Topic（广播场景）

| 特性 | Fanout | Topic（用 `#`） |
| :-- | :-- | :-- |
| 路由开销 | 无（直接广播） | 有（模式匹配） |
| 灵活性 | 低（全部广播） | 高（可以选择性广播） |
| 性能 | 最快 | 稍慢 |
| 适用场景 | 真正的广播 | 需要过滤的广播 |

**选择建议**：如果所有绑定 Queue 都需要收到消息，用 Fanout。如果部分 Queue 需要过滤，用 Topic。

## 4. 注意事项

**4.1 临时 Queue 的清理**

使用 Fanout + 临时 Queue 时，客户端断开后 Queue 会自动删除（Exclusive 或 Auto Delete）。但如果客户端异常断开（没发 close），Queue 会残留直到连接超时。

```java
// 设置 Queue 的自动过期（30秒无消费者则删除）
Map<String, Object> args = new HashMap<>();
args.put("x-expires", 30000);
channel.queueDeclare(tempQueue, false, false, false, args);
```

**4.2 消息丢失风险**

Fanout Exchange 不保证消息被消费。如果某个 Queue 没有消费者，消息会堆积在 Queue 中（或被丢弃，取决于 Queue 配置）。

**4.3 性能放大**

一条消息被广播到 N 个 Queue，相当于 Broker 处理了 N 条消息。如果 Queue 数量很多且消息量大，要关注 Broker 的内存和 CPU 使用。
