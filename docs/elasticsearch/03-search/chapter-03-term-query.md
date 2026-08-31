# 精确查询

## 1. term 查询

`term` 查询对字段的精确值进行匹配，不经过分词器。适用于 `keyword`、`numeric`、`date`、`boolean` 等类型。

```json
GET /my-index/_search
{
  "query": {
    "term": {
      "status": "published"
    }
  }
}
```

> ⚠️ **常见错误**：对 `text` 字段使用 `term` 查询。`text` 字段经过分词，`term` 查询的是完整词项，而分词后存储的是拆分后的词项，因此查不到。

```json
// ❌ 错误：title 是 text 类型，分词后存储的是 ["java", "编程"]
{ "query": { "term": { "title": "Java编程" } } }

// ✅ 正确：使用 title.keyword 做精确匹配
{ "query": { "term": { "title.keyword": "Java编程" } } }
```

## 2. terms 查询

匹配多个值中的任意一个：

```json
GET /my-index/_search
{
  "query": {
    "terms": {
      "status": ["published", "active", "online"]
    }
  }
}
```

## 3. range 查询

范围查询适用于数值、日期等类型：

```json
GET /my-index/_search
{
  "query": {
    "range": {
      "price": {
        "gte": 10,
        "lte": 100,
        "boost": 2.0
      }
    }
  }
}

// 日期范围查询
GET /my-index/_search
{
  "query": {
    "range": {
      "created_at": {
        "gte": "2024-01-01",
        "lt": "2024-02-01",
        "format": "yyyy-MM-dd"
      }
    }
  }
}

// 相对时间
GET /my-index/_search
{
  "query": {
    "range": {
      "created_at": {
        "gte": "now-7d/d",
        "lt": "now/d"
      }
    }
  }
}
```

## 4. exists 查询

检查字段是否存在（非 null）：

```json
GET /my-index/_search
{
  "query": {
    "exists": {
      "field": "email"
    }
  }
}
```

## 5. ids 查询

根据文档 ID 查询：

```json
GET /my-index/_search
{
  "query": {
    "ids": {
      "values": ["1", "2", "3"]
    }
  }
}
```

## 6. prefix / wildcard / regex 查询

```json
// 前缀查询
GET /my-index/_search
{
  "query": {
    "prefix": { "title.keyword": "Java" }
  }
}

// 通配符查询（性能较差，慎用）
GET /my-index/_search
{
  "query": {
    "wildcard": { "title.keyword": "Java*" }
  }
}

// 正则查询（性能最差，慎用）
GET /my-index/_search
{
  "query": {
    "regexp": { "title.keyword": "Java.*Script" }
  }
}
```

> ⚠️ **性能警告**：`wildcard` 和 `regexp` 查询需要遍历词项词典，数据量大时性能极差。建议使用 `keyword` 类型字段，并避免前导通配符（如 `*Java`）。

## 7. 最佳实践

- 精确匹配使用 `term` + `keyword` 类型，不要对 `text` 字段使用 `term`
- 范围查询使用 `range`，日期查询用 `now` 相对时间
- `exists` 查询用于过滤缺失字段的文档
- 避免在大字段上使用 `wildcard` 和 `regexp`
- 使用 `filter` context 包装精确查询，利用缓存提升性能
