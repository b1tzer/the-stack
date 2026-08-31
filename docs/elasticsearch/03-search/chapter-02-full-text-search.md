# 全文搜索

> 全文搜索是 ES 的核心能力：把一段文本分词后建立倒排索引，搜索时对查询词也分词，然后匹配。

## 1. 全文搜索的工作流程

```text
写入："Java 高级工程师"
  → 分词器：["java", "高级", "工程师"]
  → 写入倒排索引

搜索："Java 工程师"
  → 分词器：["java", "工程师"]
  → 在倒排索引中查找
  → 匹配包含 "java" 或 "工程师" 的文档
  → 计算相关性得分（BM25）
  → 按得分排序返回
```

## 2. match 查询

```json
{ "match": { "title": "Java 高级工程师" }}
```

默认行为：分词后任一词匹配即命中（OR 逻辑）。

```json
{ "match": { "title": { "query": "Java 高级工程师", "operator": "AND" }}}
```

AND 逻辑：所有词都必须匹配。

### minimum_should_match

```json
{ "match": { "title": { "query": "Java 高级工程师", "minimum_should_match": "75%" }}}
```

至少 75% 的词要匹配（3 个词中至少 2 个）。

## 3. match_phrase 查询

```json
{ "match_phrase": { "title": "Java 工程师" }}
```

要求词连续出现且顺序一致。用于精确短语搜索。

### slop

```json
{ "match_phrase": { "title": { "query": "Java 工程师", "slop": 1 }}}
```

允许词之间有 1 个词的间隔（如 "Java 高级工程师" 也能匹配）。

## 4. multi_match 查询

```json
{ "multi_match": { "query": "Java", "fields": ["title", "content", "skills"] }}
```

在多个字段中搜索。

### best_fields vs most_fields

| 类型 | 说明 | 适用场景 |
|------|------|----------|
| best_fields（默认） | 取得分最高的字段作为文档得分 | 标题或内容匹配 |
| most_fields | 所有字段得分相加 | 多字段综合匹配 |
| cross_fields | 把多个字段当作一个大字段 | 地址、姓名等跨字段搜索 |

## 5. 相关性得分（BM25）

ES 默认使用 BM25 算法计算相关性得分：

- **TF（Term Frequency）**：词在文档中出现的频率越高，得分越高
- **IDF（Inverse Document Frequency）**：词在整个索引中越罕见，得分越高
- **Field Length**：字段越短，得分越高（短文档中出现的词更有意义）

### 自定义评分

```json
{
  "query": {
    "function_score": {
      "query": { "match": { "title": "Java" }},
      "functions": [
        { "field_value_factor": { "field": "popularity", "factor": 1.5 }},
        { "gauss": { "publish_date": { "origin": "now", "scale": "30d" }}}
      ],
      "boost_mode": "multiply"
    }
  }
}
```

## 6. 搜索结果处理

### 高亮

```json
{
  "query": { "match": { "content": "Java" }},
  "highlight": {
    "fields": { "content": { "fragment_size": 200, "number_of_fragments": 3 }},
    "pre_tags": ["<em>"],
    "post_tags": ["</em>"]
  }
}
```

### 排序

```json
{
  "sort": [
    { "publish_date": { "order": "desc" }},
    { "_score": { "order": "desc" }}
  ]
}
```

## 7. 全文搜索的限制

| 限制 | 说明 |
|------|------|
| 不适合精确匹配 | "Java" 会匹配 "JavaScript"（取决于分词器） |
| 分词器依赖 | 中文需要 IK 分词器等插件 |
| 评分不可解释 | BM25 得分难以调试 |
| 深度分页性能差 | from=10000 时性能急剧下降 |
