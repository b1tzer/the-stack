# 文档 CRUD

> ES 中的一切数据都是文档（Document）。理解文档的增删改查是使用 ES 的基础。

## 1. 索引文档（创建/更新）

```json
// 指定 ID
PUT /my-index/_doc/1
{
  "title": "Java 入门",
  "price": 59.9,
  "tags": ["java", "programming"]
}

// 自动生成 ID
POST /my-index/_doc
{
  "title": "Java 入门",
  "price": 59.9
}
```

## 2. 获取文档

```json
GET /my-index/_doc/1

// 只返回指定字段
GET /my-index/_doc/1?_source=title,price
```

## 3. 更新文档

```json
// 部分更新
POST /my-index/_update/1
{
  "doc": {
    "price": 49.9
  }
}

// 脚本更新
POST /my-index/_update/1
{
  "script": {
    "source": "ctx._source.price += params.amount",
    "params": { "amount": 10 }
  }
}
```

## 4. 删除文档

```json
DELETE /my-index/_doc/1
```

## 5. 批量操作

```json
POST _bulk
{ "index": { "_index": "my-index", "_id": "1" }}
{ "title": "Doc 1", "price": 10 }
{ "index": { "_index": "my-index", "_id": "2" }}
{ "title": "Doc 2", "price": 20 }
{ "update": { "_index": "my-index", "_id": "1" }}
{ "doc": { "price": 15 }}
{ "delete": { "_index": "my-index", "_id": "2" }}
```

批量操作比逐条操作快很多（减少网络往返）。

## 6. 文档的不可变性

ES 中的"更新"实际上是：读取旧文档 → 修改 → 写入新文档 → 删除旧文档。

这就是为什么部分更新比全量更新快（不需要重新索引所有字段）。

## 7. 版本控制

```json
GET /my-index/_doc/1
// 返回 _version: 1

PUT /my-index/_doc/1?version=1
// 只有 _version=1 时才更新，否则报版本冲突
```

ES 使用乐观并发控制（Optimistic Concurrency Control）。
