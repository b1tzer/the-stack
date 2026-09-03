# 近实时搜索

## 1. Near Real-Time（NRT）机制

ES 不是实时搜索引擎，而是近实时搜索引擎。文档写入后需要经过 `refresh` 操作才能被搜索到，默认延迟约 1 秒。

```
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
| `1s`（默认） | 每秒刷新 | 通用场景 |
| `5s` | 每 5 秒刷新 | 写入密集型 |
| `-1` | 不自动刷新 | 批量导入 |
| `null` | 恢复默认 | - |

## 3. Translog 与持久性

Translog 保证了 refresh 之前的数据不会因为节点崩溃而丢失：

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
| `durability: request` | 每次写入后 fsync（默认，最安全） |
| `durability: async` | 定期 fsync（性能高，可能丢少量数据） |
| `flush_threshold_size` | translog 达到此大小后自动 flush |

## 4. Flush 操作

Flush 将内存中的 Segment 持久化到磁盘，并清空 Translog：

```json
// 手动 flush
POST /my-index/_flush

// 同步 flush（生成 commit point，加速恢复）
POST /my-index/_flush/synced
```

## 5. 写入流程时序

```txt
t=0    文档写入内存 Buffer + Translog（不可搜索）
t<1s   文档在内存中，搜索不到
t=1s   Refresh 触发 → 新 Segment → 文档可搜索
t=30m  Flush 触发 → Segment 持久化到磁盘 → Translog 清空
```

## 6. 如何让文档立即可搜索

```json
// 方式1：写入时指定 refresh=true（影响性能）
PUT /my-index/_doc/1?refresh=true
{
  "title": "立即可搜索"
}

// 方式2：写入后手动 refresh
POST /my-index/_refresh

// 方式3：设置更短的 refresh_interval
PUT /my-index/_settings
{
  "index.refresh_interval": "500ms"
}
```

## 7. Segment 与近实时

每个 Segment 是一个完整的倒排索引，不可变。Refresh 操作创建新的 Segment：

| 操作 | 效果 |
| :-- | :-- |
| 新增文档 | 写入新 Segment |
| 删除文档 | 在 .del 文件中标记 |
| 更新文档 | 标记旧文档删除 + 写入新 Segment |
| Segment Merge | 合并小 Segment，物理删除标记文档 |

## 8. 最佳实践

- 通用场景使用默认 `refresh_interval: 1s`
- 批量写入时临时设为 `-1`，写完后手动 `_refresh`
- 不要频繁调用 `_refresh`，会产生大量小 Segment
- Translog 使用 `request` 模式保证数据安全
- 监控 Segment 数量，过多时执行 `_forcemerge`
- 生产环境接受 1s 的近实时延迟，不要为了实时性过度调优
