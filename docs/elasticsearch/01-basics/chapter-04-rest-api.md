# REST API

本文是常用 REST API 的速查入口：关键行为边界在此点到为止，机制与深入内容链接到对应专题章节。

## 1. 集群健康

```bash
GET /_cluster/health
```

## 2. 索引操作

```bash
# 创建索引
PUT /my-index
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1
  }
}

# 查看索引
GET /my-index

# 删除索引（破坏性操作：没有快照等备份时，无法通过 API 撤销删除）
DELETE /my-index
```

## 3. 文档操作

```bash
# 索引文档
POST /my-index/_doc/1
{
  "name": "张三",
  "age": 25
}

# 获取文档
GET /my-index/_doc/1

# 更新文档
POST /my-index/_update/1
{
  "doc": { "age": 26 }
}

# 删除文档
DELETE /my-index/_doc/1
```

写入请求成功返回，不代表文档立即能被搜索到：搜索可见性取决于索引刷新，而写入确认、持久性与可见性是三个不同的问题。活跃索引默认通常每秒刷新一次（由 `index.refresh_interval` 控制，实际受配置和负载影响）。需要写入后立即可搜时，可加 `?refresh=wait_for` 等待本次写入通过正常刷新变为搜索可见，或 `?refresh=true` 立即触发刷新——后者会抬高写入与后续查询成本，不适合当作普通写入的默认做法。部分更新的并发冲突与乐观并发控制见[文档 CRUD](../02-indexing/chapter-01-document-crud.md)，写入从请求到可见的完整链路见[写入流程](../05-distributed-internals/chapter-04-write-path.md)。

## 4. 批量操作

```bash
POST /_bulk
{"index": {"_index": "my-index", "_id": "1"}}
{"name": "张三", "age": 25}
{"index": {"_index": "my-index", "_id": "2"}}
{"name": "李四", "age": 30}
```

请求体是 NDJSON：每行一个独立的 JSON 对象，不是 JSON 数组，且末行必须以换行符结束。除 `index` 外还有三类操作，行结构各不相同：

```bash
POST /_bulk
{"create": {"_index": "my-index", "_id": "3"}}
{"name": "王五", "age": 28}
{"update": {"_index": "my-index", "_id": "1"}}
{"doc": {"age": 26}}
{"delete": {"_index": "my-index", "_id": "2"}}
```

- `index`：新增或整篇替换文档
- `create`：目标文档必须不存在，适合只允许首次写入的场景
- `update`：第二行必须是 `{"doc": {...}}` 之类的更新载荷
- `delete`：只有操作行，没有数据行

响应返回 HTTP 200 不等于每条都成功：要检查响应体的 `errors` 字段，并逐项核对 `items[].status` 和 `items[].error`。单个操作执行失败通常不会阻止其他操作继续处理，但请求体格式错误等请求级问题会导致整个请求失败；盲目重试整个批次可能重复执行已成功的操作，应只重试失败项。单条操作的语义详见[文档 CRUD](../02-indexing/chapter-01-document-crud.md)。

## 5. Kibana Dev Tools

- 本地默认部署通常为 `http://localhost:5601/app/dev_tools`，实际地址以部署配置为准
- 支持语法高亮、自动补全

## 6. 搜索查询

```bash
# 基本搜索
GET /my-index/_search
{
  "query": {
    "match": { "name": "张三" }
  }
}

# 布尔组合查询
GET /my-index/_search
{
  "query": {
    "bool": {
      "must": [{ "match": { "name": "张三" } }],
      "filter": [{ "range": { "age": { "gte": 20, "lte": 30 } } }]
    }
  },
  "sort": [{ "age": "asc" }],
  "from": 0,
  "size": 10
}
```

更多查询语法与组合方式见[查询 DSL](../03-search/chapter-01-query-dsl.md)。

## 7. 聚合查询

```bash
GET /my-index/_search
{
  "size": 0,
  "aggs": {
    "avg_age": { "avg": { "field": "age" } },
    "age_ranges": {
      "range": {
        "field": "age",
        "ranges": [
          { "to": 20 },
          { "from": 20, "to": 30 },
          { "from": 30 }
        ]
      }
    }
  }
}
```

## 8. 常用 _cat API

```bash
GET /_cluster/health
GET /_cat/indices?v&s=index
GET /_cat/nodes?v
GET /_cat/shards?v
GET /_cat/allocation?v
```

## 9. 最佳实践

- 使用 Kibana Dev Tools 进行 API 调试
- 批量操作使用 `_bulk` API；5~15MB 可作为批次大小的压测起点，按文档大小、写入吞吐和失败重试成本调优。`http.max_content_length` 默认 100MB 是请求体上限，不是推荐的批次大小
- 使用 `_source` 过滤减少网络传输量
- 生产环境限制 `_cat` API 的访问权限

---