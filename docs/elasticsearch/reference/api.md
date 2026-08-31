# Elasticsearch API 速查

## 索引管理

```bash
# 创建索引
PUT /my-index
{
  "settings": { "number_of_shards": 3, "number_of_replicas": 1 },
  "mappings": { "properties": { "title": { "type": "text" } } }
}

# 删除索引
DELETE /my-index

# 查看索引
GET /my-index

# 打开/关闭索引
POST /my-index/_open
POST /my-index/_close

# 重新索引
POST _reindex
{ "source": { "index": "old-index" }, "dest": { "index": "new-index" } }
```

## 文档 CRUD

```bash
# 索引文档（自动生成 ID）
POST /my-index/_doc
{ "title": "Hello", "content": "World" }

# 索引文档（指定 ID）
PUT /my-index/_doc/1
{ "title": "Hello", "content": "World" }

# 获取文档
GET /my-index/_doc/1

# 更新文档（部分更新）
POST /my-index/_update/1
{ "doc": { "title": "Updated" } }

# 删除文档
DELETE /my-index/_doc/1

# 批量操作
POST _bulk
{ "index": { "_index": "my-index", "_id": "1" } }
{ "title": "Doc 1" }
{ "index": { "_index": "my-index", "_id": "2" } }
{ "title": "Doc 2" }
```

## 搜索

```bash
# 基本搜索
GET /my-index/_search
{ "query": { "match": { "title": "hello" } } }

# 布尔查询
GET /my-index/_search
{
  "query": {
    "bool": {
      "must": [{ "match": { "title": "hello" } }],
      "filter": [{ "range": { "date": { "gte": "2026-01-01" } } }],
      "must_not": [{ "term": { "status": "deleted" } }]
    }
  }
}

# 高亮
GET /my-index/_search
{
  "query": { "match": { "title": "hello" } },
  "highlight": { "fields": { "title": {} } }
}

# 分页
GET /my-index/_search
{ "from": 0, "size": 10, "query": { "match_all": {} } }

# 排序
GET /my-index/_search
{ "sort": [{ "date": { "order": "desc" } }] }
```

## 聚合

```bash
# 指标聚合
GET /my-index/_search
{ "aggs": { "avg_price": { "avg": { "field": "price" } } } }

# 桶聚合
GET /my-index/_search
{ "aggs": { "by_category": { "terms": { "field": "category" } } } }
```

## 集群管理

```bash
# 集群健康
GET /_cluster/health

# 节点信息
GET /_cat/nodes?v

# 分片信息
GET /_cat/shards?v

# 索引信息
GET /_cat/indices?v&s=store.size:desc
```
