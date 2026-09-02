# 优先级队列

> 优先级队列让高优先级的消息先被消费，即使它比低优先级的消息晚到。

## 1. 声明优先级队列

```java
Map<String, Object> args = new HashMap<>();
args.put("x-max-priority", 10);  // 最大优先级（0-10）
channel.queueDeclare("order.queue", true, false, false, args);
```

## 2. 发送优先级消息

```java
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
    .priority(5)  // 优先级（0-10，数字越大越优先）
    .build();

channel.basicPublish("order.exchange", "order.created", props, body);
```

## 3. 优先级的工作原理

```text
Queue 中的消息：
  [msg1(priority=1), msg2(priority=5), msg3(priority=10)]

消费顺序：
  msg3(10) → msg2(5) → msg1(1)
```

Queue 内部维护一个优先级堆，高优先级消息排在前面。

## 4. 优先级的范围

| 值 | 含义 |
|------|------|
| 0 | 最低优先级（默认） |
| 1-9 | 中等优先级 |
| 10 | 最高优先级 |

x-max-priority 设为 10 意味着支持 0-10 共 11 个优先级。设太大会增加内存开销。

## 5. 注意事项

**5.1 只有 Classic Queue 支持**

Quorum Queue 和 Stream Queue 不支持优先级。如果需要优先级，用 Classic Queue。

**5.2 优先级对已入队的消息无效**

消息入队后优先级不能修改。如果需要动态调整优先级，需要重新发送。

**5.3 性能影响**

优先级队列的入队和出队比普通队列慢（需要维护堆结构）。在高吞吐场景下要评估性能影响。

**5.4 不要过度使用**

大多数场景不需要优先级队列。如果所有消息都是"高优先级"，等于没有优先级。优先级只在"确实有高低之分"时使用。

## 6. 典型场景

| 场景 | 优先级设置 |
|------|-----------|
| 订单处理 | VIP 订单 priority=10，普通订单 priority=0 |
| 通知推送 | 紧急通知 priority=10，营销通知 priority=1 |
| 任务队列 | 实时任务 priority=5，批量任务 priority=1 |

## 7. 替代方案

如果不需要严格的优先级排序，可以用多个 Queue + 多消费者的方式实现"伪优先级"：

```text
high.priority.queue → Consumer 1 (优先消费)
low.priority.queue  → Consumer 2 (有空才消费)
```

这种方式更简单，但不能保证严格按优先级顺序消费。
