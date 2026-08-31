# 读取流程

> ES 的读取流程比写入更复杂：需要从多个分片合并结果，还需要处理近实时的可见性问题。

## 1. 查询流程

```text
Client → Coordinator Node
  → 并行查询所有相关 Shard（Primary 或 Replica）
  → 每个 Shard 返回 Top N 结果 + 分数
  → Coordinator Node 合并排序 → 取全局 Top N
  → 返回 Client
```

## 2. 两阶段查询

### Query Phase

```text
Coordinator → 所有 Shard：给我匹配文档的 _id 和 _score
  → 每个 Shard 在本地查询，返回 Top N 的 _id + _score
  → Coordinator 合并所有 Shard 的结果，排序取全局 Top N
```

### Fetch Phase

```text
Coordinator → 相关 Shard：给我这些 _id 的完整文档
  → Shard 返回完整 _source
  → Coordinator 组装最终结果
```

**为什么分两阶段**：减少网络传输。Query Phase 只传 _id（小），Fetch Phase 只取需要的文档（精确）。

## 3. 读取性能优化

| 优化项 | 方法 |
|--------|------|
| 路由查询 | 指定 routing，只查一个 Shard |
| 过滤条件用 filter | 利用 Filter Cache |
| 只返回需要的字段 | `_source` 过滤 |
| 关闭 _source | 不需要完整文档时 |
| 使用 search_after | 替代深度分页 |
