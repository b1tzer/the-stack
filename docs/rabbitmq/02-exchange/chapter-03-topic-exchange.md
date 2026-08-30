# Topic Exchange

> Topic Exchange 支持通配符匹配，是 RabbitMQ 最灵活的路由模式。它使用 `*` 和 `#` 两个通配符，实现基于 routing key 的模式匹配。

## 1. 通配符规则

| 通配符 | 说明 | 示例 |
| :-- | :-- | :-- |
| `*` | 匹配一个单词 | `order.*` 匹配 `order.created`，不匹配 `order.item.created` |
| `#` | 匹配零个或多个单词 | `order.#` 匹配 `order.created`、`order.item.created` |

routing key 格式：用 `.` 分隔的单词，如 `order.created`、`user.login.success`

## 2. 匹配示例

```text
Routing Key          Binding Pattern    匹配结果
order.created        order.*            ✅
order.created        order.#            ✅
order.item.created   order.*            ❌
order.item.created   order.#            ✅
order.created        #.created          ✅
user.order.created   #.created          ✅
order.created        *.*                ✅
order.created        #                  ✅（匹配所有）
```

## 3. 典型场景

### 3.1 事件总线

```text
event.exchange (topic)
  ├── *.created    ──▶ audit-queue（审计日志）
  ├── order.*      ──▶ order-analytics-queue（订单分析）
  ├── order.paid   ──▶ payment-queue（支付处理）
  └── #            ──▶ log-queue（全量日志）
```

### 3.2 多级分类

```text
app.exchange (topic)
  ├── user.login.*    ──▶ security-queue
  ├── user.#          ──▶ user-service-queue
  ├── order.#         ──▶ order-service-queue
  └── *.error         ──▶ alert-queue
```

## 4. 性能注意事项

- Topic 匹配需要遍历所有绑定规则，比 Direct 慢
- 绑定规则数量影响匹配性能
- 规则超过数千条时考虑拆分 Exchange
- 高性能场景优先用 Direct

## 5. 与 Direct 的组合

实际项目中常组合使用：

```text
事件发布 → Topic Exchange（灵活路由）
精确命令 → Direct Exchange（高性能路由）
```
