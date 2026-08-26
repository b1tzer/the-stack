# REST API

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

# 删除索引
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

## 4. 批量操作

```bash
POST /_bulk
{"index": {"_index": "my-index", "_id": "1"}}
{"name": "张三", "age": 25}
{"index": {"_index": "my-index", "_id": "2"}}
{"name": "李四", "age": 30}
```

## 5. Kibana Dev Tools

- 访问 `http://localhost:5601/app/dev_tools`
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
- 批量操作使用 `_bulk` API，每批建议 5~15MB
- 使用 `_source` 过滤减少网络传输量
- 生产环境限制 `_cat` API 的访问权限

---