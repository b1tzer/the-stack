# 高亮显示

## 1. 基本高亮

```json
GET /my-index/_search
{
  "query": {
    "match": { "title": "Elasticsearch 入门" }
  },
  "highlight": {
    "fields": {
      "title": {}
    }
  }
}
```

返回结果中，匹配的词项会被 `<em>` 标签包裹：

```json
{
  "hits": {
    "hits": [
      {
        "_source": { "title": "Elasticsearch 入门教程" },
        "highlight": {
          "title": ["<em>Elasticsearch</em> <em>入门</em>教程"]
        }
      }
    ]
  }
}
```

## 2. 自定义高亮标签

```json
GET /my-index/_search
{
  "query": {
    "match": { "title": "Elasticsearch" }
  },
  "highlight": {
    "fields": {
      "title": {
        "pre_tags": ["<span class='highlight'>"],
        "post_tags": ["</span>"]
      }
    }
  }
}
```

## 3. 多字段高亮

```json
GET /my-index/_search
{
  "query": {
    "multi_match": {
      "query": "分布式",
      "fields": ["title", "content"]
    }
  },
  "highlight": {
    "fields": {
      "title": { "number_of_fragments": 0 },
      "content": {
        "fragment_size": 200,
        "number_of_fragments": 3
      }
    }
  }
}
```

| 参数 | 说明 |
| :-- | :-- |
| `fragment_size` | 每个高亮片段的最大字符数（默认 100） |
| `number_of_fragments` | 返回的高亮片段数量（默认 5），设为 0 返回完整字段 |
| `no_match_size` | 无匹配时返回的字段长度（默认 0 不返回） |

## 4. 高亮器类型

| 高亮器 | 说明 | 适用场景 |
| :-- | :-- | :-- |
| `unified` | 默认，基于 BM25 的高亮 | 通用场景 |
| `fvh` (Fast Vector Highlighter) | 需要 `term_vector: with_positions_offsets` | 大字段高亮，性能好 |
| `plain` | 基于 Lucene 的标准高亮 | 简单场景 |

```json
// 使用 FVH 高亮器（需要预存 term_vector）
PUT /my-index
{
  "mappings": {
    "properties": {
      "content": {
        "type": "text",
        "term_vector": "with_positions_offsets"
      }
    }
  }
}

GET /my-index/_search
{
  "query": { "match": { "content": "分布式" } },
  "highlight": {
    "fields": {
      "content": { "type": "fvh" }
    }
  }
}
```

## 5. 高亮与自定义分析器

```json
GET /my-index/_search
{
  "query": {
    "match": { "title": "Java编程" }
  },
  "highlight": {
    "fields": {
      "title": {
        "highlight_query": {
          "bool": {
            "should": [
              { "match": { "title": "Java" } },
              { "match": { "title": "编程" } }
            ]
          }
        }
      }
    }
  }
}
```

## 6. 最佳实践

- 大字段使用 `fvh` 高亮器，需要预存 `term_vector`
- 使用 `fragment_size` 和 `number_of_fragments` 控制高亮输出量
- 前端渲染时注意 XSS 风险，对高亮内容做转义
- `number_of_fragments: 0` 返回完整字段高亮，适合标题等短字段
- 高亮查询可以使用 `highlight_query` 自定义高亮的查询逻辑
