# 全文搜索

## 1. match 查询

```json
GET /my-index/_search
{
  "query": {
    "match": {
      "title": "Elasticsearch 入门"
    }
  }
}
```

## 2. match_phrase 查询

```json
GET /my-index/_search
{
  "query": {
    "match_phrase": {
      "title": "Elasticsearch 入门"
    }
  }
}
```

## 3. multi_match 查询

```json
GET /my-index/_search
{
  "query": {
    "multi_match": {
      "query": "Elasticsearch",
      "fields": ["title", "content", "description"]
    }
  }
}
```

## 4. 查询与过滤

| 上下文 | 说明 | 缓存 |
|--------|------|------|
| Query | 计算相关性得分 | 不缓存 |
| Filter | 是/否判断 | 缓存 |

```json
GET /my-index/_search
{
  "query": {
    "bool": {
      "must": [{ "match": { "title": "Elasticsearch" } }],
      "filter": [{ "range": { "price": { "gte": 100 } } }]
    }
  }
}
```
## 5. match_phrase 查询

短语查询要求所有词项按顺序出现在文档中：

```json
GET /my-index/_search
{
  "query": {
    "match_phrase": {
      "title": {
        "query": "分布式 搜索引擎",
        "slop": 1
      }
    }
  }
}
```

`slop` 参数允许词项之间有间隔，值越大越宽松。

## 6. multi_match 查询

在多个字段上执行相同的查询：

```json
GET /my-index/_search
{
  "query": {
    "multi_match": {
      "query": "Elasticsearch 入门",
      "fields": ["title^3", "content", "description"],
      "type": "best_fields",
      "tie_breaker": 0.3
    }
  }
}
```

| type | 说明 |
|------|------|
| `best_fields` | 默认，取得分最高的字段 |
| `most_fields` | 合并所有匹配字段的得分 |
| `cross_fields` | 将多个字段视为一个大字段 |
| `phrase` | 在每个字段上执行 match_phrase |

## 7. prefix / wildcard / fuzzy 查询

```json
GET /my-index/_search
{
  "query": {
    "bool": {
      "should": [
        { "prefix": { "title": "Java" } },
        { "wildcard": { "title": "*入门*" } },
        { "fuzzy": { "title": { "value": "Elastcsearch", "fuzziness": "AUTO" } } }
      ]
    }
  }
}
```

> ⚠️ **注意**：`wildcard` 和 `fuzzy` 查询性能较差，避免在大字段上使用。

## 8. 最佳实践

- 全文搜索优先使用 `match`，短语搜索使用 `match_phrase`
- 多字段搜索使用 `multi_match`，用 `^` 设置字段权重
- 搜索自动补全使用 `edge_ngram` + `completion` suggester
- 避免在 `text` 字段上使用 `term` 查询（已被分词，无法精确匹配）
- 高频搜索场景启用查询缓存（`filter` context 自动缓存）

