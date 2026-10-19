# 查询优化

## 1. 使用 filter 替代 query

```json
# query context（计算相关性评分）
{ "query": { "range": { "price": { "gte": 100 } } } }

# filter context（不计算评分，可能命中节点查询缓存）
{ "query": { "bool": { "filter": { "range": { "price": { "gte": 100 } } } } } }
```

filter context 不计算相关性评分，符合条件的查询可能受益于节点查询缓存。缓存命中取决于查询类型、重复使用频率和分片状态，并非所有 filter 查询都必然命中缓存。

## 2. 避免深度分页

```json
# 深度分页，候选结果开销随分页深度增加
{ "from": 10000, "size": 10 }

# 快：search_after 取上一页最后一条的 sort 值，需配合稳定排序
GET /my-index/_search
{
  "size": 10,
  "sort": [{ "price": "desc" }, { "order_id": "asc" }],
  "search_after": [99.9, "order_007"]
}
```

search_after 依赖上一页最后一条命中的 sort 数组，取值类型与顺序必须和 sort 一致。排序字段组合需能稳定区分文档，例如 price 降序后追加唯一的 order_id，否则分页可能重复或遗漏。普通 search_after 可独立使用；需要在翻页期间保持固定数据视图时，再结合 PIT。完整方案见[分页查询](../03-search/chapter-07-pagination.md)。

## 3. 使用 _source 过滤

```json
GET /my-index/_search
{
  "_source": ["name", "age"],
  "query": { "match_all": {} }
}
```

_source 过滤主要减少返回的响应体大小，实际收益取决于响应体大小和文档取数成本，不保证按同样比例降低 _source 的读取与解析成本。

## 4. 避免脚本查询

```json
# 慢
{ "query": { "script": { "script": "doc['price'].value > 100" } } }

# 快：优先用能利用索引的原生查询
{ "query": { "range": { "price": { "gt": 100 } } } }
```

脚本并非一概低效，其成本取决于执行方式和候选文档数量。优先用能利用索引结构的原生查询表达条件；确需脚本时，用实际执行数据评估成本。

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

routing 减少参与查询的分片数量，但要求查询路由键与索引时一致，并评估数据倾斜和热点分片风险。使用自定义 routing 后，后续查询或更新该文档都需带上正确的 routing 参数，否则可能定位不到文档；一次查询需要覆盖多个 routing 值时，也不能只传单个值。分片路由机制见[分片机制](../05-distributed-internals/chapter-02-sharding.md)。

## 6. 使用 Profile 分析查询

```json
# 使用 profile API 分析查询执行耗时
GET /my-index/_search
{
  "profile": true,
  "query": {
    "match": { "title": "Elasticsearch" }
  }
}
```

profile 用于分析查询内部各阶段的耗时，本身不负责预热缓存，且有测量开销，不代表完整端到端延迟。

## 7. 查询性能优化清单

| 优化手段 | 机制 | 适用条件与成本 |
| :-- | :-- | :-- |
| `filter` 替代 `query` | 不计算评分，可能命中节点查询缓存 | 结果不需计分时适用 |
| `search_after` 替代深度分页 | 不再要求每个分片保留从起始到目标位置的候选结果 | 需稳定排序，必要时配合 PIT |
| `_source` 过滤 | 减少返回数据量 | 收益取决于响应体大小 |
| `routing` 查询 | 减少参与查询的分片 | 路由键需正确，注意数据倾斜 |
| 避免 `script` 查询 | 原生查询利用索引结构 | 仅当原生查询语义等价时成立 |
| 合理设置分片数 | 减少查询协调与调度开销 | 需权衡并行度，视数据规模与查询模式而定 |

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

慢查询日志是索引级设置，query 阶段与 fetch 阶段分别按各自配置的耗时阈值记录慢日志。index.search.slowlog.level 是日志级别，不代表所有查询都会记录。它用于发现真实慢请求，是性能诊断的入口。

## 9. 最佳实践

- 生产环境开启慢查询日志，先定位真实慢请求
- 用 `_profile` API 分析慢请求内部各阶段耗时，找出瓶颈
- 对照优化前后的延迟分位数、吞吐量和资源消耗验证效果
- 优先用能利用索引的原生查询替代脚本
- 高频查询考虑使用 `filter` context 利用缓存
- 监控查询延迟的 P99，而非平均值

相关优化手段的总览见[索引优化](chapter-01-index-optimization.md)。
