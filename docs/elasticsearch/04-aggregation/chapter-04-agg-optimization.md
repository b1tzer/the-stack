# 聚合优化

## 1. 聚合性能问题

聚合操作需要遍历大量数据，常见性能问题包括：
- 高基数字段的 `terms` 聚合消耗大量内存
- 嵌套聚合层级过深
- 聚合结果未分页，一次性返回大量数据

## 2. 优化策略

### 2.1 使用 sampler 聚合降低计算量

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "sample": {
      "sampler": { "shard_size": 1000 },
      "aggs": {
        "by_category": {
          "terms": { "field": "category.keyword" }
        }
      }
    }
  }
}
```

`sampler` 通过限制参与子聚合计算的文档数量来降低开销，但会改变统计范围，抽样结果不能当作全量数据的精确统计。它并非随机抽样，而是在每个分片上按查询评分选取样本文档，因此样本可能偏向评分较高的文档，结果受查询条件和评分机制影响。它只适用于可接受抽样误差的分析场景；对于精确计数、财务汇总、完整分布统计等任务，应优先通过 `query` 缩小范围、优化字段类型与聚合基数来优化，而不是依赖抽样。

### 2.2 使用 composite 聚合替代大基数 terms

```json
// ❌ 高基数字段的 terms 聚合（可能 OOM）
{ "aggs": { "by_user": { "terms": { "field": "user_id", "size": 100000 } } } }

// ✅ 使用 composite 聚合分页获取
{
  "aggs": {
    "by_user": {
      "composite": {
        "size": 1000,
        "sources": [
          { "user_id": { "terms": { "field": "user_id" } } }
        ]
      }
    }
  }
}
```

`composite` 只返回单页桶，需要根据响应中的 `after_key` 逐页遍历，直到 `after_key` 为 `null`。以下为下一页请求示意，`after` 应直接使用上一页响应返回的 `after_key`：

```json
{
  "aggs": {
    "by_user": {
      "composite": {
        "size": 1000,
        "after": { "user_id": "上一次响应返回的 after_key 值" },
        "sources": [
          { "user_id": { "terms": { "field": "user_id" } } }
        ]
      }
    }
  }
}
```

下一页游标必须使用响应返回的 `after_key`，不要自行推算组合键。分页限制的是单次响应规模，整体遍历仍有计算与网络成本；若要求多页结果对应同一数据视图，需配合 PIT 等一致性方案。

### 2.3 基数估算的精度与内存权衡

`cardinality` 聚合使用 HyperLogLog++ 算法做基数估算，本身属于近似计数，并非精确去重。需要精确去重计数时，必须采用能保证精确结果的实现：完整遍历所有桶并在应用侧精确收集、去重统计，例如借助 `composite` 分页逐页收集后统计。单纯调用 `cardinality`，无论是否经由脚本，结果都仍是近似值，不会因为用了脚本就变成精确计数。

```json
// cardinality 近似基数估算
{ "aggs": { "unique_users": { "cardinality": { "field": "user_id" } } } }

// 通过 precision_threshold 调整精度与内存的权衡
{
  "aggs": {
    "unique_users": {
      "cardinality": {
        "field": "user_id",
        "precision_threshold": 1000
      }
    }
  }
}
```

`precision_threshold` 用于在估算精度与内存消耗之间权衡：阈值增大通常会提高估算精度，同时增加内存成本，其最高有效值为 40000。该参数不是精度百分比，也不保证误差落在某个固定范围，实际资源消耗还受字段值分布、并发聚合等因素影响，不能仅凭阈值承诺固定的内存用量。

### 2.4 使用 filter 缩小聚合范围

```json
GET /my-index/_search
{
  "size": 0,
  "query": {
    "range": { "created_at": { "gte": "2024-01-01" } }
  },
  "aggs": {
    "by_category": {
      "terms": { "field": "category.keyword" }
    }
  }
}
```

### 2.5 关闭不需要的搜索结果

```json
// ✅ 设置 size: 0 避免返回搜索结果
GET /my-index/_search
{
  "size": 0,
  "aggs": { ... }
}
```

## 3. 聚合缓存

ES 使用分片请求缓存（shard request cache）缓存分片级请求结果，其中包含聚合结果，`size: 0` 的请求默认适合进入该缓存。以下条件会影响缓存命中：
- 查询中包含 `now` 等动态值
- 分片级请求结果超过缓存限制，无法缓存
- 分片数据发生变化（如刷新导致缓存条目失效）
- 请求参数与缓存键不一致

`size: 0` 是默认缓存行为的重要条件之一，而非所有聚合请求都必然命中缓存的充分条件。

```json
// 使用固定时间范围提高缓存命中率
{
  "query": {
    "range": {
      "created_at": {
        "gte": "2024-01-01",
        "lt": "2024-02-01"
      }
    }
  }
}
```

## 4. 聚合结果排序

```json
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "by_category": {
      "terms": {
        "field": "category.keyword",
        "order": { "avg_price": "desc" }
      },
      "aggs": {
        "avg_price": { "avg": { "field": "price" } }
      }
    }
  }
}
```

`terms` 聚合先在各分片选取候选桶，再由协调节点归并。按子聚合指标（如 `avg_price`）排序时，各分片的候选桶可能遗漏全局本应入选的桶，因此不能保证平均价格最高的类别一定出现在结果中。官方文档明确指出子聚合排序通常可能产生错误结果，可保证正确的两个特例是按 `max` 降序和按 `min` 升序。需要按平均值选出全局 Top N 时，应评估 `composite` 分页收集桶后在应用侧排序，或采用其他能保证全局排序的方案，而不是简单地增大 `terms.size`。

## 5. 最佳实践

- 仅需聚合结果而不需要搜索命中时，设置 `"size": 0`
- 高基数字段使用 `composite` 聚合分页
- `cardinality` 聚合合理设置 `precision_threshold`
- 使用 `filter` 缩小聚合范围，减少计算量
- 控制嵌套聚合层数与桶基数，避免单层产生过大的桶集合
- 使用 `sampler` 降低可接受抽样误差场景的聚合开销
- 时间范围使用固定值，提高缓存命中率
