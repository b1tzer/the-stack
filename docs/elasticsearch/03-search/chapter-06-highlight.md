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
| `fragment_size` | 高亮片段的目标长度（默认 100 个字符，实际边界按词项切分） |
| `number_of_fragments` | 返回的高亮片段数量（默认 5），设为 0 返回完整字段 |
| `no_match_size` | 无匹配时返回的字段长度（默认 0 不返回） |

## 4. 高亮器类型

| 高亮器 | 机制与成本 | 适用场景 |
| :-- | :-- | :-- |
| `unified` | 默认。根据字段配置，使用 postings offsets、term vectors 或重新分析文本来定位词项 | 通用场景 |
| `fvh` (Fast Vector Highlighter) | 依赖 `term_vector: with_positions_offsets`，偏移量另存一份，增大索引体积 | 已预存 term vector 的大字段；否则先评估 `unified` |
| `plain` | 对命中文档的原文重新分析并计算片段，字段过长时受 `index.highlight.max_analyzed_offset` 限制 | 文本量小的简单场景 |

偏移量有两种来源：`index_options: offsets` 让 `unified` 直接读 postings 中的偏移量，不需要 term vector；`term_vector: with_positions_offsets` 把位置和偏移量另存一份，供 `fvh` 使用，代价是索引变大。

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

## 5. 使用 highlight_query 自定义高亮查询

搜索查询与高亮阶段执行的查询可以不同。可用 `highlight_query` 显式指定高亮阶段使用的查询，例如把查询拆成两个 `match` 子句：

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

- 启用 `fvh` 前先确认 `term_vector: with_positions_offsets` 的存储成本，大字段优先评估 `unified` 是否够用
- 使用 `fragment_size` 和 `number_of_fragments` 控制高亮输出量
- 高亮结果包含原文和 `<em>` 等标签，原文可能来自用户输入：把整段结果当 HTML 插入页面有 XSS 风险，整段转义又会让高亮失效。可设置 `encoder: html`，由服务端转义文本内容并保留高亮标签，前端只按受控 HTML 渲染结果
- 高亮展示的是查询词项与文本的匹配位置，不完整反映查询的布尔匹配逻辑：嵌套 `bool`、`minimum_should_match` 等场景下，被高亮的词项不一定代表文档满足了相应条件，需要自定义时用 `highlight_query`（见第 5 节）
- `number_of_fragments: 0` 返回完整字段高亮，适合标题等短字段
