# 优先级队列

> 优先级队列让高优先级的消息先被消费，适用于需要区分消息紧急程度的场景。

## 1. 声明优先级队列

```java
Map<String, Object> args = new HashMap<>();
args.put("x-max-priority", 10); // 最大优先级 10
channel.queueDeclare("priority.queue", true, false, false, args);
```

## 2. 发送优先级消息

```java
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
    .priority(5) // 优先级 5（0-10，数字越大优先级越高）
    .build();
channel.basicPublish(exchange, routingKey, props, body);
```

## 3. 优先级范围

| 值 | 说明 |
| :-- | :-- |
| 0 | 最低优先级（默认） |
| 1-10 | 自定义优先级 |
| >10 | 不推荐，增加内存开销 |

## 4. 工作原理

```text
Queue 内部维护优先级堆：
┌───────────┐
│ Priority 10│ ← 最先被消费
├───────────┤
│ Priority 5 │
├───────────┤
│ Priority 0 │ ← 最后被消费
└───────────┘
```

## 5. 注意事项

| 事项 | 说明 |
| :-- | :-- |
| 内存开销 | 优先级队列维护堆结构，内存略高 |
| 持久化 | 优先级信息不持久化，重启后丢失 |
| 已入队消息 | 优先级只影响未投递的消息 |
| Quorum Queue | 部分支持（3.10+） |
| Stream Queue | 不支持 |

## 6. 典型场景

### 6.1 订单处理

```text
priority.order.queue (max-priority=10)
  ├── Priority 10: VIP 订单
  ├── Priority 5:  普通订单
  └── Priority 0:  低优先级任务
```

### 6.2 告警通知

```text
priority.alert.queue (max-priority=5)
  ├── Priority 5: P0 告警（立即处理）
  ├── Priority 3: P1 告警
  └── Priority 1: P2 告警
```

## 7. 替代方案

如果不想使用优先级队列：

- 不同优先级使用不同队列
- 高优先级队列的消费者更多或 prefetch 更大
- 用多个消费者组分别消费不同队列
