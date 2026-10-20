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

> ⚠️ **注意**：`terms` 聚合可用于 `keyword`、数值、日期、布尔、IP 等可聚合字段。`text` 字段默认无法直接聚合，需要按文本内容分组时，应使用其 `keyword` 子字段，而不是为 `text` 字段启用 `fielddata`，后者会显著增加堆内存开销。

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

`date_histogram` 的时间间隔分两种：`calendar_interval` 按日历边界分桶（月份长度不同、遵循夏令时），`fixed_interval` 按固定时长分桶。下表是 `calendar_interval` 的合法取值，只能写单数形式（如 `1m`、`1M`），写倍数（如 `2d`）会报错：

| calendar_interval | 说明 |
| :-- | :-- |
| `minute` / `1m` | 每分钟 |
| `hour` / `1h` | 每小时 |
| `day` / `1d` | 每天 |
| `week` / `1w` | 每周 |
| `month` / `1M` | 每月 |
| `quarter` / `1q` | 每季度 |
| `year` / `1y` | 每年 |

`fixed_interval` 支持任意倍数的固定时长，如 `30s`、`90m`、`2h`、`30d`，但不支持 `month`、`week` 等长度不固定的单位。按自然月、自然年统计用 `calendar_interval`，需要精确固定时长窗口用 `fixed_interval`；按业务时区统计时还应显式设置 `time_zone`。

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

`filter` 聚合先按条件过滤，再对命中的文档做子聚合：

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
```

`filters` 聚合一次定义多个过滤条件，分别统计：

```json
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

composite 只返回第一页桶，并在响应中携带 `after_key`。要遍历剩余桶，把上一页返回的 `after_key` 原样填入下一次请求的 `after` 参数即可；当返回桶数不足 `size`，或响应不再包含 `after_key` 时，说明已到最后一页：

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "my_buckets": {
      "composite": {
        "size": 100,
        "after": { "category": "上一页 after_key 中的 category", "status": "上一页 after_key 中的 status" },
        "sources": [
          { "category": { "terms": { "field": "category.keyword" } } },
          { "status": { "terms": { "field": "status.keyword" } } }
        ]
      }
    }
  }
}
```

`after` 必须使用服务端返回的 `after_key` 原值，不要自行拼接或推算。

## 8. 最佳实践

- `terms` 聚合的 `size` 参数控制返回的桶数量，默认 10
- 高基数字段的 `terms` 聚合会增大聚合状态与计算成本，实际开销还取决于 `size`、分片数量与查询范围
- 时间聚合同时设置 `min_doc_count: 0` 与 `extended_bounds` 才能填充区间内的空桶
- 按多维度遍历全部桶时用 `composite` 分页，只取文档数 Top N 时用 `terms`，两者用途不同
- 嵌套聚合的开销取决于各层产生的桶数量与组合规模，避免不必要过深的嵌套
