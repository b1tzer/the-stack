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

### 2.3 精确去重 vs 近似去重

```json
// 精确去重（消耗大量内存）
{ "aggs": { "unique_users": { "cardinality": { "field": "user_id" } } } }

// 设置精度阈值（权衡精度和内存）
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

| precision_threshold | 内存消耗 | 精度 |
| :-- | :-- | :-- |
| 100 | ~1KB | 低 |
| 1000 | ~8KB | 中 |
| 40000 | ~64KB | 高（默认） |

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

ES 会缓存聚合结果（Segment 级别缓存），以下条件会影响缓存命中：
- 查询中包含 `now` 等动态值
- 聚合结果太大无法缓存
- Segment 发生变化

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

## 5. 最佳实践

- 聚合时始终设置 `"size": 0`
- 高基数字段使用 `composite` 聚合分页
- `cardinality` 聚合合理设置 `precision_threshold`
- 使用 `filter` 缩小聚合范围，减少计算量
- 避免超过 3 层嵌套聚合
- 使用 `sampler` 降低大数据集的聚合开销
- 时间范围使用固定值，提高缓存命中率
