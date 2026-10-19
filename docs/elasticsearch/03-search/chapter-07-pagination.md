# 分页查询

> 以下示例与参数行为以 **Elasticsearch 8.x** 为准。PIT 需要 Elasticsearch 7.10 及以上。

## 1. from + size（基本分页）

```json
GET /my-index/_search
{
  "from": 0,
  "size": 10,
  "query": {
    "match": { "title": "Elasticsearch" }
  }
}
```

**原理**：每个分片返回 `from + size` 条数据到协调节点，协调节点合并后取 `size` 条。

> ⚠️ **深度分页问题**：当 `from` 很大时（如 10000），每个分片需要返回 10010 条数据，3 个分片就是 30030 条。内存和网络开销巨大，可能导致 OOM。

```json
// ❌ 深度分页（性能差）
{ "from": 10000, "size": 10 }

// ES 默认限制 from + size <= 10000（index.max_result_window）
// 该值是保护性护栏，不是推荐的分页深度；调大会放宽限制并增加内存风险
```

## 2. search_after（游标分页）

基于上一页最后一条记录的排序值继续查询，适合深度分页和无限滚动场景：

```json
// 第一页
GET /my-index/_search
{
  "size": 10,
  "query": { "match_all": {} },
  "sort": [
    { "created_at": "desc" },
    { "document_id": "asc" }
  ]
}

// 下一页（使用上一页最后一条的 sort 值）
GET /my-index/_search
{
  "size": 10,
  "query": { "match_all": {} },
  "sort": [
    { "created_at": "desc" },
    { "document_id": "asc" }
  ],
  "search_after": ["2024-01-15T10:30:00Z", "doc_123"]
}
```

`document_id` 需是开启 `doc_values` 的 keyword 字段，并在结果集中取值唯一（通常是业务 ID 的副本）。**不要直接对 `_id` 排序**：ES 8.x 默认禁止按 `_id` 排序/聚合。

**特点**：
- 不支持跳页（只能向后翻页）
- 不必像深度 `from + size` 那样为当前页收集前面所有页的候选结果；实际成本仍取决于查询条件、排序字段和分片规模
- 排序条件应形成确定顺序：在业务排序字段后增加唯一 tie-breaker（如本例的 `document_id`）

## 3. scroll（滚动查询）

创建一个搜索上下文（快照），用于遍历大量数据。**不推荐用于实时用户请求**。

```json
// 创建 scroll
GET /my-index/_search?scroll=1m
{
  "size": 100,
  "query": { "match_all": {} }
}

// 获取下一批
GET /_search/scroll
{
  "scroll": "1m",
  "scroll_id": "DXF1ZXJ5QW5kRmV0Y2gBAAAAAAA..."
}

// 清除 scroll（用完应显式清除）
DELETE /_search/scroll
{
  "scroll_id": "DXF1ZXJ5QW5kRmV0Y2gBAAAAAAA..."
}
```

> ⚠️ **注意**：每个 scroll 上下文都会占用内存。超时后服务端会自动释放，但用完应显式清除，不要依赖超时。需要在分页期间固定索引状态时，新实现优先考虑 `search_after` + Point in Time；scroll 仍可用于部分批量遍历场景。

## 4. Point in Time（PIT）

创建一个时间点快照，配合 `search_after` 使用：

```json
// 1. 创建 PIT，保存响应中的 id
POST /my-index/_pit?keep_alive=1m

// 2. 首页：不传 search_after
// PIT 查询路径不再带索引名；未显式排序时会自动附加 _shard_doc
GET /_search
{
  "size": 10,
  "query": { "match_all": {} },
  "sort": [{ "_shard_doc": "asc" }],
  "pit": {
    "id": "46ToAwMDaWR5bGluZV9...",
    "keep_alive": "1m"
  }
}

// 3. 下一页：search_after 取上一页最后一条命中的 sort 数组
//    （含 _shard_doc），并使用响应中返回的最新 pit id
//    下方 4294967298 为占位示例值，实际以首页响应 hits[].sort 为准
GET /_search
{
  "size": 10,
  "query": { "match_all": {} },
  "sort": [{ "_shard_doc": "asc" }],
  "pit": {
    "id": "46ToAwMDaWR5bGluZV9...",
    "keep_alive": "1m"
  },
  "search_after": [4294967298]
}

// 4. 用完关闭 PIT
DELETE /_pit
{
  "id": "46ToAwMDaWR5bGluZV9..."
}
```

## 5. 分页方案对比

| 方案 | 适用场景 | 性能 | 是否支持跳页 |
| :-- | :-- | :-- | :-- |
| `from + size` | 浅分页（工程上常控制在约 1000 条内） | 深度分页差 | ✅ 支持 |
| `search_after` | 深度分页、无限滚动 | 不随 from 深度膨胀 | ❌ 不支持 |
| `scroll` | 批量遍历、遗留导出流程 | 受批次大小与上下文保留影响 | ❌ 不支持 |
| `PIT + search_after` | 需固定索引状态的一致性分页 | 不随 from 深度膨胀 | ❌ 不支持 |

## 6. 最佳实践

- 浅分页（工程上常控制在约 1000 条内）使用 `from + size`；这是经验建议，不是 ES 的硬阈值
- 硬限制是 `index.max_result_window`（默认 10000），用于限制 `from + size` 的内存开销；需要更深分页时优先改用 `search_after`，而不是单纯调大该值
- 深度分页使用 `search_after`，在业务排序字段后增加唯一 tie-breaker
- 新实现的数据导出优先 `PIT + search_after`；scroll 仍可用于部分批量遍历场景，但不宜用于实时用户请求
- 业务上避免提供「跳到第 N 页」功能，改用「加载更多」
