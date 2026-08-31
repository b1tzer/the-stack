# 布尔查询

> bool 查询是 ES 中最常用的组合查询方式，通过 must/should/filter/must_not 组合多个条件。

## 1. bool 查询结构

```json
{
  "query": {
    "bool": {
      "must": [],
      "should": [],
      "filter": [],
      "must_not": []
    }
  }
}
```

## 2. 各子句的行为

| 子句 | 作用 | 计分 | 缓存 | 最少匹配 |
|------|------|------|------|----------|
| must | 必须匹配 | ✅ | ❌ | 全部 |
| should | 应该匹配 | ✅ | ❌ | 看上下文 |
| filter | 必须匹配 | ❌ | ✅ | 全部 |
| must_not | 必须不匹配 | ❌ | ✅ | 全部 |

## 3. should 的行为规则

```text
有 must 存在：
  should = 可选加分项（匹配加分，不匹配不影响）
  minimum_should_match = 0

没有 must：
  should = 至少匹配一个
  minimum_should_match = 1（默认）
```

```json
// 有 must 时，should 可选
{
  "bool": {
    "must": [{ "term": { "status": "online" }}],
    "should": [
      { "match": { "title": "Java" }},
      { "match": { "content": "Spring" }}
    ]
  }
}

// 没有 must 时，should 至少匹配一个
{
  "bool": {
    "should": [
      { "term": { "category": "tech" }},
      { "term": { "category": "science" }}
    ],
    "minimum_should_match": 1
  }
}
```

## 4. 嵌套 bool 查询

```json
{
  "bool": {
    "must": [
      { "match": { "title": "Java" }},
      {
        "bool": {
          "should": [
            { "term": { "level": "senior" }},
            { "range": { "experience": { "gte": 5 }}}
          ]
        }
      }
    ],
    "filter": [
      { "range": { "salary": { "gte": 20000 }}}
    ]
  }
}
```

## 5. 最佳实践

1. **过滤条件放 filter**：状态、日期范围、分类等不需要计分的条件
2. **搜索条件放 must**：全文检索、需要相关性排序的条件
3. **可选条件放 should**：加分项，匹配则排名更靠前
4. **排除条件放 must_not**：黑名单、已删除等
5. **避免过深嵌套**：bool 嵌套超过 3 层会影响性能
