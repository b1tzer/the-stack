# Nested vs Join 关系建模

## 1. 关系型数据在 ES 中的挑战

ES 是面向文档的搜索引擎，不支持关系型数据库那样的任意 JOIN，但可通过 join 字段实现受限的父子关系查询。在 ES 中建模关联关系，需要根据查询模式选择合适的方案。

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

// 查询：手机且价格 ≤ 300
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
**缺点**：更新嵌套对象通常需要重建并重新索引根文档及其嵌套文档；嵌套对象数量影响性能。

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

// 写入父文档
PUT /company/_doc/dept_1
{
  "doc_type": { "name": "department" },
  "name": "研发部"
}

// 写入子文档：以父文档 _id 作 routing，并指定 join 关系
PUT /company/_doc/emp_1?routing=dept_1
{
  "doc_type": { "name": "employee", "parent": "dept_1" },
  "name": "张三"
}

// 查询：找出有员工叫「张三」的部门
GET /company/_search
{
  "query": {
    "has_child": {
      "type": "employee",
      "query": { "match": { "name": "张三" } }
    }
  }
}
```

**优点**：子文档可独立更新。
**缺点**：关联查询需要跨文档匹配，性能相对较差；父子文档必须通过 routing 落在同一分片才能正确关联。

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

**优点**：查询性能通常最好。
**缺点**：数据冗余，更新成本高。

## 6. 选型决策

| 维度 | Object | Nested | Parent-Child | 反规范化 |
| :-- | :-- | :-- | :-- | :-- |
| 对象边界 | ❌ 丢失 | ✅ 保留 | ✅ 保留 | ✅ 保留 |
| 查询性能 | ✅ 较好（无需数组元素间精确匹配） | ✅ 较好（子对象规模可控时） | ❌ 相对较差（有额外关联查询开销） | ✅ 通常最好（查询条件可由冗余字段直接满足） |
| 更新性能 | ✅ 较好（仍需重索引根文档） | ❌ 成本较高（需重索引根文档及嵌套文档） | ✅ 子文档可独立更新 | ❌ 可能较高（取决于冗余数据维护范围） |
| 数据冗余 | 低 | 低 | 低 | 高 |
| 适用场景 | 不需要精确匹配 | 同数组内组合条件、子对象规模可控 | 子文档频繁独立更新 | 查询优先 |

## 7. 最佳实践

- 对象间关系简单、需在数组元素内组合查询条件且子对象规模可控 → Nested
- 子文档需要独立更新 → Parent-Child
- 查询性能优先 → 反规范化（宽表）
- 关联关系复杂 → 应用层关联
- 每个父文档的嵌套对象数量应结合子对象数量、文档大小和查询负载评估，无通用固定阈值
- Parent-Child 写入子文档时必须指定 routing，使其与父文档落在同一分片
