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
    "price_value_count": { "value_count": { "field": "price" } }
  }
}
```

`value_count` 统计的是字段值的数量，不是命中的文档数。字段缺失的文档不参与计数，多值字段（如数组）会贡献多个计数。要统计「该字段有值的文档数」，用 `stats` 聚合返回的 `count`。

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

`percentiles` 默认基于 T-Digest 近似算法，大规模数据下返回的是近似值而非精确值。计费、容量规划等对精度敏感的场景，需评估算法配置，默认请求不能满足精确统计要求。

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

`cardinality` 基于 HyperLogLog++ 近似算法，返回的是近似去重数，不是严格精确值。`precision_threshold` 控制精度与内存开销的权衡，不是精确性保证，也不是可以无限调大换精度的开关。

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

`value` 或 `weight` 字段缺失的文档不参与计算。权重为零的文档对分子和分母均不产生贡献，当所有有效权重之和为零时，无法得到有意义的加权平均结果，需要结合业务保证权重和不为零。

## 6. top_hits 聚合

获取每个桶中的 Top N 文档。示例假设 `category` 为 `text` 类型并配置了 `keyword` 多字段，聚合需使用 `category.keyword`：

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "by_category": {
      "terms": { "field": "category.keyword" },
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

`top_hits` 的结果量随桶数量和每个桶的 `size` 成倍增长，桶多时开销明显。只需排序后的代表性字段时，可评估 `top_metrics` 聚合作为替代。

## 7. 聚合与查询结合

聚合在 `query` 之后、`post_filter` 之前执行。`query` 会限制聚合范围，`post_filter` 只过滤返回的命中结果、不影响聚合。下面的示例中，`all_categories` 统计全部商品类别，返回的搜索结果只包含已发布商品（`size` 设为 10 才能观察到命中结果被过滤）：

```json
GET /my-index/_search
{
  "size": 10,
  "aggs": {
    "all_categories": {
      "terms": { "field": "category.keyword" }
    }
  },
  "post_filter": {
    "term": { "status": "published" }
  }
}
```

## 8. 最佳实践

- 聚合时设置 `"size": 0` 避免返回搜索结果
- `cardinality` 是近似去重，`precision_threshold` 控制精度与内存的权衡，不是精确性保证
- 大数据量聚合可用 `sampler` 降低计算量，但采样结果不等于全量统计，只适合可接受采样偏差的分析场景
- `terms` 等分桶聚合默认返回 Top 10 桶，可通过 `size` 参数调整
- 使用 `missing` 参数处理字段值缺失的情况

分桶组合与资源优化分别见 [桶聚合](chapter-02-bucket-agg.md) 与 [聚合优化](chapter-04-agg-optimization.md)。

