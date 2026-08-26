# 数据建模原则

## 1. 建模原则

- 根据查询需求建模，而非数据结构
- 优先考虑搜索性能
- 合理使用反规范化

## 2. 字段类型选择

| 场景 | 类型 |
|------|------|
| 全文搜索 | text |
| 精确匹配 | keyword |
| 范围查询 | integer/date |
| 地理位置 | geo_point |

## 3. 映射优化

```json
PUT /my-index
{
  "mappings": {
    "properties": {
      "title": {
        "type": "text",
        "analyzer": "ik_max_word",
        "search_analyzer": "ik_smart"
      },
      "status": {
        "type": "keyword"
      },
      "price": {
        "type": "scaled_float",
        "scaling_factor": 100
      }
    }
  }
}
```

## 4. 避免映射爆炸

- 限制字段数量
- 使用 `dynamic: strict`
- 避免动态生成字段名

## 5. 文档 ID 设计

```json
# 使用业务 ID 作为文档 _id（推荐，支持幂等写入）
PUT /orders/_doc/ORDER_20240101_001
{
  "order_id": "ORDER_20240101_001",
  "amount": 99.9
}

# 使用 UUID 自动生成（适合日志类数据，避免冲突）
POST /logs/_doc
{
  "message": "user login",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

## 6. 多字段策略（Multi-field）

```json
PUT /articles
{
  "mappings": {
    "properties": {
      "title": {
        "type": "text",
        "analyzer": "ik_max_word",
        "search_analyzer": "ik_smart",
        "fields": {
          "keyword": { "type": "keyword", "ignore_above": 256 },
          "pinyin": { "type": "text", "analyzer": "pinyin_analyzer" }
        }
      }
    }
  }
}
```

这样 `title` 支持全文搜索，`title.keyword` 支持精确匹配和排序，`title.pinyin` 支持拼音搜索。

## 7. 建模决策清单

| 问题 | 决策 |
|------|------|
| 字段需要全文搜索？ | 是 → `text`，否 → `keyword` |
| 字段需要精确匹配/聚合？ | 是 → `keyword` 或 multi-field |
| 字段需要范围查询？ | 是 → `integer/long/date` |
| 对象数组需要独立查询？ | 是 → `nested` 类型 |
| 关联数据更新频繁？ | 是 → `parent-child` 或应用层关联 |
| 数据量大，查询模式固定？ | 考虑反规范化（宽表） |

## 8. 最佳实践

- 根据查询需求建模，而非数据结构
- 避免映射爆炸：使用 `dynamic: strict` 或 `dynamic: false`
- `ignore_above` 限制 keyword 字段最大长度（默认 256）
- 不需要搜索的字段设置 `index: false` 减少索引开销
- 不需要返回的字段设置 `enabled: false` 跳过索引和存储

