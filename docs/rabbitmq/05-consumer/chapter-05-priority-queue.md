# 优先级队列

> 优先级队列让高优先级的消息先被消费，即使它比低优先级的消息晚到。

## 1. 声明优先级队列

```java
Map<String, Object> args = new HashMap<>();
args.put("x-max-priority", 10);  // 最大优先级，仅 Classic Queue 生效，官方建议使用 2-4 个优先级级别
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

```txt
Queue 中的消息：
  [msg1(priority=1), msg2(priority=5), msg3(priority=10)]

消费顺序：
  msg3(10) → msg2(5) → msg1(1)
```

Classic Queue 为不同优先级维护内部子队列，并轮转处理这些子队列。Quorum Queue 自 4.3 起采用严格优先级调度。

上面的顺序是理想结果。若低优先级消息已因 Prefetch 提前投递且未确认，后来到达的高优先级消息无法撤回已发生的投递，实际顺序受 Prefetch 影响。

## 4. 优先级的范围

| 值 | 含义 |
| :-- | :-- |
| 0 | 最低优先级（默认） |
| 1-9 | 中等优先级 |
| 10 | 最高优先级 |

x-max-priority 设为 10 意味着支持 0-10 共 11 个优先级。对 Classic Queue 而言，每个优先级级别都会增加内存与 CPU 开销，因此官方建议优先级数量保持个位数（2-4 个即可）。

## 5. 注意事项

**5.1 不同队列类型的支持情况**

Classic Queue 通过 x-max-priority 开启优先级，上限由该参数指定。Quorum Queue 自 4.3 起原生支持 0-31 共 32 级严格优先级，无需 x-max-priority，未设置 priority 属性的消息按 4 处理。Stream Queue 不支持消息优先级。

**5.2 优先级对已入队的消息无效**

消息入队后优先级不能修改。如果需要动态调整优先级，需要重新发送。

**5.3 性能影响**

Classic Queue 每增加一个优先级级别都会多占用内存与 CPU，因为每个级别对应独立的子队列，所以优先级数量应控制在个位数。高吞吐场景下要评估性能影响。

**5.4 不要过度使用**

大多数场景不需要优先级队列。如果所有消息都是"高优先级"，等于没有优先级。优先级只在"确实有高低之分"时使用。

**5.5 低优先级消息可能饥饿**

Classic Queue 会轮转处理不同优先级的子队列，避免低优先级消息因优先级调度而持续得不到处理。Quorum Queue 自 4.3 起采用严格优先级，持续到达的高优先级消息会让低优先级消息无限期延后。需要低优先级也能获得最低处理份额时，改用 §7 的多队列拆分方案。

## 6. 典型场景

| 场景 | 优先级设置 |
| :-- | :-- |
| 订单处理 | VIP 订单 priority=10，普通订单 priority=0 |
| 通知推送 | 紧急通知 priority=10，营销通知 priority=1 |
| 任务队列 | 实时任务 priority=5，批量任务 priority=1 |

## 7. 替代方案

如果不需要严格的优先级排序，可以用多个 Queue + 多消费者的方式实现"伪优先级"：

```txt
high.priority.queue → Consumer 1 (优先消费)
low.priority.queue  → Consumer 2 (独立处理低优先级任务)
```

这种方式更简单，但不能保证严格按优先级顺序消费。
