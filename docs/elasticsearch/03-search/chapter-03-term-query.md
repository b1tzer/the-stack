# 精确查询

> term/terms 查询不分词，用于精确匹配 keyword、数值、日期等字段。

## 1. term 查询

```json
{ "term": { "status": "online" }}
```

- 不分词，直接用原始值匹配
- 适用于 keyword、integer、date 等类型
- **不适用于 text 类型**（text 字段已被分词，term 匹配不到原始值）

### text vs keyword

| 类型 | 存储方式 | term 匹配 | match 匹配 |
|------|---------|-----------|-----------|
| text | 分词后存储 | ❌（匹配分词后的词项） | ✅ |
| keyword | 原始值存储 | ✅ | ❌（不分词） |

```json
// text 字段 "Hello World" 存储为 ["hello", "world"]
{ "term": { "title": "Hello World" }}  // ❌ 匹配不到
{ "term": { "title": "hello" }}        // ✅ 匹配到

// keyword 字段 "Hello World" 存储为 ["Hello World"]
{ "term": { "status": "Hello World" }} // ✅ 匹配到
```

## 2. terms 查询

```json
{ "terms": { "status": ["online", "active"] }}
```

匹配任一值（OR 逻辑）。

## 3. range 查询

```json
{
  "range": {
    "price": {
      "gte": 10,
      "lte": 50,
      "boost": 2
    }
  }
}
```

| 操作符 | 含义 |
|--------|------|
| gte | >= |
| gt | > |
| lte | <= |
| lt | < |

### 日期范围

```json
{
  "range": {
    "publish_date": {
      "gte": "2026-01-01",
      "lte": "2026-12-31",
      "format": "yyyy-MM-dd"
    }
  }
}
```

## 4. exists 查询

```json
{ "exists": { "field": "email" }}
```

匹配字段存在的文档。

## 5. prefix 查询

```json
{ "prefix": { "name": "张" }}
```

前缀匹配。适用于 keyword 字段。

## 6. wildcard 查询

```json
{ "wildcard": { "name": "张*" }}
```

通配符匹配。`*` 匹配任意字符，`?` 匹配单个字符。

**性能警告**：wildcard 查询无法利用倒排索引，性能很差。避免在大数据量字段上使用。

## 7. regexp 查询

```json
{ "regexp": { "name": "张.+三" }}
```

正则匹配。性能同样很差，谨慎使用。

## 8. 精确查询 vs 全文查询

| 需求 | 查询类型 | 示例 |
|------|---------|------|
| 状态 = "online" | term | `{ "term": { "status": "online" }}` |
| 价格在 10-50 | range | `{ "range": { "price": { "gte": 10 }}}` |
| 包含 "Java 工程师" | match | `{ "match": { "title": "Java 工程师" }}` |
| 精确短语 "Java 工程师" | match_phrase | `{ "match_phrase": { "title": "Java 工程师" }}` |
| 姓 "张" | prefix | `{ "prefix": { "name": "张" }}` |
