# 常见问题排查

## 1. 集群状态异常

### 1.1 Yellow 状态

```json
// 查看未分配分片原因
GET /_cluster/allocation/explain

// 常见原因：单节点集群设置副本 > 0
// 解决方案：增加节点或减少副本数
PUT /my-index/_settings
{
  "number_of_replicas": 0
}
```

### 1.2 Red 状态

```json
// 查看哪些索引是 Red
GET /_cat/indices?v&health=red

// 查看未分配分片及原因
GET /_cat/shards?v&h=index,shard,prirep,state,unassigned.reason&s=state

// 定位具体分片为何未分配
GET /_cluster/allocation/explain

// 常见原因：节点磁盘满、节点宕机
// 解决方案：清理磁盘、恢复节点；分配条件满足后重试失败分配
POST /_cluster/reroute?retry_failed=true
```

Red 状态的诊断顺序：

1. 观测：用 `_cat/indices` 定位 Red 索引，用 `_cat/shards` 查看未分配分片的 `unassigned.reason`。
2. 判定：`NODE_LEFT` 多为节点宕机或失联；`DISK_THRESHOLD` 多为磁盘满；`ALLOCATION_FAILED` 需结合节点日志与 `_cluster/allocation/explain` 判断是资源不足还是分配约束。
3. 处置：磁盘满则清理或扩容；节点失联则恢复节点或等待其重新加入；确认分配条件满足后，可用 `reroute?retry_failed=true` 重试此前失败的分配。
4. 验证：确认目标索引主分片已分配、集群不再 Red；目标是 Green 时，还需确认副本分片全部分配（单节点 + 副本的集群恢复到 Yellow 可能已是合理终态）。

## 2. 写入问题

### 2.1 写入被拒绝（429 Too Many Requests）

```json
// 查看写入线程池状态，重点观察 rejected 是否持续增长
GET /_cat/thread_pool/write?v&h=node_name,name,active,queue,rejected,completed

// 排查思路：
// 1. 观察 rejected 的增量，判断是瞬时高峰还是持续积压
// 2. 结合 CPU、磁盘 I/O 判断是并发过高还是底层资源不足
// 3. 优先减小 Bulk 请求大小、降低并发
// 注意：write 线程池的 size 是静态配置，需写入 elasticsearch.yml 并重启节点，
// 不能通过 _cluster/settings 动态修改
```

### 2.2 磁盘水位线触发

```json
// 查看磁盘使用率
GET /_cat/allocation?v

// 临时提高水位线（三者必须严格递增：low < high < flood_stage）
PUT /_cluster/settings
{
  "transient": {
    "cluster.routing.allocation.disk.watermark.low": "88%",
    "cluster.routing.allocation.disk.watermark.high": "92%",
    "cluster.routing.allocation.disk.watermark.flood_stage": "95%"
  }
}

// 注意：提高水位线会缩小磁盘保护余量，仅在确认剩余磁盘空间足以承担风险时临时调整，
// 应急结束后恢复原有配置并确认磁盘余量与分片分配状态正常。
// 根本解决仍需扩容、清理数据或迁移分片
```

## 3. 查询问题

### 3.1 查询超时

```json
// 设置查询超时
GET /my-index/_search
{
  "timeout": "10s",
  "query": { "match_all": {} }
}

// 使用 profile 分析查询（仅用于定位慢查询，会增加查询开销）
GET /my-index/_search
{
  "profile": true,
  "query": { "match": { "title": "test" } }
}
```

> `timeout` 不保证整个 HTTP 请求一定在 10 秒内结束，超时后应结合响应中的 `timed_out` 字段判断结果是否完整；`profile: true` 会增加查询开销，仅适合针对具体慢查询做诊断，定位后应关闭 Profile 再验证优化效果。

### 3.2 深度分页超时

```json
// ❌ 深度分页（慢）
{ "from": 100000, "size": 10 }

// ✅ 使用 search_after
// 前提：order_id 需映射为 keyword 并启用 doc_values，作为稳定且唯一的排序键
{
  "size": 10,
  "sort": [{ "created_at": "desc" }, { "order_id": "asc" }],
  "search_after": ["2024-01-15", "A1024"]
}
```

> `_id` 是元数据字段，默认未启用 doc_values，不能直接用于排序。如需按文档标识排序，须将其复制到启用 doc_values 的普通字段。此外 search_after 依赖稳定且唯一的排序键，若需在分页期间保持一致的索引视图，应配合 PIT（Point in Time）使用。

## 4. JVM 问题

### 4.1 OOM（OutOfMemoryError）

```bash
# 检查 JVM 堆使用
GET /_nodes/stats/jvm

# 排查顺序：
# 1. 先确认故障类型：检查日志中的 OutOfMemoryError、节点 JVM 统计、容器/OS 的 OOM 记录，
#    区分是 Java 堆耗尽、直接内存/线程栈耗尽还是容器内存限制
# 2. 确认是堆耗尽后，再考虑增加堆（不超过进程可用内存的 50%，避免过大导致压缩指针失效）
# 3. 减少分片数量
# 4. 优化查询（避免深度分页）
```

### 4.2 GC 暂停过长

```bash
# 查看 GC 日志与堆使用
GET /_nodes/stats/jvm,indices,breaker

# 排查顺序：
# 1. 区分 GC 成因：Young GC 频繁、Old GC 频繁还是长时间停顿
# 2. 结合堆使用曲线、索引负载、断路器统计定位分配压力
# 3. 若怀疑 JVM 堆被交换到磁盘导致延迟，检查 swap 并采取预防措施（关闭 swap、
#    调整 vm.swappiness，或配置 bootstrap.memory_lock 并确认锁定生效），而非把 memory_lock 当 GC 通用解法
# 4. 仅当只读索引的 Segment 过多构成瓶颈时，才考虑 forcemerge
```

堆大小经验建议：堆不超过可用内存的 50%（容器部署以容器可见内存为准）；堆过大会影响对象指针压缩与 GC 行为，26GB 对多数系统是安全值，不应写成统一的 32GB 硬上限。

## 5. 分片问题

### 5.1 分片未分配

```json
GET /_cluster/allocation/explain
{
  "index": "my-index",
  "shard": 0,
  "primary": true
}
```

### 5.2 分片恢复缓慢

```json
// 查看恢复状态
GET /_cat/recovery?v&active_only=true

// 调整恢复速度（示例值，应根据节点负载、磁盘吞吐、网络带宽逐步调整）
PUT /_cluster/settings
{
  "transient": {
    "cluster.routing.allocation.node_concurrent_recoveries": 4,
    "indices.recovery.max_bytes_per_sec": "200mb"
  }
}
```

> 提高并发恢复与恢复带宽可能加快恢复，也可能加剧磁盘 I/O、网络竞争与正常业务延迟，应根据实际负载逐步调整，观察到副作用时回退。

## 6. 排查工具

| 工具 | 用途 |
| :-- | :-- |
| `_cluster/health` | 集群健康状态 |
| `_cat/nodes` | 节点信息 |
| `_cat/indices` | 索引信息 |
| `_cat/shards` | 分片信息 |
| `_cat/thread_pool` | 线程池状态 |
| `_nodes/stats` | 节点统计 |
| `_cluster/allocation/explain` | 分片分配原因 |
| Search API 的 `profile` 参数 | 查询性能分析 |

## 7. 最佳实践

- 定期检查集群健康状态
- 监控关键指标（JVM、磁盘、队列）
- 开启慢查询日志
- 保留错误日志用于排查
- 建立标准化的排查流程
