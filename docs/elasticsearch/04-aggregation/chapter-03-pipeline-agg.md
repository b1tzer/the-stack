# 管道聚合

管道聚合（Pipeline Aggregation）对其他聚合的输出进行二次计算，而非直接对文档操作。

## 1. 管道聚合分类

| 类型 | 说明 | 示例 |
| :-- | :-- | :-- |
| **Parent** | 在父级多桶聚合的桶上执行，计算派生值或对桶集合排序、截断 | `derivative`, `cumulative_sum`, `bucket_script`, `bucket_sort` |
| **Sibling** | 对同级多桶聚合返回的桶集合做统计 | `avg_bucket`, `max_bucket`, `min_bucket`, `sum_bucket` |

## 2. derivative（导数/差值）

计算相邻桶指标值的变化量（差值），可按需通过 `unit` 将变化量按时间间隔归一化。它本身不等于百分比增长率：

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

对父聚合已返回的桶按指标排序并截取 Top N：

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

`bucket_sort` 在其他聚合完成后执行，只对父聚合实际返回的桶排序和截断，不能找回已被 `terms` 聚合淘汰的桶。示例中 `terms` 默认按文档计数排序、最多返回 `size: 100` 个桶作为候选，若某个类别销售额很高却因文档数未进入这 100 个候选桶，就不会出现在最终结果中。需要按子聚合指标取全局 Top N 时，必须同时考虑父聚合的候选桶选择策略，不能只增大 `bucket_sort` 的 `size`。

## 7. moving_fn（移动窗口函数）

对滑动窗口内的桶指标执行自定义函数，例如计算滑动平均。旧聚合 `moving_avg` 在 6.4 已弃用、8.0 移除，8.x 应使用 `moving_fn`：

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
        "smooth_sales": {
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

当管道聚合的输入路径（`buckets_path`）在部分桶上缺失值时：

| 策略 | 说明 |
| :-- | :-- |
| `skip` | 跳过空桶 |
| `insert_zeros` | 用 0 填充空桶 |

## 9. 最佳实践

- 管道聚合的 `buckets_path` 使用 `>` 连接嵌套聚合路径
- 时间序列分析常用 `derivative`（变化量）和 `cumulative_sum`（累计值）
- 使用 `bucket_script` 实现自定义业务指标
- 使用 `bucket_sort` 对父聚合返回的桶按指标排序并截取 Top N
- 注意 `gap_policy` 的选择，避免空桶导致计算错误
