# Topic Exchange

> Topic Exchange 根据 routing key 与 binding key 的模式匹配结果路由消息，适合按事件类型、日志级别等多层级属性分类。

## 1. 路由规则

routing key 用 `.` 分隔为多个词，binding key 支持两种通配符：

| 通配符 | 含义 | 示例 |
| :-- | :-- | :-- |
| `*` | 匹配一个词 | `order.*` 匹配 `order.created`，不匹配 `order.item.created` |
| `#` | 匹配零个或多个词 | `order.#` 匹配 `order.created`、`order.item.created`、`order` |

## 2. 匹配示例

```txt
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

```txt
Producer routing key: "order.created" / "order.paid" / "payment.success" / "payment.failed"

Binding:
  order.*     → order.events.queue     (两段式订单事件)
  payment.*   → payment.events.queue   (两段式支付事件)
  #.failed    → alert.queue            (所有以 failed 结尾的事件，触发告警)
  #           → audit.queue            (所有事件，审计日志)
```

```java
channel.exchangeDeclare("event.exchange", BuiltinExchangeType.TOPIC, true);

channel.queueDeclare("order.events.queue", true, false, false, null);
channel.queueBind("order.events.queue", "event.exchange", "order.*");

channel.queueDeclare("payment.events.queue", true, false, false, null);
channel.queueBind("payment.events.queue", "event.exchange", "payment.*");

channel.queueDeclare("alert.queue", true, false, false, null);
channel.queueBind("alert.queue", "event.exchange", "#.failed");

channel.queueDeclare("audit.queue", true, false, false, null);
channel.queueBind("audit.queue", "event.exchange", "#");
```

### 3.2 日志分级

```txt
routing key: "log.error.payment"

Binding:
  log.error.#    → error.queue
  log.*.payment  → payment.log.queue
  #              → all.log.queue
```

`log.error.payment` 同时匹配 `log.error.#`（`#` 匹配 payment）、`log.*.payment`（`*` 匹配 error）和 `#`，因此这条消息会被路由到三个队列。一条消息同时匹配多个绑定并路由到多个队列，是 Direct 和 Topic 都支持的能力；Topic 区别于 Direct 的是用 `*` 和 `#` 做模式匹配，而非仅精确匹配。

## 4. Topic vs Direct vs Fanout

| 需求 | 选择 |
| :-- | :-- |
| 精确路由（`order.created` → 指定 Queue） | Direct |
| 分类路由（`order.*` → 订单相关 Queue） | Topic |
| 广播（所有与该 Fanout Exchange 绑定的队列都收到） | Fanout |
| 按路由键后缀分类（`#.error` → 告警 Queue） | Topic |

## 5. 性能注意事项

Topic Exchange 的路由需要模式匹配，Direct 使用精确匹配，这是机制差异而非性能结论。实际性能差异取决于绑定数量与分布、匹配模式及消息吞吐，应通过基准测试验证，不能据此认定 Direct 必然更快，也不能给出固定的切换阈值。

## 6. 常见陷阱

**陷阱 1：误判通配符的覆盖范围**

`order.*` 只匹配两段式路由键，如 `order.created`；如果业务还会产生 `order.item.created` 这类多层级路由键，这条绑定就无法匹配。需要覆盖多层级时，应根据实际命名规则改用 `order.#`。选择 `*` 还是 `#`，取决于路由键的结构，而不是哪个通配符更通用。

**陷阱 2：routing key 为空**

空 routing key 拆分成零个词，只有 `#`（匹配零个或多个词）能匹配它；`*` 需要恰好一个词，带固定前缀的模式（如 `a.#`）要求 routing key 至少以 `a` 开头，都不匹配空 routing key。

```txt
routing key = ""

binding key = "#"    → 匹配
binding key = "*"    → 不匹配
binding key = "a.#"  → 不匹配
```

**陷阱 3：词的数量不一致**

```txt
binding key = "order.*"   → 匹配 "order.created"（2个词）
                           → 不匹配 "order"（1个词，* 需要一个词）
                           → 不匹配 "order.item.created"（3个词）
```
