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

短语查询基于分析后的词项及其位置进行匹配，而非对原始字符串做连续匹配。默认 `slop: 0` 要求所有词项按顺序、紧邻出现：

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

增大 `slop` 允许词项之间有一定的位置偏移，也可能允许词项换序。词项换序同样消耗 `slop`（两个词换序通常需要 `slop: 2`），因此不能把 `slop` 简单理解为「允许插入若干词」：

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

## 3. multi_match 查询

在多个字段上执行相同的查询，字段可以用 `^` 设置权重：

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
| :-- | :-- |
| `best_fields` | 默认，以得分最高的字段为主计算最终得分 |
| `most_fields` | 累加所有匹配字段的得分 |
| `cross_fields` | 将分析器相同的字段按一个逻辑字段处理，按词项跨字段匹配 |
| `phrase` | 在每个字段上执行 match_phrase |

字段权重会影响得分，但最终排名还取决于各字段的匹配情况和得分组合规则。

## 4. 查询与过滤

| 上下文 | 是否计分 | 缓存行为 |
| :-- | :-- | :-- |
| Query | 计算相关性得分 | 不应据此判断是否缓存 |
| Filter | 不计算得分，仅做是/否判断 | 符合条件时可能使用节点查询缓存 |

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

## 5. prefix / wildcard / fuzzy 查询

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

> ⚠️ **注意**：`wildcard` 和 `fuzzy` 的成本与模式、词项数量、字段类型相关。前导通配符（如 `*入门`）、大范围模糊扩展会显著增加查询成本，应谨慎使用。

## 6. 最佳实践

- 全文搜索优先使用 `match`，短语搜索使用 `match_phrase`
- 多字段搜索使用 `multi_match`，用 `^` 设置字段权重
- 搜索自动补全：`edge_ngram` 在索引时生成前缀词项，`completion` suggester 基于专用补全结构，按需选择
- `text` 字段通常使用 `match` 查询；`term` 查询匹配索引词项，不会执行分词分析，不能当作原始字符串的精确匹配
- `filter` 查询可能受益于节点查询缓存，但并非所有过滤条件都会缓存，需结合监控判断

