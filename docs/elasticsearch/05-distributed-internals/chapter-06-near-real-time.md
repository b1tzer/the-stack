# 近实时搜索

## 1. Near Real-Time（NRT）机制

ES 不是实时搜索引擎，而是近实时搜索引擎。文档写入后需要经过 `refresh` 操作才能被搜索到，默认延迟约 1 秒。

默认 1s 是刷新间隔设置，不代表每个分片始终每秒执行后台刷新。分片进入 search-idle 状态（默认 30 秒无搜索请求）后会暂停后台刷新，直到下一次搜索触发。

```txt
写入 → Buffer → refresh（默认1s）→ Segment → 可搜索
              ↓
           Translog（持久化，防止数据丢失）
```

## 2. Refresh 操作

```json
// 手动刷新索引
POST /my-index/_refresh

// 设置刷新间隔
PUT /my-index/_settings
{
  "index.refresh_interval": "5s"
}

// 关闭自动刷新（批量写入时）
PUT /my-index/_settings
{
  "index.refresh_interval": "-1"
}
```

| refresh_interval | 说明 | 适用场景 |
| :-- | :-- | :-- |
| `1s`（默认） | 默认刷新间隔约 1 秒（search-idle 分片除外） | 通用场景 |
| `5s` | 每 5 秒刷新 | 写入密集型 |
| `-1` | 不自动刷新 | 批量导入 |
| `null` | 恢复默认 | - |

## 3. Translog 与持久性

Translog 用于恢复尚未通过 Lucene commit 持久化的操作。数据能否在故障后恢复，取决于 Translog 的持久化策略以及操作是否已完成同步：

```json
// Translog 配置
PUT /my-index/_settings
{
  "index.translog.durability": "request",
  "index.translog.sync_interval": "5s",
  "index.translog.flush_threshold_size": "512mb"
}
```

| 配置 | 说明 |
| :-- | :-- |
| `durability: request` | 每个写请求成功返回前，主分片及所有已分配副本分片完成 Translog 的 fsync 和提交（默认） |
| `durability: async` | 按 `sync_interval` 周期 fsync，最近一次同步后尚未持久化的操作可能丢失 |
| `flush_threshold_size` | translog 达到此大小后自动 flush |

## 4. Flush 操作

Flush 的核心是执行一次 Lucene commit，并开启新的 Translog generation，使旧 generation 在满足条件后可以被清理。Refresh 使近期操作对搜索可见，Flush 通过 Lucene commit 持久化索引提交并推进 Translog generation，两者解决的问题不同：

```json
// 手动 flush（执行 Lucene commit）
POST /my-index/_flush
```

## 5. 写入流程时序

```txt
写入操作
   ├── Refresh（默认约 1s）→ 新 Segment → 搜索可见
   └── Translog fsync/commit → 写入持久性保障
                                    │
                                    ▼
                Flush：Lucene commit + 开启新 Translog generation
```

Refresh 解决搜索可见性，Translog 解决持久性，二者是相互独立的机制，不构成每次写入必经的固定步骤序列。Flush 不固定时间触发，也不意味着所有 Translog 立即被删除。

## 6. 如何让文档立即可搜索

```json
// 方式1：refresh=wait_for，等待下一次 refresh（开销低）
PUT /my-index/_doc/1?refresh=wait_for
{
  "title": "等待搜索可见"
}

// 方式2：refresh=true，强制刷新（写入开销高）
PUT /my-index/_doc/1?refresh=true
{
  "title": "立即可搜索"
}

// 方式3：写入后手动 refresh
POST /my-index/_refresh
```

三种行为有本质区别：默认异步可见（写入即返回，等后台 refresh）、`refresh=wait_for`（等待下一次 refresh，不主动触发）、`refresh=true`（主动强制刷新，代价最高）。缩短 `refresh_interval` 只适用于确实需要整体降低搜索可见延迟的场景，不是单文档即时查询的首选。

## 7. Segment 与近实时

每个 Segment 是一个完整的倒排索引，不可变。Refresh 操作创建新的 Segment：

| 操作 | 效果 |
| :-- | :-- |
| 新增文档 | 写入新 Segment |
| 删除文档 | 标记为已删除，查询时不再返回 |
| 更新文档 | 标记旧文档删除 + 写入新 Segment |
| Segment Merge | 合并小 Segment，物理删除标记文档 |

## 8. 最佳实践

- 通用场景使用默认 `refresh_interval: 1s`
- 批量写入时临时设为 `-1`，写完后手动 `_refresh`
- 不要频繁调用 `_refresh`，会产生大量小 Segment
- Translog 使用 `request` 模式保证数据安全
- 监控 Segment 数量及其变化趋势，优先排查写入量与刷新频率；仅在合适的只读索引上评估 `_forcemerge`
- 生产环境接受 1s 的近实时延迟，不要为了实时性过度调优
