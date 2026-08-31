# 写入流程

## 1. 文档写入流程

```
Client → Coordinating Node → Primary Shard → Replica Shards
```

## 2. Refresh

- 将 Buffer 中的数据写入 Segment
- 默认 1s 一次
- 写入后可搜索（近实时）

```json
POST /my-index/_refresh
```

## 3. Flush

- 将 Translog 数据持久化到磁盘
- 清空 Translog

```json
POST /my-index/_flush
```

## 4. Translog

- 事务日志，保证数据不丢失
- 每次写入先写 Translog
- Flush 后清空

## 5. 近实时搜索

```
写入 → Buffer → Refresh → Segment → 可搜索
              ↓
           Translog（持久化）
```
## 6. 写入流程详解

```
1. 客户端发送写入请求到协调节点
2. 协调节点根据 _id 计算路由：shard = hash(_id) % 主分片数
3. 请求转发到主分片所在节点
4. 主分片执行写入：
   a. 写入 Translog（保证持久性）
   b. 写入内存 Buffer
5. 主分片转发请求到所有副本分片
6. 副本分片写入成功后返回确认
7. 主分片返回成功给协调节点
8. 协调节点返回客户端
```

## 7. 写入一致性

```json
# 设置写入需要多少分片确认
PUT /my-index/_settings
{
  "index.write.wait_for_active_shards": 2
}
```

| 参数值 | 说明 |
|--------|------|
| `all` | 所有分片确认（最安全，最慢） |
| `1` | 只需主分片确认（最快，风险高） |
| `2` | 主分片 + 1个副本确认（推荐） |
| `quorum` | 多数分片确认 |

## 8. 写入性能优化

```json
# 批量写入前临时关闭 refresh
PUT /my-index/_settings
{
  "index.refresh_interval": "-1",
  "index.number_of_replicas": 0
}

# 批量写入完成后恢复
PUT /my-index/_settings
{
  "index.refresh_interval": "1s",
  "index.number_of_replicas": 1
}
```

## 9. 最佳实践

- 大批量写入使用 Bulk API，每批 5~15MB
- 批量写入期间临时关闭 refresh 和副本，写完后恢复
- Translog 使用 `request` 模式保证数据安全
- 监控写入队列大小，避免堆积导致节点压力过大
- 写入失败时检查 `_bulk` 响应中每个操作的 `status` 字段

