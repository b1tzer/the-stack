# 分页

> ES 的分页有三种方式，各有适用场景。选错分页方式可能导致性能问题或结果不准确。

## 1. from + size（浅分页）

```json
{
  "from": 0,
  "size": 10,
  "query": { "match_all": {} }
}
```

**原理**：每个分片返回 `from + size` 条结果，协调节点合并后取 `size` 条。

**问题**：深度分页时性能急剧下降。

```text
from=10000, size=10
  每个分片返回 10010 条
  3 个分片 = 30030 条
  协调节点排序后取 10 条
  → 内存和计算开销巨大
```

**限制**：`index.max_result_window` 默认 10000，超过会报错。

## 2. search_after（深分页）

```json
// 第一页
{
  "size": 10,
  "sort": [{ "publish_date": "desc" }, { "_id": "asc" }],
  "query": { "match_all": {} }
}

// 下一页（用上一页最后一条的 sort 值）
{
  "size": 10,
  "sort": [{ "publish_date": "desc" }, { "_id": "asc" }],
  "search_after": ["2026-08-31", "doc_123"],
  "query": { "match_all": {} }
}
```

**原理**：从上一页最后一条的排序值开始，向后取 `size` 条。

**优点**：深度分页性能稳定（不随页码增长）。

**缺点**：不能跳页（只能"下一页"），需要唯一排序字段。

## 3. scroll（遍历）

```json
// 创建 scroll 上下文
{
  "size": 100,
  "scroll": "1m",
  "query": { "match_all": {} }
}

// 获取下一批
{
  "scroll_id": "DXF1ZXJ5QW5kRmV0Y2g...",
  "scroll": "1m"
}

// 用完后删除 scroll
DELETE /_search/scroll
{ "scroll_id": "DXF1ZXJ5QW5kRmV0Y2g..." }
```

**适用场景**：全量数据导出、重建索引。

**注意**：scroll 会占用服务器资源，用完必须删除。

## 4. 分页方式选择

| 场景 | 推荐方式 |
|------|----------|
| 前几页（from < 1000） | from + size |
| 无限滚动（"加载更多"） | search_after |
| 全量导出 | scroll |
| 跳页（"第100页"） | search_after（维护页码映射） |

## 5. 深度分页的替代方案

如果业务需要跳到第 N 页：

```text
方案 1：限制最大页码（如只允许前 100 页）
方案 2：用 search_after + 前端维护页码状态
方案 3：用 Elasticsearch 的 Point In Time (PIT) API
```

### PIT（Point In Time）

```json
// 创建 PIT
POST /my-index/_pit?keep_alive=1m

// 使用 PIT 查询
{
  "size": 10,
  "sort": [{ "_shard_doc": "asc" }],
  "pit": { "id": "46ToAwMD...", "keep_alive": "1m" },
  "search_after": [4294967298]
}
```

PIT 保证查询期间索引快照不变，避免分页过程中数据变更导致结果不一致。
