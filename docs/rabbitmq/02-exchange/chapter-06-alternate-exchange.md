# Alternate Exchange

> Alternate Exchange（备用交换器）解决了消息路由失败后的处理问题。当消息无法路由到任何队列时，会被发送到备用交换器。

## 1. 工作机制

```text
Producer ──▶ Main Exchange
                  │
                  ├── 路由成功 ──▶ Queue
                  │
                  └── 路由失败 ──▶ Alternate Exchange
                                      │
                                      ├──▶ Dead Letter Queue
                                      └──▶ Log Queue
```

## 2. 配置方式

### 2.1 声明时指定

```java
Map<String, Object> args = new HashMap<>();
args.put("alternate-exchange", "ae.unrouted");
channel.exchangeDeclare("main.exchange", BuiltinExchangeType.DIRECT,
    true, false, false, args);
```

### 2.2 策略配置

```bash
rabbitmqctl set_policy ae "^main\." '{"alternate-exchange":"ae.unrouted"}' --apply-to exchanges
```

## 3. 备用交换器类型

推荐使用 fanout 类型作为备用交换器：

```text
main.exchange (direct) ──alternate──▶ ae.unrouted (fanout)
                                        ├──▶ unrouted-queue（收集未路由消息）
                                        └──▶ alert-queue（告警通知）
```

## 4. 与 Mandatory 的区别

| 特性 | Alternate Exchange | Mandatory Flag |
| :-- | :-- | :-- |
| 触发条件 | 路由失败 | 路由失败 |
| 处理方式 | 转发到备用交换器 | Return 给生产者 |
| 生产者感知 | 不感知 | 收到 Return 回调 |
| 适用场景 | 兜底收集 | 生产者需要知道路由失败 |

## 5. 最佳实践

- 所有生产 Exchange 都应配置备用交换器
- 备用交换器绑定一个收集队列，定期检查
- 配合告警，及时发现路由配置错误
- 备用交换器命名约定：`ae.<原交换器名>`
