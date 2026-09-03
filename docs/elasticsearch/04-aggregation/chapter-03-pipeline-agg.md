# 管道聚合

管道聚合（Pipeline Aggregation）对其他聚合的输出进行二次计算，而非直接对文档操作。

## 1. 管道聚合分类

| 类型 | 说明 | 示例 |
| :-- | :-- | :-- |
| **Parent** | 同级聚合的输出作为输入 | `derivative`, `cumulative_sum` |
| **Sibling** | 同级聚合的输出作为输入 | `avg_bucket`, `max_bucket` |

## 2. derivative（导数/差值）

计算相邻桶之间的差值，适合计算增长率：

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "by_month": {
      "date_histogram": {
        "field": "created_at",
        "calendar_interval": "month"
      },
      "aggs": {
        "monthly_sales": { "sum": { "field": "amount" } },
        "sales_derivative": {
          "derivative": {
            "buckets_path": "monthly_sales",
            "gap_policy": "skip"
          }
        }
      }
    }
  }
}
```

## 3. cumulative_sum（累计求和）

计算累计总和：

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "by_month": {
      "date_histogram": {
        "field": "created_at",
        "calendar_interval": "month"
      },
      "aggs": {
        "monthly_sales": { "sum": { "field": "amount" } },
        "cumulative_sales": {
          "cumulative_sum": {
            "buckets_path": "monthly_sales"
          }
        }
      }
    }
  }
}
```

## 4. avg_bucket / max_bucket / min_bucket / sum_bucket

对同级桶聚合的结果计算统计值：

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "by_category": {
      "terms": { "field": "category.keyword" },
      "aggs": {
        "avg_price": { "avg": { "field": "price" } }
      }
    },
    "avg_price_across_categories": {
      "avg_bucket": {
        "buckets_path": "by_category>avg_price"
      }
    },
    "max_price_category": {
      "max_bucket": {
        "buckets_path": "by_category>avg_price"
      }
    }
  }
}
```

## 5. bucket_script（自定义脚本）

对桶聚合结果执行自定义计算：

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "by_month": {
      "date_histogram": {
        "field": "created_at",
        "calendar_interval": "month"
      },
      "aggs": {
        "sales": { "sum": { "field": "amount" } },
        "cost": { "sum": { "field": "cost" } },
        "profit": {
          "bucket_script": {
            "buckets_path": {
              "sales": "sales",
              "cost": "cost"
            },
            "script": "params.sales - params.cost"
          }
        }
      }
    }
  }
}
```

## 6. bucket_sort（桶排序/截断）

对桶聚合结果排序并截取 Top N：

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "by_category": {
      "terms": { "field": "category.keyword", "size": 100 },
      "aggs": {
        "total_sales": { "sum": { "field": "amount" } },
        "top_categories": {
          "bucket_sort": {
            "sort": [{ "total_sales": { "order": "desc" } }],
            "size": 5
          }
        }
      }
    }
  }
}
```

## 7. moving_avg（移动平均）

计算滑动窗口内的平均值（ES 8.x 中已标记为过时，建议使用 `moving_fn`）：

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "by_day": {
      "date_histogram": {
        "field": "created_at",
        "calendar_interval": "day"
      },
      "aggs": {
        "daily_sales": { "sum": { "field": "amount" } },
        "moving_avg": {
          "moving_fn": {
            "buckets_path": "daily_sales",
            "window": 7,
            "script": "MovingFunctions.unweightedAvg(values)"
          }
        }
      }
    }
  }
}
```

## 8. gap_policy（空桶策略）

当桶聚合结果中存在空桶时：

| 策略 | 说明 |
| :-- | :-- |
| `skip` | 跳过空桶 |
| `insert_zeros` | 用 0 填充空桶 |

## 9. 最佳实践

- 管道聚合的 `buckets_path` 使用 `>` 连接嵌套聚合路径
- 时间序列分析常用 `derivative`（增长率）和 `cumulative_sum`（累计值）
- 使用 `bucket_script` 实现自定义业务指标
- 使用 `bucket_sort` 获取 Top N 结果
- 注意 `gap_policy` 的选择，避免空桶导致计算错误
