# Fanout Exchange

> Fanout Exchange 忽略 routing key，将消息广播到所有绑定的 Queue。路由规则简单。

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

// 排他 Queue 与声明它的连接绑定，连接关闭后由 Broker 删除
```

适用于：实时通知、聊天消息、股票行情推送。

临时 Queue 只覆盖在线订阅期间的消息。若需要离线补收，应使用适当配置的持久化队列和持久化消息，并结合发布确认、消费确认及失败重试等机制，同时处理消息未成功路由与重复投递的情况；Fanout 本身不提供离线留存或端到端处理保证。

### 2.3 事件广播

```txt
配置变更事件 → Fanout Exchange → 缓存服务（清除本地缓存）
                                → 日志服务（记录变更）
                                → 监控服务（触发检查）
```

## 3. Fanout vs Topic（广播场景）

| 特性 | Fanout | Topic（用 `#`） |
| :-- | :-- | :-- |
| 路由规则 | 不按 routing key 过滤 | 按 binding key 模式匹配 |
| 路由筛选 | 不支持 | 支持（按模式筛选） |
| 适用场景 | 所有绑定队列都应收到消息 | 需要按消息类别筛选 |

**选择建议**：如果所有绑定 Queue 都需要收到消息，用 Fanout。如果部分 Queue 需要过滤，用 Topic。

Topic 用 `#` 可以匹配常规 routing key，得到与 Fanout 相似的广播结果，但 Topic 仍按 binding key 与 routing key 的匹配规则路由；选择 Topic 的意义在于保留按模式筛选的能力，而不是用 `#` 模拟 Fanout。若始终不需要按 routing key 过滤，Fanout 的路由语义更直接。

## 4. 注意事项

**4.1 临时 Queue 的清理**

Exclusive Queue 与声明它的连接绑定，连接关闭（正常关闭或被 Broker 检测为关闭）后由 Broker 删除；Auto-delete Queue 在至少有过一个消费者、且最后一个消费者取消订阅后自动删除。网络异常下 Broker 检测到连接失效存在延迟，清理可能滞后，并非断开瞬间立即完成。

若需要给临时队列设置闲置过期时间，可用 x-expires（队列闲置指定时长后自动删除），这与连接断开检测是两套机制：

```java
// 独立示例：声明一个带闲置过期时间的队列（x-expires 是闲置过期机制，与连接断开检测无关）
Map<String, Object> args = new HashMap<>();
args.put("x-expires", 30000);
channel.queueDeclare("temporary.queue", false, false, false, args);
```

**4.2 消息丢失风险**

Fanout Exchange 不保证消息被消费。消息成功路由到 Queue 后，如果没有消费者，通常会在队列中等待；若配置了消息 TTL、队列长度限制等机制，消息也可能过期或被丢弃。发布确认、消费确认与可靠投递机制详见 [Exchange 基础](./chapter-01-exchange-basics.md) 与 [Publisher Confirm](../04-producer/chapter-02-publisher-confirm.md)。

**4.3 广播开销**

一条消息路由到 N 个 Queue，会增加与目标队列数量相关的路由、入队和后续投递开销。如果 Queue 数量很多且消息量大，要关注 Broker 的内存和 CPU 使用。
