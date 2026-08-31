# Query DSL

> Query DSL 是 Elasticsearch 的查询语言。理解 query context 和 filter context 的区别，是写出高效查询的第一步。

## 1. query context vs filter context

```text
┌─────────────────────────────────────────────────────┐
│                    bool 查询                         │
│                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │   must      │  │  should     │  │   filter    │ │
│  │ (必须匹配)   │  │ (应该匹配)   │  │ (过滤)      │ │
│  │ 计算_score   │  │ 计算_score   │  │ 不计算_score │ │
│  │ 不缓存      │  │ 不缓存      │  │ 可缓存      │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
│                                                     │
│  query context: must / should → 计算相关性得分       │
│  filter context: filter / must_not → 不计分，可缓存  │
└─────────────────────────────────────────────────────┘
```

**核心区别**：

| 维度 | query context | filter context |
|------|--------------|----------------|
| 计算得分 | ✅ | ❌ |
| 结果缓存 | ❌ | ✅（Filter Cache） |
| 性能 | 较慢 | 较快 |
| 适用场景 | 全文搜索、需要相关性排序 | 精确过滤、范围查询 |

## 2. 为什么 filter 比 must 性能更好

1. filter 不计算相关性得分（TF-IDF/BM25），省去计算开销
2. filter 结果可被 Filter Cache 缓存，相同条件第二次查询直接走缓存
3. filter 可以跳过评分阶段，直接从倒排索引中取文档 ID

**最佳实践**：全文检索用 `must`（query context），条件过滤用 `filter`（filter context）。

## 3. bool 查询

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "Java工程师" }}
      ],
      "should": [
        { "match": { "skills": "Spring" }},
        { "match": { "skills": "微服务" }}
      ],
      "filter": [
        { "range": { "salary": { "gte": 15000, "lte": 30000 }}},
        { "term": { "status": "online" }}
      ],
      "must_not": [
        { "term": { "is_blacklist": true }}
      ]
    }
  }
}
```

| 子句 | 作用 | 是否计分 | 是否缓存 |
|------|------|---------|---------|
| must | 必须匹配 | ✅ | ❌ |
| should | 应该匹配（可选） | ✅ | ❌ |
| filter | 必须匹配（过滤） | ❌ | ✅ |
| must_not | 必须不匹配 | ❌ | ✅ |

### should 的行为

- 当 `must` 存在时，`should` 变成可选加分项（匹配则加分，不匹配不影响）
- 当没有 `must` 时，`should` 至少要匹配一个（`minimum_should_match` 默认为 1）

## 4. 常用查询类型

### 4.1 match（全文检索）

```json
{ "match": { "title": "Java 高级工程师" }}
// 分词后：Java | 高级 | 工程师
// 匹配包含任一词的文档
```

### 4.2 match_phrase（短语匹配）

```json
{ "match_phrase": { "title": "Java 工程师" }}
// 要求 "Java" 和 "工程师" 连续出现，顺序一致
```

### 4.3 term（精确匹配）

```json
{ "term": { "status": "online" }}
// 不分词，精确匹配
// 适用于 keyword 类型字段
```

### 4.4 range（范围查询）

```json
{ "range": { "price": { "gte": 10, "lte": 50, "boost": 2 }}}
```

### 4.5 exists（字段存在）

```json
{ "exists": { "field": "email" }}
```

## 5. 查询优化技巧

1. **能用 filter 就不用 must**：filter 可缓存，性能更好
2. **term 查询用 keyword 字段**：text 字段会被分词，term 匹配不到
3. **避免 wildcard 查询**：`*abc` 无法利用倒排索引，性能极差
4. **使用 track_total_hits: false**：如果不需要精确总数，关闭计数提升性能
5. **分页用 search_after**：深度分页（from=10000）性能差，用 search_after 替代
