# 数据建模原则

## 1. 建模原则

- 根据查询需求建模，而非数据结构
- 优先考虑搜索性能
- 合理使用反规范化

这三条原则之间存在张力。反规范化把关联数据冗余进单个文档，能省掉查询时的关联开销，却会引入写放大、存储冗余和同步成本。建模是在查询延迟、写入吞吐、更新频率与索引体积之间做取舍，而不是套用某条原则。

## 2. 字段类型选择

| 场景 | 类型 |
| :-- | :-- |
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
- 避免用动态内容作为字段名
- 按字段契约的严格程度选择 `dynamic`

`dynamic` 的取值决定遇到未映射字段时的行为。`dynamic: strict` 直接拒绝写入包含未知字段的文档，适合字段契约固定的场景；`dynamic: false` 允许文档写入，但跳过未知字段的索引，值仍保留在 `_source` 中，适合想容忍新字段又不想扩大映射的场景。两者不能互换。对于键集合无法预先枚举、又确实需要存储的数据，可评估 `flattened` 类型，而不是无限制生成独立字段。

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
| :-- | :-- |
| 字段需要全文搜索？ | 是 → `text`，否 → `keyword` |
| 字段需要精确匹配/聚合？ | 是 → `keyword` 或 multi-field |
| 字段需要范围查询？ | 是 → `integer/long/date` |
| 对象数组需要独立查询？ | 是 → `nested` 类型，见 [Nested vs Join](chapter-02-nested-vs-join.md) |
| 关联数据更新频繁？ | 是 → `parent-child` 或应用层关联，见 [Nested vs Join](chapter-02-nested-vs-join.md) |
| 数据量大，查询模式固定？ | 更新不频繁且可容忍冗余 → 反规范化（宽表） |

## 8. 最佳实践

- 根据查询需求建模，而非数据结构
- 避免映射爆炸，按需选择 `dynamic: strict` 或 `dynamic: false`，两者行为不同
- `ignore_above` 控制字符串值超过指定长度时跳过索引，值仍保留在 `_source`；显式映射的 keyword 默认不设置 `ignore_above`，仅动态映射生成的 `.keyword` 子字段默认 256
- 不需要搜索的字段设置 `index: false` 减少索引开销
- 对象字段只需保留原始 JSON、无需解析与索引时设置 `enabled: false`；该设置不会从 `_source` 移除字段，控制返回内容应用 `_source` 过滤或 `fields`
