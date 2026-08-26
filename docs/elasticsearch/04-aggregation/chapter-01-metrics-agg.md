# 指标聚合

## 1. 基本指标

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "avg_price": { "avg": { "field": "price" } },
    "max_price": { "max": { "field": "price" } },
    "min_price": { "min": { "field": "price" } },
    "sum_price": { "sum": { "field": "price" } },
    "count": { "value_count": { "field": "price" } }
  }
}
```

## 2. stats 聚合

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "price_stats": { "stats": { "field": "price" } }
  }
}
```

## 3. percentiles 聚合

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "price_percentiles": {
      "percentiles": { "field": "price" }
    }
  }
}
```

## 4. cardinality 聚合（去重）

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "unique_users": {
      "cardinality": { "field": "user_id" }
    }
  }
}
```

## 5. weighted_avg 聚合（加权平均）

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "weighted_grade": {
      "weighted_avg": {
        "value": { "field": "grade" },
        "weight": { "field": "credit" }
      }
    }
  }
}
```

## 6. top_hits 聚合

获取每个桶中的 Top N 文档：

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "by_category": {
      "terms": { "field": "category" },
      "aggs": {
        "top_products": {
          "top_hits": {
            "size": 3,
            "sort": [{ "price": "desc" }],
            "_source": ["name", "price"]
          }
        }
      }
    }
  }
}
```

## 7. 聚合与查询结合

聚合默认在查询结果集上执行，可以使用 `post_filter` 让聚合不受过滤影响：

```json
GET /my-index/_search
{
  "size": 0,
  "query": { "match": { "category": "electronics" } },
  "aggs": {
    "all_categories": {
      "terms": { "field": "category" }
    }
  },
  "post_filter": {
    "term": { "status": "published" }
  }
}
```

## 8. 最佳实践

- 聚合时设置 `"size": 0` 避免返回搜索结果
- `cardinality` 聚合的 `precision_threshold` 控制精度与内存的权衡
- 大数据量聚合考虑使用 `sampler` 聚合降低计算量
- 聚合结果默认返回 Top 10 桶，可通过 `size` 参数调整
- 使用 `missing` 参数处理字段值缺失的情况

