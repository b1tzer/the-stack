# 精确查询

## 1. term 查询

`term` 查询对字段进行精确匹配，不经过全文分析器（不会像 `match` 那样对输入分词）。适用于 `keyword`、`numeric`、`date`、`boolean` 等类型。注意：`keyword` 字段若配置了 `normalizer`，查询值仍会被规范化后再匹配。

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

> ⚠️ **常见错误**：对 `text` 字段使用 `term` 查询。`text` 字段经过分词，`term` 匹配的是索引中的词项而非原始字符串，输入值通常与分析后产生的词项不一致，因此通常查不到。

```json
// ❌ 错误：title 是 text 类型，经标准分析器分词后可能存储为 ["java", "编程"]
{ "query": { "term": { "title": "Java编程" } } }

// ✅ 正确：使用 title.keyword 做精确匹配
{ "query": { "term": { "title.keyword": "Java编程" } } }
```

> `title.keyword` 是 `text` 字段的多字段（multi-field）子字段，需已在 Mapping 中显式定义，并非所有 `text` 字段都自动具备。字段设计见 [Mapping](../02-indexing/chapter-02-mapping.md)。

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

检查字段是否存在可查询的索引值。注意：空字符串算作存在，显式 `null` 通常不算（字段配置了 `null_value` 时除外）：

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

// 通配符查询（模式匹配，慎用）
GET /my-index/_search
{
  "query": {
    "wildcard": { "title.keyword": "Java*" }
  }
}

// 正则查询（复杂模式匹配，慎用）
GET /my-index/_search
{
  "query": {
    "regexp": { "title.keyword": "Java.*Script" }
  }
}
```

> ⚠️ **性能警告**：`wildcard` 和 `regexp` 查询需要按模式匹配词项，成本与模式的选择性、词项规模、字段类型及执行路径相关，并非必然性能极差。真正需要警惕的是前导通配符（如 `*Java`）和低选择性模式，它们会显著扩大词项枚举范围。高频子串搜索应优先通过字段建模（如 `ngram` 分词）解决，而不是简单依赖 `wildcard` 查询。

## 7. 最佳实践

- 精确匹配使用 `term` + `keyword` 类型，不要对 `text` 字段使用 `term`；匹配多个离散值时用 `terms`，而非多个 `term` 组合
- 范围查询使用 `range`，日期查询用 `now` 相对时间；`range` 适用于数值、日期及 `ip` 等可排序字段，选型看字段类型与查询语义是否适配
- `prefix` / `wildcard` / `regexp` 按匹配需求区分：前缀匹配用 `prefix`，含通配符的简单模式用 `wildcard`，复杂模式才用 `regexp`；成本取决于模式选择性与词项规模，并无固定排序
- `exists` 查询用于过滤缺失字段的文档，注意空字符串算存在、显式 `null` 不算
- 结构化条件过滤用 `filter` context（不计算相关性得分，适合精确匹配）；查询缓存是否命中取决于缓存资格、执行频率等条件，需以实际指标验证

> 相关章节：[查询 DSL](chapter-01-query-dsl.md)、[布尔查询](chapter-04-bool-query.md)、[Mapping 设计](../02-indexing/chapter-02-mapping.md)。
