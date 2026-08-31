# 分页查询

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

// ES 默认限制 from + size <= 10000
// 可通过 index.max_result_window 参数修改（不推荐）
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
    { "_id": "asc" }
  ]
}

// 下一页（使用上一页最后一条的 sort 值）
GET /my-index/_search
{
  "size": 10,
  "query": { "match_all": {} },
  "sort": [
    { "created_at": "desc" },
    { "_id": "asc" }
  ],
  "search_after": ["2024-01-15T10:30:00Z", "doc_123"]
}
```

**特点**：
- 不支持跳页（只能向后翻页）
- 性能稳定，不随页码增大而下降
- 排序字段必须包含唯一值（如 `_id`）保证排序稳定性

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

// 清除 scroll（必须手动清除）
DELETE /_search/scroll
{
  "scroll_id": "DXF1ZXJ5QW5kRmV0Y2gBAAAAAAA..."
}
```

> ⚠️ **注意**：每个 scroll 上文都会占用内存，使用完必须清除。ES 7.x 后推荐使用 `search_after` + `point_in_time` 替代。

## 4. Point in Time（PIT）

创建一个时间点快照，配合 `search_after` 使用：

```json
// 创建 PIT
POST /my-index/_pit?keep_alive=1m

// 使用 PIT 查询
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
```

## 5. 分页方案对比

| 方案 | 适用场景 | 性能 | 是否支持跳页 |
|------|---------|------|------------|
| `from + size` | 浅分页（前 1000 条） | 深度分页差 | ✅ 支持 |
| `search_after` | 深度分页、无限滚动 | 稳定 | ❌ 不支持 |
| `scroll` | 数据导出、批量处理 | 中等 | ❌ 不支持 |
| `PIT + search_after` | 一致性分页 | 稳定 | ❌ 不支持 |

## 6. 最佳实践

- 浅分页（< 1000 条）使用 `from + size`
- 深度分页使用 `search_after`，排序字段包含唯一值
- 数据导出使用 `scroll` 或 `PIT + search_after`
- 业务上避免提供"跳到第 N 页"功能，改用"加载更多"
- 设置合理的 `max_result_window`（默认 10000），防止深度分页 OOM
