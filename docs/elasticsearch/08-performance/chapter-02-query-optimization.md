# 查询优化

## 1. 使用 filter 替代 query

```json
# 慢
{ "query": { "range": { "price": { "gte": 100 } } } }

# 快（可缓存）
{ "query": { "bool": { "filter": { "range": { "price": { "gte": 100 } } } } } }
```

## 2. 避免深度分页

```json
# 慢
{ "from": 10000, "size": 10 }

# 快
{ "size": 10, "search_after": [123456] }
```

## 3. 使用 _source 过滤

```json
GET /my-index/_search
{
  "_source": ["name", "age"],
  "query": { "match_all": {} }
}
```

## 4. 避免脚本查询

```json
# 慢
{ "query": { "script": { "script": "doc['price'].value > 100" } } }

# 快
{ "query": { "range": { "price": { "gt": 100 } } } }
```

## 5. 使用 routing 优化查询

```json
# 索引时指定 routing
PUT /my-index/_doc/1?routing=user_123
{
  "user_id": "user_123",
  "order_id": "order_001"
}

# 查询时指定 routing（只查询特定分片）
GET /my-index/_search?routing=user_123
{
  "query": {
    "term": { "user_id": "user_123" }
  }
}
```

## 6. 预热查询缓存

```json
# 使用 profile API 分析查询性能
GET /my-index/_search
{
  "profile": true,
  "query": {
    "match": { "title": "Elasticsearch" }
  }
}
```

## 7. 查询性能优化清单

| 优化手段 | 原理 | 效果 |
|---------|------|------|
| `filter` 替代 `query` | 结果可缓存，不计分 | 2~10x 提升 |
| `search_after` 替代深度分页 | 避免大量数据合并 | 深度分页 10x+ 提升 |
| `_source` 过滤 | 减少网络传输 | 30~50% 提升 |
| `routing` 查询 | 只查特定分片 | 分片数倍提升 |
| 避免 `script` 查询 | 原生查询比脚本快 | 10~100x 提升 |
| 合理设置分片数 | 减少协调开销 | 视场景而定 |

## 8. 慢查询日志配置

```json
PUT /my-index/_settings
{
  "index.search.slowlog.threshold.query.warn": "5s",
  "index.search.slowlog.threshold.query.info": "2s",
  "index.search.slowlog.threshold.fetch.warn": "1s",
  "index.search.slowlog.level": "info"
}
```

## 9. 最佳实践

- 生产环境开启慢查询日志，定期分析优化
- 使用 `_profile` API 定位查询瓶颈
- 避免在查询中使用 `script`，优先用原生查询
- 高频查询考虑使用 `filter` context 利用缓存
- 监控查询延迟的 P99，而非平均值

