# Queue 基础

> Queue 是消息的存储单元。消息经 Exchange 路由后落到 Queue 里，等待消费者来取。

## 1. Queue 的本质

Queue 通常按消息入队顺序维护和投递消息，即先进先出（FIFO）。但这不保证多消费者并发场景下的业务处理顺序与入队顺序一致，优先级、重新入队等因素都可能改变实际观察到的顺序。和普通的内存队列不同，RabbitMQ 的 Queue 还需要处理：

- 持久化（Broker 重启后消息不丢）
- 多消费者竞争消费
- 消息确认（手动确认模式下 basicAck 后才删除）
- 优先级
- 死信
- 长度/大小限制

## 2. Queue 属性

| 属性 | 说明 | 默认值 |
| :-- | :-- | :-- |
| Name | 队列名称 | 未指定时由服务端生成 |
| Durable | 持久化（Broker 重启后保留 Queue 定义） | false |
| Exclusive | 仅限当前连接，连接断开自动删除 | false |
| Auto Delete | 最后一个消费者取消订阅后删除（需曾有过消费者） | false |
| Arguments | 扩展参数（TTL/长度/死信/优先级等） | null |

以上为 AMQP 0-9-1 的通用属性；Quorum Queue 与 Stream 对服务端生成名称、Exclusive 等属性有额外限制，见各队列类型章节。

```java
channel.queueDeclare(
    "order.queue",  // 队列名
    true,           // durable：持久化
    false,          // exclusive：非排他
    false,          // autoDelete：不自动删除
    null            // arguments：无扩展参数
);
```

### 2.1 Durable 的含义

`Durable = true` 只保证 Queue 的定义（元数据）在 Broker 重启后保留。**不保证消息持久化**。消息要持久化，还需要：

1. 消息的 `deliveryMode = 2`（Persistent）
2. Queue 声明为 Durable

两者缺一不可，它们是经典队列消息持久化的必要配置。但这组配置不等于端到端可靠投递，可靠投递还需要 Publisher Confirm 与消费者确认。不同队列类型的持久化与复制机制存在差异，见 [Classic Queue](chapter-02-classic-queue.md) 与 [Quorum Queue](chapter-03-quorum-queue.md)。

### 2.2 Exclusive 的用途

Exclusive Queue 只能被声明它的连接消费，连接断开自动删除。适用于：

- RPC 回调队列
- 临时订阅（客户端断开即清理）
- 不需要持久化的临时场景

### 2.3 命名规范

```txt
业务队列：order.created、payment.processed
死信队列：dlx.order.created
延迟队列：delay.order.timeout
回退队列：ae.unrouted
工作队列：task.email.send
```

## 3. 幂等声明

多次声明相同名称、相同属性的 Queue 不会报错。但同名队列以不兼容的属性重新声明时，会报 `406 PRECONDITION_FAILED`。

```java
// 两个微服务实例启动时都声明同一个 Queue → 没问题
channel.queueDeclare("order.queue", true, false, false, null);
channel.queueDeclare("order.queue", true, false, false, null); // OK
```

这个设计让多个服务实例可以安全地声明自己需要的 Queue。

## 4. 消息生命周期

```txt
消息进入 Queue
  │
  ├─ 被消费者消费 → basicAck → 从 Queue 删除
  ├─ 被消费者拒绝（basicNack, requeue=false）→ 成为死信
  ├─ 消息 TTL 到期 → 成为死信
  ├─ Queue 长度超限 → 按 overflow 策略处理（挤出最老消息或拒绝新消息）
  └─ 消费者断开（autoAck=true）→ 消息丢失（已发给消费者但未确认）

成为死信的消息：
  ├─ 已配置 DLX → 路由到死信交换机，再由绑定进入死信队列
  └─ 未配置 DLX → 被丢弃
```

死信的触发条件与转发细节因队列类型而异，见 [死信队列](chapter-06-dead-letter.md)。

## 5. Queue 的逻辑模型与实现差异

逻辑上，Queue 维护消息顺序、投递状态与消费者列表；具体到存储与复制机制，不同队列类型差异很大：

| 队列类型 | 存储与复制机制 |
| :-- | :-- |
| Classic Queue | 内存与磁盘混合存储 |
| Quorum Queue | 基于 Raft 共识的日志复制 |
| Stream Queue | 追加式日志，按段文件存储 |

各类型的完整机制见 [Classic Queue](chapter-02-classic-queue.md)、[Quorum Queue](chapter-03-quorum-queue.md) 与 [Stream Queue](chapter-04-stream-queue.md)。

## 6. Queue 与 Exchange 的关系

一个 Queue 可以绑定到多个 Exchange：

```java
channel.queueBind("notification.queue", "order.exchange", "order.created");
channel.queueBind("notification.queue", "user.exchange", "user.registered");
channel.queueBind("notification.queue", "system.exchange", "system.alert");
```

一个 Exchange 可以绑定多个 Queue：

```java
channel.queueBind("sms.queue", "notification.exchange", "");
channel.queueBind("email.queue", "notification.exchange", "");
channel.queueBind("push.queue", "notification.exchange", "");
```

Binding 是多对多的。
