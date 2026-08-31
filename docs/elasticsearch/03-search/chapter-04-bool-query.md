# 布尔查询

## 1. bool 查询

```json
GET /my-index/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "Elasticsearch" } }
      ],
      "should": [
        { "match": { "content": "入门" } },
        { "match": { "content": "教程" } }
      ],
      "must_not": [
        { "term": { "status": "draft" } }
      ],
      "filter": [
        { "range": { "price": { "gte": 100, "lte": 500 } } }
      ]
    }
  }
}
```

## 2. 子句说明

| 子句 | 说明 | 影响得分 |
|------|------|---------|
| must | 必须匹配 | ✅ |
| should | 应该匹配 | ✅ |
| must_not | 必须不匹配 | ❌ |
| filter | 必须匹配 | ❌ |

## 3. 最佳实践

- 使用 filter 替代 must（可缓存）
- 避免嵌套过深
- 使用 constant_score 包装精确查询
## 4. should 的 minimum_should_match

当 `bool` 查询中只有 `should` 子句时，至少需要匹配一个。当同时存在 `must` 或 `filter` 时，`should` 变为可选（加分项）。

```json
GET /my-index/_search
{
  "query": {
    "bool": {
      "should": [
        { "match": { "title": "Elasticsearch" } },
        { "match": { "title": "搜索引擎" } },
        { "match": { "title": "分布式" } }
      ],
      "minimum_should_match": 2
    }
  }
}
```

`minimum_should_match` 支持百分比：`"75%"` 表示至少匹配 75% 的子句。

## 5. 嵌套 bool 查询

```json
GET /my-index/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "Java" } }
      ],
      "should": [
        {
          "bool": {
            "must": [
              { "match": { "content": "Spring" } },
              { "range": { "price": { "lte": 100 } } }
            ]
          }
        },
        {
          "bool": {
            "must": [
              { "match": { "content": "微服务" } },
              { "term": { "status": "published" } }
            ]
          }
        }
      ]
    }
  }
}
```

## 6. constant_score 查询

对于不需要计算相关性得分的精确匹配，使用 `constant_score` 包装：

```json
GET /my-index/_search
{
  "query": {
    "constant_score": {
      "filter": {
        "term": { "status": "published" }
      },
      "boost": 1.2
    }
  }
}
```

## 7. 最佳实践

- 条件过滤优先使用 `filter`（可缓存，不计分）
- `should` 配合 `minimum_should_match` 控制匹配精度
- 避免嵌套过深（超过 3 层），影响查询性能
- 精确查询使用 `constant_score` 包装，避免不必要的得分计算
- 复杂查询使用 `explain` API 分析得分来源

