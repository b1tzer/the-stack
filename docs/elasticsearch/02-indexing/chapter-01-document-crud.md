# 文档 CRUD

## 1. 索引文档

```bash
# 指定 ID
POST /my-index/_doc/1
{
  "name": "张三",
  "age": 25,
  "email": "zhangsan@example.com"
}

# 自动生成 ID
POST /my-index/_doc
{
  "name": "李四",
  "age": 30
}
```

## 2. 获取文档

```bash
GET /my-index/_doc/1

# 获取特定字段
GET /my-index/_doc/1?_source=name,age
```

## 3. 更新文档

```bash
# 部分更新
POST /my-index/_update/1
{
  "doc": { "age": 26 }
}

# 脚本更新
POST /my-index/_update/1
{
  "script": {
    "source": "ctx._source.age += params.age",
    "params": { "age": 1 }
  }
}
```

## 4. Bulk API

```bash
POST /_bulk
{"index": {"_index": "my-index", "_id": "1"}}
{"name": "张三", "age": 25}
{"update": {"_index": "my-index", "_id": "1"}}
{"doc": {"age": 26}}
{"delete": {"_index": "my-index", "_id": "2"}}
```

## 5. 条件更新与乐观锁

```bash
# 使用 if_seq_no + if_primary_term 做乐观锁
POST /my-index/_update/1?if_seq_no=5&if_primary_term=1
{
  "doc": { "age": 27 }
}

# 使用 retry_on_conflict 处理冲突
POST /my-index/_update/1?retry_on_conflict=3
{
  "doc": { "views": 100 }
}
```

## 6. Upsert（存在则更新，不存在则插入）

```bash
POST /my-index/_update/999
{
  "doc": { "name": "新用户", "age": 18 },
  "doc_as_upsert": true
}
```

## 7. 最佳实践

- Bulk API 每批大小建议 5~15MB，不要超过 100MB
- 使用 `_source` 过滤只返回需要的字段
- 频繁更新场景使用 `doc_as_upsert` 避免先查后改
- 删除操作建议使用逻辑删除（`is_deleted` 字段）而非物理删除
- 自动生成 ID 适合日志类数据，业务数据建议指定 ID

---