# 写入流程

## 1. 文档写入流程

```txt
Client → Coordinating Node → Primary Shard → Replica Shards
```

## 2. Refresh

- 将内存 Buffer 中的数据写入新的 Segment
- 默认 `refresh_interval` 为 1s，但近 30 秒无搜索请求的分片不会自动刷新
- 刷新后可搜索（近实时）

```json
POST /my-index/_refresh
```

## 3. Flush

- 执行 Lucene commit，将已刷新的 Segment 提交到磁盘，形成 commit point
- 提交后开启新的 Translog generation，旧的 generation 才会被清理

```json
POST /my-index/_flush
```

## 4. Translog

- 事务日志，用于崩溃后重放尚未提交的写入
- 写入操作先记录到 Translog，再进入内存 Buffer
- 记录不等于持久化：`index.translog.durability` 为 `request`（默认）时，请求返回前确保 Translog 已持久化到磁盘，为 `async` 时按固定间隔刷盘，崩溃可能丢失最近的写入
- Flush 提交 Lucene commit 后切换新的 generation

## 5. 近实时搜索

```txt
写入 → Buffer → Refresh → Segment → 刷新后可搜索
              ↓
           Translog（崩溃恢复）
```

## 6. 写入流程详解

```txt
1. 客户端发送写入请求到协调节点
2. 协调节点计算路由，默认按 _id：shard = hash(_id) % 主分片数；指定 routing 时按 routing 值计算
3. 请求转发到主分片所在节点
4. 主分片执行写入：
   a. 记录 Translog（按 durability 策略决定是否 fsync）
   b. 写入内存 Buffer
5. 主分片将操作转发给副本分片
6. 副本分片执行写入并回复；个别副本失败通常不导致整个请求失败，但会体现在复制结果中
7. 主分片根据复制结果向协调节点返回响应，_shards 字段给出成功/失败的分片副本数量
8. 协调节点返回客户端
```

## 7. 写入前的活动分片检查

`wait_for_active_shards` 在写入执行前检查：要求目标分片至少 N 个副本（主分片及副本）处于活动状态，不足时等待至满足或超时失败。它是写入前的可用性门槛，不是写入成功的确认策略。

```json
# 要求主分片 + 至少 1 个副本处于活动状态才执行写入
PUT /my-index/_settings
{
  "index.write.wait_for_active_shards": 2
}
```

| 参数值 | 说明 |
| :-- | :-- |
| `1` | 默认值，仅主分片活动即可执行 |
| `2` | 主分片 + 至少 1 个副本活动 |
| `all` | 目标分片的主分片及全部副本都活动才执行，可用性最受约束 |

> 满足活动检查不代表写入期间所有副本必然成功。副本复制结果需结合响应中的 `_shards` 字段判断。

## 8. 写入性能优化

以下优化只适用于离线批量导入等可以短暂牺牲可见性和冗余的场景，不适合持续承接生产流量的索引。

```json
# 批量写入前临时关闭 refresh 和副本
PUT /my-index/_settings
{
  "index.refresh_interval": "-1",
  "index.number_of_replicas": 0
}

# 批量写入完成后恢复（示例假设原配置即这两个值，实际应恢复导入前的设置）
PUT /my-index/_settings
{
  "index.refresh_interval": "1s",
  "index.number_of_replicas": 1
}
```

关闭副本意味着写入期间失去冗余保护，主分片所在节点或存储发生故障时数据可能不可用甚至丢失；关闭 refresh 意味着数据不可搜索。导入异常时必须检查并恢复原有设置，避免索引长期停留在无副本、无刷新的状态。

## 9. 最佳实践

- 大批量写入使用 Bulk API，批次大小按文档大小和集群资源调优，5~15MB 可作为起点
- 批量导入期间临时关闭 refresh 和副本，写完后恢复，并确认副本分配完成、数据重新可见
- Translog 使用 `request` 模式，保证写入确认时已持久化
- 监控写入队列大小，避免堆积导致节点压力过大
- 写入失败时检查 `_bulk` 响应中每个操作的 `status` 字段，以及 `_shards` 的复制结果

