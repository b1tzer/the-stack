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

// 查看未分配分片
GET /_cat/shards?v&h=index,shard,prirep,state,unassigned.reason&s=state

// 常见原因：节点磁盘满、节点宕机
// 解决方案：清理磁盘、恢复节点、分配分片
POST /_cluster/reroute?retry_failed=true
```

## 2. 写入问题

### 2.1 写入被拒绝（429 Too Many Requests）

```json
// 查看写入线程池状态
GET /_cat/thread_pool/write?v&h=name,active,queue,rejected

// 解决方案：
// 1. 减小 Bulk 请求大小
// 2. 增加写入线程池大小
PUT /_cluster/settings
{
  "transient": {
    "thread_pool.write.size": 32
  }
}
```

### 2.2 磁盘水位线触发

```json
// 查看磁盘使用率
GET /_cat/allocation?v

// 临时降低水位线阈值
PUT /_cluster/settings
{
  "transient": {
    "cluster.routing.allocation.disk.watermark.low": "90%",
    "cluster.routing.allocation.disk.watermark.high": "95%"
  }
}
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

// 使用 profile 分析查询
GET /my-index/_search
{
  "profile": true,
  "query": { "match": { "title": "test" } }
}
```

### 3.2 深度分页超时

```json
// ❌ 深度分页（慢）
{ "from": 100000, "size": 10 }

// ✅ 使用 search_after
{
  "size": 10,
  "sort": [{ "created_at": "desc" }, { "_id": "asc" }],
  "search_after": ["2024-01-15", "doc_123"]
}
```

## 4. JVM 问题

### 4.1 OOM（OutOfMemoryError）

```bash
# 检查 JVM 堆使用
GET /_nodes/stats/jvm

# 解决方案：
# 1. 增加堆内存（不超过 32GB）
# 2. 减少分片数量
# 3. 优化查询（避免深度分页）
```

### 4.2 GC 暂停过长

```bash
# 查看 GC 日志
GET /_nodes/stats/jvm

# 解决方案：
# 1. 确保堆内存不超过物理内存的 50%
# 2. 启用 memory_lock
# 3. 减少 Segment 数量（forcemerge）
```

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

// 调整恢复速度
PUT /_cluster/settings
{
  "transient": {
    "cluster.routing.allocation.node_concurrent_recoveries": 4,
    "indices.recovery.max_bytes_per_sec": "200mb"
  }
}
```

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
| `_profile` | 查询性能分析 |

## 7. 最佳实践

- 定期检查集群健康状态
- 监控关键指标（JVM、磁盘、队列）
- 开启慢查询日志
- 保留错误日志用于排查
- 建立标准化的排查流程
