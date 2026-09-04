# 反规范化（宽表）

## 1. 什么是反规范化

反规范化是将关联数据冗余存储到同一个文档中，避免运行时 JOIN 操作。在 ES 中，这是最常见的关系建模方式。

```json
// 规范化设计（类似 MySQL）
// orders 表：order_id, user_id, product_id
// users 表：user_id, user_name
// products 表：product_id, product_name, price

// 反规范化设计（ES 宽表）
{
  "order_id": "ORD001",
  "user_id": "U001",
  "user_name": "张三",
  "product_id": "P001",
  "product_name": "iPhone 15",
  "product_price": 7999,
  "product_category": "手机",
  "order_time": "2024-01-15T10:00:00Z"
}
```

## 2. 反规范化的代价

| 代价 | 说明 |
| :-- | :-- |
| **数据冗余** | 同一数据存储多份，占用更多磁盘 |
| **更新成本** | 用户改名需要更新所有相关订单 |
| **一致性风险** | 部分更新成功部分失败导致数据不一致 |

## 3. 更新策略

### 3.1 批量更新

```json
// 用户改名后，批量更新所有相关订单
POST /orders/_update_by_query
{
  "query": {
    "term": { "user_id": "U001" }
  },
  "script": {
    "source": "ctx._source.user_name = params.new_name",
    "params": { "new_name": "张三丰" }
  }
}
```

### 3.2 异步更新

通过消息队列异步更新冗余数据：

```
用户改名 → 更新 users 表 → 发送 MQ 消息 → 消费者批量更新 orders 索引
```

## 4. 反规范化设计模式

### 4.1 数据冗余

```json
{
  "product_id": "P001",
  "product_name": "iPhone 15",
  "brand_name": "Apple",
  "category_name": "手机",
  "category_path": "电子产品/手机/智能手机"
}
```

### 4.2 聚合字段

```json
{
  "user_id": "U001",
  "user_name": "张三",
  "order_count": 15,
  "total_spent": 25000,
  "last_order_time": "2024-01-15T10:00:00Z"
}
```

### 4.3 标签字段

```json
{
  "product_id": "P001",
  "product_name": "iPhone 15",
  "tags": ["苹果", "5G", "高端", "拍照"],
  "price_range": "high",
  "brand": "Apple"
}
```

## 5. 宽表设计原则

| 原则 | 说明 |
| :-- | :-- |
| **查询驱动** | 根据查询需求决定冗余哪些字段 |
| **读写权衡** | 读多写少的场景更适合反规范化 |
| **更新频率** | 频繁变更的字段不适合冗余 |
| **数据量级** | 冗余字段的值变化频率低于主文档 |

## 6. 与 MySQL 的配合

```txt
MySQL（主数据源）           ES（搜索引擎/分析引擎）
┌──────────────┐          ┌──────────────────┐
│ users        │          │ orders_flat      │
│ orders       │ ──同步──→│ (反规范化宽表)    │
│ products     │          │                  │
│ categories   │          │                  │
└──────────────┘          └──────────────────┘
   写入/更新                   查询/聚合
```

## 7. 最佳实践

- 根据查询模式决定冗余字段，不要盲目冗余所有数据
- 高频变更字段（如库存）不建议冗余
- 使用 Canal + MQ 异步同步，保证最终一致性
- 定期对账，确保 MySQL 和 ES 数据一致
- 宽表字段数量控制在合理范围（< 200 个字段）
- 使用 `dynamic: strict` 防止字段数量失控
