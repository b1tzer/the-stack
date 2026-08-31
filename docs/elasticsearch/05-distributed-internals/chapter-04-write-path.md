# 写入流程

> 理解 ES 的写入流程，是理解为什么写入后不能立即搜索到（近实时）的关键。

## 1. 写入流程全链路

```text
Client ──▶ Coordinator Node ──▶ Primary Shard ──▶ Replica Shards
                                │
                                ├─ 1. 写入 Translog（WAL）
                                ├─ 2. 写入 Memory Buffer
                                ├─ 3. Refresh（1秒）→ Segment（OS Cache）
                                ├─ 4. Flush → Segment（磁盘）
                                └─ 5. Translog 清理
```

## 2. 详细步骤

### 2.1 写入请求路由

```text
Client → Coordinator Node（任意节点）
  → 根据 _id 计算 hash → 路由到对应 Primary Shard
  → Primary Shard 写入成功后 → 并行复制到 Replica Shards
  → 所有 Shard 确认 → 返回 Client
```

### 2.2 写入 Primary Shard

```text
1. 写入 Translog（类似 MySQL 的 Redo Log，保证数据不丢）
2. 写入 Memory Buffer（内存缓冲区）
3. 每 1 秒 Refresh：Memory Buffer → Segment（OS Cache）
4. Translog 累积到 512MB 或 30 分钟 → Flush：Segment 写入磁盘
```

### 2.3 Refresh 的作用

```text
Refresh 前：数据在 Memory Buffer，搜索不到
Refresh 后：数据在 Segment（OS Cache），可以搜索到
```

**Refresh 间隔**：默认 1 秒（`index.refresh_interval`）。这就是 ES 的"近实时"（Near Real-Time）——写入后最多 1 秒才能搜到。

### 2.4 Flush 的作用

```text
Flush：将 OS Cache 中的 Segment 真正写入磁盘，同时清空 Translog
```

## 3. 近实时的含义

```text
t=0ms:   写入文档
t=1000ms: Refresh → 可搜索
```

如果需要写入后立即可搜索：

```json
// 强制 Refresh（性能差，仅在特殊场景使用）
PUT /my-index/_doc/1?refresh=true
{ "title": "test" }
```

## 4. 数据安全性保证

```text
Translog（类似 MySQL Redo Log）
  → 保证在 Segment Flush 前崩溃，数据不丢
  → 默认每次写入都同步 Translog（`index.translog.durability = request`）
```

## 5. 写入性能优化

| 优化项 | 方法 | 效果 |
|--------|------|------|
| 增大 Refresh 间隔 | `refresh_interval = 30s` | 减少 Segment 创建频率 |
| 批量写入 | Bulk API | 减少网络往返 |
| 关闭副本写入 | `number_of_replicas = 0`（写入时） | 写入完成后再开启 |
| Translog 异步 | `translog.durability = async` | 提升写入性能（有丢数据风险） |
