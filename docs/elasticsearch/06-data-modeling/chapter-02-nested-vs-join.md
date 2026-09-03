# Nested vs Join 关系建模

## 1. 关系型数据在 ES 中的挑战

ES 是面向文档的搜索引擎，不支持像 MySQL 那样的 JOIN 操作。在 ES 中建模关联关系，需要根据查询模式选择合适的方案。

## 2. 方案一：对象数组（Object Array）

最简单的方式，但会丢失对象边界：

```json
PUT /orders
{
  "mappings": {
    "properties": {
      "order_id": { "type": "keyword" },
      "items": {
        "properties": {
          "product": { "type": "text" },
          "price": { "type": "integer" }
        }
      }
    }
  }
}

// 存储
PUT /orders/_doc/1
{
  "order_id": "ORD001",
  "items": [
    { "product": "手机", "price": 5000 },
    { "product": "耳机", "price": 200 }
  ]
}
```

**问题**：对象数组被扁平化存储，查询"手机 price < 300"会错误匹配（手机关联了 200）。

## 3. 方案二：Nested 类型

保留对象边界，每个嵌套对象作为独立隐藏文档：

```json
PUT /orders
{
  "mappings": {
    "properties": {
      "order_id": { "type": "keyword" },
      "items": {
        "type": "nested",
        "properties": {
          "product": { "type": "text" },
          "price": { "type": "integer" }
        }
      }
    }
  }
}

// 查询：手机且价格 < 300
GET /orders/_search
{
  "query": {
    "nested": {
      "path": "items",
      "query": {
        "bool": {
          "must": [
            { "match": { "items.product": "手机" } },
            { "range": { "items.price": { "lte": 300 } } }
          ]
        }
      }
    }
  }
}
```

**优点**：保留对象边界，查询精确。
**缺点**：更新嵌套对象需要更新整个父文档；嵌套对象数量影响性能。

## 4. 方案三：Parent-Child（Join）

父子文档独立存储，通过 Join Field 关联：

```json
PUT /company
{
  "mappings": {
    "properties": {
      "doc_type": {
        "type": "join",
        "relations": { "department": "employee" }
      },
      "name": { "type": "text" }
    }
  }
}
```

**优点**：子文档可独立更新。
**缺点**：查询性能差，父子文档必须在同一分片。

## 5. 方案四：反规范化（宽表）

将关联数据冗余存储到一个文档中：

```json
PUT /orders_flat
{
  "mappings": {
    "properties": {
      "order_id": { "type": "keyword" },
      "product_name": { "type": "text" },
      "product_price": { "type": "integer" },
      "product_category": { "type": "keyword" }
    }
  }
}
```

**优点**：查询性能最好。
**缺点**：数据冗余，更新成本高。

## 6. 选型决策

| 维度 | Object | Nested | Parent-Child | 反规范化 |
| :-- | :-- | :-- | :-- | :-- |
| 对象边界 | ❌ 丢失 | ✅ 保留 | ✅ 保留 | ✅ 保留 |
| 查询性能 | ✅ 好 | ✅ 好 | ❌ 差 | ✅ 最好 |
| 更新性能 | ✅ 好 | ❌ 差 | ✅ 子文档独立更新 | ❌ 差 |
| 数据冗余 | 低 | 低 | 低 | 高 |
| 适用场景 | 不需要精确匹配 | 读多写少 | 子文档频繁更新 | 查询优先 |

## 7. 最佳实践

- 对象间关系简单且读多写少 → Nested
- 子文档需要独立更新 → Parent-Child
- 查询性能优先 → 反规范化（宽表）
- 关联关系复杂 → 应用层关联
- 每个父文档的嵌套对象建议 < 100 个
- Parent-Child 查询必须指定 routing
