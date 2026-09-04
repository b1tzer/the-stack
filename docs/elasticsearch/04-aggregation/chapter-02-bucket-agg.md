# 桶聚合

桶聚合（Bucket Aggregation）将文档按照某个条件分配到不同的"桶"中，每个桶对应一组文档。

## 1. terms 聚合

按字段值分组，类似 SQL 的 GROUP BY：

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "by_category": {
      "terms": {
        "field": "category.keyword",
        "size": 10,
        "order": { "_count": "desc" }
      }
    }
  }
}
```

> ⚠️ **注意**：`terms` 聚合只能用于 `keyword` 类型字段，不能用于 `text` 类型。

## 2. date_histogram 聚合

按时间间隔分组：

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "by_month": {
      "date_histogram": {
        "field": "created_at",
        "calendar_interval": "month",
        "format": "yyyy-MM-dd",
        "min_doc_count": 0,
        "extended_bounds": {
          "min": "2024-01-01",
          "max": "2024-12-31"
        }
      }
    }
  }
}
```

| interval | 说明 |
| :-- | :-- |
| `minute` / `1m` | 每分钟 |
| `hour` / `1h` | 每小时 |
| `day` / `1d` | 每天 |
| `week` / `1w` | 每周 |
| `month` / `1M` | 每月 |
| `quarter` / `1q` | 每季度 |
| `year` / `1y` | 每年 |

## 3. range 聚合

按自定义范围分组：

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "price_ranges": {
      "range": {
        "field": "price",
        "ranges": [
          { "to": 50, "key": "低价" },
          { "from": 50, "to": 200, "key": "中价" },
          { "from": 200, "key": "高价" }
        ]
      }
    }
  }
}
```

## 4. histogram 聚合

按固定间隔分组：

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "price_distribution": {
      "histogram": {
        "field": "price",
        "interval": 50,
        "min_doc_count": 1,
        "order": { "_key": "asc" }
      }
    }
  }
}
```

## 5. filter / filters 聚合

按条件过滤后统计：

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "published_count": {
      "filter": { "term": { "status": "published" } },
      "aggs": {
        "avg_price": { "avg": { "field": "price" } }
      }
    }
  }
}

// 多条件过滤
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "by_status": {
      "filters": {
        "filters": {
          "published": { "term": { "status": "published" } },
          "draft": { "term": { "status": "draft" } },
          "archived": { "term": { "status": "archived" } }
        }
      },
      "aggs": {
        "avg_price": { "avg": { "field": "price" } }
      }
    }
  }
}
```

## 6. 嵌套聚合

桶聚合可以嵌套指标聚合或其他桶聚合：

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "by_category": {
      "terms": { "field": "category.keyword", "size": 10 },
      "aggs": {
        "avg_price": { "avg": { "field": "price" } },
        "by_status": {
          "terms": { "field": "status.keyword" },
          "aggs": {
            "max_price": { "max": { "field": "price" } }
          }
        }
      }
    }
  }
}
```

## 7. composite 聚合（多维度分页）

支持多字段组合分页，适合大数据量的维度分析：

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "my_buckets": {
      "composite": {
        "size": 100,
        "sources": [
          { "category": { "terms": { "field": "category.keyword" } } },
          { "status": { "terms": { "field": "status.keyword" } } }
        ]
      }
    }
  }
}
```

## 8. 最佳实践

- `terms` 聚合的 `size` 参数控制返回的桶数量，默认 10
- 大基数字段（如 user_id）的 `terms` 聚合消耗大量内存
- 时间聚合使用 `date_histogram`，用 `extended_bounds` 填充空桶
- 使用 `composite` 聚合替代高基数的 `terms` 聚合
- 嵌套聚合层级不要超过 3 层，影响性能
