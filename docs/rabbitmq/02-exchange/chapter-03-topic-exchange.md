# Topic Exchange

> Topic Exchange 支持通配符匹配，是 RabbitMQ 最灵活的路由方式。

## 1. 路由规则

routing key 用 `.` 分隔为多个词，binding key 支持两种通配符：

| 通配符 | 含义 | 示例 |
|--------|------|------|
| `*` | 匹配一个词 | `order.*` 匹配 `order.created`，不匹配 `order.item.created` |
| `#` | 匹配零个或多个词 | `order.#` 匹配 `order.created`、`order.item.created`、`order` |

## 2. 匹配示例

```text
Binding Key          routing key = "order.created"    routing key = "order.item.created"
─────────────────────────────────────────────────────────────────────────────────────────
order.created        ✅ 匹配                          ❌ 不匹配
order.*              ✅ 匹配（* = created）            ❌ 不匹配（* 只匹配一个词）
order.#              ✅ 匹配（# = created）            ✅ 匹配（# = item.created）
#.created            ✅ 匹配（# = order）              ✅ 匹配（# = order.item）
*.*                  ✅ 匹配（* = order, * = created） ❌ 不匹配（只有两个 *，需要三个词）
#                    ✅ 匹配                           ✅ 匹配
```

## 3. 典型场景

### 3.1 事件订阅系统

```text
Producer routing key: "order.created" / "order.paid" / "payment.success" / "payment.failed"

Binding:
  order.*     → order.events.queue     (所有订单事件)
  payment.*   → payment.events.queue   (所有支付事件)
  #.failed    → alert.queue            (所有失败事件，触发告警)
  #           → audit.queue            (所有事件，审计日志)
```

```java
channel.exchangeDeclare("event.exchange", BuiltinExchangeType.TOPIC, true);

channel.queueDeclare("order.events", true, false, false, null);
channel.queueBind("order.events", "event.exchange", "order.*");

channel.queueDeclare("alert.queue", true, false, false, null);
channel.queueBind("alert.queue", "event.exchange", "#.failed");

channel.queueDeclare("audit.queue", true, false, false, null);
channel.queueBind("audit.queue", "event.exchange", "#");
```

### 3.2 日志分级

```text
routing key: "log.{level}.{module}"
  log.error.payment  → error.queue + payment.log.queue
  log.info.auth      → info.queue + auth.log.queue
  log.warn.database  → warn.queue + database.log.queue

Binding:
  log.error.#   → error.queue
  log.*.payment  → payment.log.queue
  #              → all.log.queue
```

## 4. Topic vs Direct vs Fanout

| 需求 | 选择 |
|------|------|
| 精确路由（`order.created` → 指定 Queue） | Direct |
| 分类路由（`order.*` → 订单相关 Queue） | Topic |
| 广播（所有绑定 Queue 都收到） | Fanout |
| 按优先级路由（`#.error` → 告警 Queue） | Topic |

## 5. 性能注意事项

Topic Exchange 的路由需要模式匹配，比 Direct 的字符串比较稍慢。但在大多数场景下，这个差距可以忽略。只有在 binding 数量极多（>1000）且消息量极大（>10万/s）时，才需要考虑切换到 Direct Exchange。

## 6. 常见陷阱

**陷阱 1：`*` 和 `#` 的区别**

```text
order.*   → 匹配 order.created，不匹配 order.item.created
order.#   → 匹配 order.created，也匹配 order.item.created
```

`*` 只匹配一个词，`#` 匹配零个或多个词。

**陷阱 2：routing key 为空**

```text
routing key = "" → 只有 "#" 能匹配
```

**陷阱 3：词的数量不一致**

```text
binding key = "order.*"   → 匹配 "order.created"（2个词）
                           → 不匹配 "order"（1个词，* 需要一个词）
                           → 不匹配 "order.item.created"（3个词）
```
