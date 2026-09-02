# 电商搜索引擎

## 1. 需求分析

电商搜索引擎需要支持：
- 全文搜索（商品名称、描述）
- 多条件筛选（分类、品牌、价格区间、属性）
- 搜索结果排序（相关性、销量、价格、上架时间）
- 搜索建议（自动补全）
- 搜索结果高亮

## 2. 索引设计

```json
PUT /products
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "analysis": {
      "analyzer": {
        "product_analyzer": {
          "type": "custom",
          "tokenizer": "ik_max_word",
          "filter": ["lowercase", "product_synonyms"]
        },
        "autocomplete_analyzer": {
          "type": "custom",
          "tokenizer": "ik_max_word",
          "filter": ["lowercase", "edge_ngram_filter"]
        }
      },
      "filter": {
        "product_synonyms": {
          "type": "synonym",
          "synonyms": [
            "手机, 手机设备, mobile",
            "笔记本, 笔记本电脑, laptop"
          ]
        },
        "edge_ngram_filter": {
          "type": "edge_ngram",
          "min_gram": 1,
          "max_gram": 20
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "product_id": { "type": "keyword" },
      "name": {
        "type": "text",
        "analyzer": "product_analyzer",
        "search_analyzer": "ik_smart",
        "fields": {
          "keyword": { "type": "keyword" },
          "autocomplete": {
            "type": "text",
            "analyzer": "autocomplete_analyzer",
            "search_analyzer": "ik_smart"
          }
        }
      },
      "description": {
        "type": "text",
        "analyzer": "product_analyzer"
      },
      "category": { "type": "keyword" },
      "brand": { "type": "keyword" },
      "price": { "type": "scaled_float", "scaling_factor": 100 },
      "sales_count": { "type": "integer" },
      "stock": { "type": "integer" },
      "status": { "type": "keyword" },
      "created_at": { "type": "date" },
      "tags": { "type": "keyword" },
      "attributes": {
        "type": "nested",
        "properties": {
          "name": { "type": "keyword" },
          "value": { "type": "keyword" }
        }
      }
    }
  }
}
```

## 3. 搜索接口实现

```json
// 商品搜索
GET /products/_search
{
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "iPhone 手机",
            "fields": ["name^3", "description", "tags"],
            "type": "best_fields",
            "tie_breaker": 0.3
          }
        }
      ],
      "filter": [
        { "term": { "status": "online" } },
        { "term": { "category": "手机" } },
        { "range": { "price": { "gte": 3000, "lte": 10000 } } },
        { "range": { "stock": { "gt": 0 } } }
      ]
    }
  },
  "sort": [
    { "_score": "desc" },
    { "sales_count": "desc" }
  ],
  "from": 0,
  "size": 20,
  "highlight": {
    "fields": {
      "name": { "pre_tags": ["<em>"], "post_tags": ["</em>"] }
    }
  }
}
```

## 4. 搜索建议（自动补全）

```json
GET /products/_search
{
  "size": 0,
  "suggest": {
    "name_suggest": {
      "prefix": "iPh",
      "completion": {
        "field": "name.autocomplete",
        "size": 10,
        "skip_duplicates": true
      }
    }
  }
}
```

## 5. 聚合分析

```json
// 搜索结果聚合（筛选条件）
GET /products/_search
{
  "size": 0,
  "query": {
    "bool": {
      "must": [{ "match": { "name": "手机" } }],
      "filter": [{ "term": { "status": "online" } }]
    }
  },
  "aggs": {
    "brands": {
      "terms": { "field": "brand", "size": 20 }
    },
    "price_ranges": {
      "range": {
        "field": "price",
        "ranges": [
          { "to": 1000, "key": "千元以下" },
          { "from": 1000, "to": 3000, "key": "1000-3000" },
          { "from": 3000, "to": 5000, "key": "3000-5000" },
          { "from": 5000, "key": "5000以上" }
        ]
      }
    },
    "categories": {
      "terms": { "field": "category", "size": 10 }
    }
  }
}
```

## 6. 排序策略

| 排序方式 | 实现 |
|---------|------|
| 相关性 | `_score`（默认） |
| 销量降序 | `sales_count: desc` |
| 价格升序 | `price: asc` |
| 价格降序 | `price: desc` |
| 上架时间 | `created_at: desc` |
| 综合排序 | `_score * 0.7 + sales_count * 0.3`（function_score） |

## 7. 最佳实践

- 使用 `ik_max_word` 索引 + `ik_smart` 搜索
- 商品名称权重高于描述（`name^3`）
- 使用 `filter` context 处理筛选条件
- 自动补全使用 `edge_ngram` 或 `completion` suggester
- 搜索结果缓存（filter context 自动缓存）
- 监控搜索延迟和点击率
- 使用 A/B 测试优化排序策略
