# Queue 基础

> Queue 是消息的最终存储单元。所有消息最终都落在 Queue 里，等待消费者来取。

## 1. Queue 的本质

Queue 是一个有序的、先进先出（FIFO）的消息存储。但和普通的内存队列不同，RabbitMQ 的 Queue 需要处理：

- 持久化（Broker 重启后消息不丢）
- 多消费者竞争消费
- 消息确认（消费成功才删除）
- 优先级
- 死信
- 长度/大小限制

## 2. Queue 属性

| 属性 | 说明 | 默认值 |
|------|------|--------|
| Name | 队列名称 | 服务端生成（UUID） |
| Durable | 持久化（Broker 重启后保留 Queue 定义） | false |
| Exclusive | 仅限当前连接，连接断开自动删除 | false |
| Auto Delete | 所有消费者断开后自动删除 | false |
| Arguments | 扩展参数（TTL/长度/死信/优先级等） | null |

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

两者缺一不可。

### 2.2 Exclusive 的用途

Exclusive Queue 只能被声明它的连接消费，连接断开自动删除。适用于：

- RPC 回调队列
- 临时订阅（客户端断开即清理）
- 不需要持久化的临时场景

### 2.3 命名规范

```text
业务队列：order.created、payment.processed
死信队列：dlx.order.created
延迟队列：delay.order.timeout
回退队列：ae.unrouted
工作队列：task.email.send
```

## 3. 幂等声明

多次声明相同名称、相同属性的 Queue 不会报错。但属性不同会报 `406 PRECONDITION_FAILED`。

```java
// 两个微服务实例启动时都声明同一个 Queue → 没问题
channel.queueDeclare("order.queue", true, false, false, null);
channel.queueDeclare("order.queue", true, false, false, null); // OK
```

这个设计让多个服务实例可以安全地声明自己需要的 Queue。

## 4. 消息生命周期

```text
消息进入 Queue
  │
  ├─ 被消费者消费 → basicAck → 从 Queue 删除
  ├─ 被消费者拒绝（basicNack, requeue=false）→ 进入 DLX
  ├─ 消息 TTL 到期 → 进入 DLX
  ├─ Queue 长度超限 → 进入 DLX（或丢弃最老消息）
  └─ 消费者断开（autoAck=true）→ 消息丢失（已发给消费者但未确认）
```

## 5. Queue 的内部实现

每个 Queue 是一个独立的 Erlang 进程：

```text
Queue Process
  ├─ ETS 表（小消息 < 4KB，直接存内存）
  ├─ 消息存储引用（大消息 ≥ 4KB，指向磁盘文件）
  └─ 消费者列表
```

- 小消息直接存在 ETS（内存），读写 O(1)
- 大消息存在磁盘消息存储文件中，Queue 中存引用
- 每个 Queue 独立调度，互不阻塞

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
