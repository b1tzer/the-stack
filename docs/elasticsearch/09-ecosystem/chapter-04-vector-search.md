# 向量搜索

## 1. 向量搜索概述

ES 8.x 引入了原生的向量搜索（kNN）支持，可以用于语义搜索、推荐系统、图像检索等场景。

## 2. 密向量（Dense Vector）

```json
PUT /my-index
{
  "mappings": {
    "properties": {
      "title": { "type": "text" },
      "content": { "type": "text" },
      "embedding": {
        "type": "dense_vector",
        "dims": 768,
        "index": true,
        "similarity": "cosine"
      }
    }
  }
}
```

| 参数 | 说明 |
| :-- | :-- |
| `dims` | 向量维度（如 768 维） |
| `index` | 是否建立索引（必须为 true 才能做 kNN 搜索） |
| `similarity` | 相似度算法：`cosine`、`dot_product`、`l2_norm` |

## 3. 索引向量数据

```json
PUT /my-index/_doc/1
{
  "title": "Elasticsearch 入门教程",
  "content": "Elasticsearch 是一个分布式搜索引擎...",
  "embedding": [0.1, 0.2, 0.3, ...]
}
```

## 4. kNN 搜索

```json
GET /my-index/_search
{
  "knn": {
    "field": "embedding",
    "query_vector": [0.1, 0.2, 0.3, ...],
    "k": 10,
    "num_candidates": 100
  }
}
```

| 参数 | 说明 |
| :-- | :-- |
| `query_vector` | 查询向量 |
| `k` | 返回 Top K 个最相似的文档 |
| `num_candidates` | 每个分片搜索的候选数量（越大越精确，越慢） |

## 5. 混合搜索（kNN + 查询）

```json
GET /my-index/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "Elasticsearch" } }
      ],
      "filter": [
        { "term": { "category": "tutorial" } }
      ]
    }
  },
  "knn": {
    "field": "embedding",
    "query_vector": [0.1, 0.2, 0.3, ...],
    "k": 10,
    "num_candidates": 100,
    "boost": 0.5
  }
}
```

## 6. 文本向量化

使用 NLP 模型将文本转换为向量：

```python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('all-MiniLM-L6-v2')
text = "Elasticsearch 入门教程"
embedding = model.encode(text).tolist()
# 返回 384 维向量
```

## 7. 相似度算法

| 算法 | 说明 | 适用场景 |
| :-- | :-- | :-- |
| `cosine` | 余弦相似度 | 文本语义相似度 |
| `dot_product` | 点积 | 归一化向量 |
| `l2_norm` | 欧氏距离 | 图像特征 |

## 8. 语义搜索实战

```json
PUT /semantic-search
{
  "mappings": {
    "properties": {
      "text": { "type": "text" },
      "embedding": {
        "type": "dense_vector",
        "dims": 384,
        "index": true,
        "similarity": "cosine"
      }
    }
  }
}

// 语义搜索
GET /semantic-search/_search
{
  "knn": {
    "field": "embedding",
    "query_vector": [0.1, 0.2, ...],
    "k": 5,
    "num_candidates": 50
  },
  "_source": ["text"]
}
```

## 9. 最佳实践

- 向量维度建议 128~1024，过高影响性能
- `num_candidates` 设置为 `k` 的 10~20 倍
- 使用 `cosine` 相似度处理文本向量
- 混合搜索结合传统查询和向量搜索
- 向量数据量大时考虑使用 HNSW 索引
- 生产环境使用专用的向量数据库或 ES 向量搜索
