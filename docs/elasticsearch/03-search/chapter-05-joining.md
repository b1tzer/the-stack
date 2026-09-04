# 嵌套查询与关联关系

## 1. 问题背景

ES 中 JSON 对象数组会被扁平化存储，导致对象边界丢失：

```json
// 原始文档
{
  "orders": [
    { "product": "手机", "price": 5000 },
    { "product": "耳机", "price": 200 }
  ]
}

// 扁平化后（丢失对象边界）
// product: ["手机", "耳机"]
// price: [5000, 200]

// 查询 "手机 price < 300" 会错误匹配！因为 "手机" 和 200 被关联了
```

## 2. Nested 类型

`nested` 类型将数组中的每个对象作为独立的隐藏文档存储，保留对象边界。

### 2.1 定义 Nested 映射

```json
PUT /orders
{
  "mappings": {
    "properties": {
      "order_id": { "type": "keyword" },
      "items": {
        "type": "nested",
        "properties": {
          "product": { "type": "text", "analyzer": "ik_max_word" },
          "price": { "type": "integer" },
          "quantity": { "type": "integer" }
        }
      }
    }
  }
}
```

### 2.2 Nested 查询

```json
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
      },
      "score_mode": "avg"
    }
  }
}
```

### 2.3 Nested 聚合

```json
GET /orders/_search
{
  "size": 0,
  "aggs": {
    "items_agg": {
      "nested": { "path": "items" },
      "aggs": {
        "avg_price": { "avg": { "field": "items.price" } },
        "by_product": {
          "terms": { "field": "items.product.keyword" }
        }
      }
    }
  }
}
```

## 3. Parent-Child（Join 类型）

Parent-Child 关系将关联文档存储在同一个索引中但不同的文档里，通过 Join Field 建立关联。

### 3.1 定义 Join 映射

```json
PUT /company
{
  "mappings": {
    "properties": {
      "relation_type": {
        "type": "join",
        "relations": {
          "department": "employee"
        }
      },
      "name": { "type": "text" },
      "dept_name": { "type": "keyword" }
    }
  }
}
```

### 3.2 索引 Parent 和 Child 文档

```json
// 索引部门（Parent）
PUT /company/_doc/dept_1?routing=dept_1
{
  "name": "技术部",
  "relation_type": "department"
}

// 索引员工（Child，必须指定 routing）
PUT /company/_doc/emp_1?routing=dept_1
{
  "name": "张三",
  "relation_type": {
    "name": "employee",
    "parent": "dept_1"
  }
}
```

### 3.3 Has Child 查询

```json
// 查找有 "张三" 员工的部门
GET /company/_search
{
  "query": {
    "has_child": {
      "type": "employee",
      "query": {
        "match": { "name": "张三" }
      }
    }
  }
}
```

### 3.4 Has Parent 查询

```json
// 查找 "技术部" 的所有员工
GET /company/_search
{
  "query": {
    "has_parent": {
      "parent_type": "department",
      "query": {
        "match": { "name": "技术部" }
      }
    }
  }
}
```

## 4. Nested vs Parent-Child 对比

| 维度 | Nested | Parent-Child |
| :-- | :-- | :-- |
| 存储方式 | 同一文档，隐藏子文档 | 不同文档，通过 Join Field 关联 |
| 查询性能 | 快（同一文档内查找） | 慢（需要跨文档关联） |
| 更新子文档 | 需要更新整个父文档 | 可以独立更新子文档 |
| 适用场景 | 子文档少、读多写少 | 子文档多、频繁更新 |
| 聚合支持 | 好 | 有限 |
| 数据量建议 | 每个父文档 < 100 个嵌套对象 | 子文档数量无硬限制 |

## 5. 应用层关联

对于复杂的关联关系，推荐在应用层处理：

```json
// 先查询部门
GET /departments/_search
{
  "query": { "term": { "name.keyword": "技术部" } }
}

// 再根据部门 ID 查询员工
GET /employees/_search
{
  "query": { "term": { "dept_id": "dept_1" } }
}
```

## 6. 最佳实践

- 子文档数量少（< 100）且读多写少 → 使用 `nested`
- 子文档需要独立更新 → 使用 `parent-child`
- 关联关系复杂 → 使用应用层关联或反规范化
- Nested 查询的 `score_mode` 控制子文档得分如何合并（`avg`/`max`/`sum`）
- Parent-Child 查询必须指定 `routing`，确保父子文档在同一分片
