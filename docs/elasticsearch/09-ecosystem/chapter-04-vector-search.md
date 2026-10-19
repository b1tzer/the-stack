# 向量搜索

## 1. 向量搜索概述

ES 8.x 引入了原生的向量搜索（kNN）支持，可以用于语义搜索、推荐系统、图像检索等场景。

kNN 检索默认走近似最近邻（ANN）路径：查询向量进入各分片，各分片借助向量索引（默认 HNSW）召回候选，协调节点汇总各分片候选后返回全局 Top K。`num_candidates` 控制每个分片考虑的近邻候选数量，增大该值通常有助于提高召回率，但会增加搜索开销，应使用目标数据集与查询集评估。若未建立向量索引，可通过 `script_score` 做精确向量评分，但需扫描候选文档、成本更高。

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
        "dims": 384,
        "index": true,
        "similarity": "cosine"
      }
    }
  }
}
```

| 参数 | 说明 |
| :-- | :-- |
| `dims` | 向量维度（如 384 维） |
| `index` | 是否建立索引（必须为 true 才能做 kNN 搜索） |
| `similarity` | 相似度算法：`cosine`、`dot_product`、`l2_norm` |

下文示例中的向量数组均为结构示意，仅展示部分元素，不代表完整向量，不能直接用于请求。实际使用时须填入与 `dims` 一致的完整向量；查询向量维度与映射 `dims` 不一致会导致请求失败，索引向量与查询向量还应由兼容的嵌入模型生成。

## 3. 索引向量数据

```json
PUT /my-index/_doc/1
{
  "title": "Elasticsearch 入门教程",
  "content": "Elasticsearch 是一个分布式搜索引擎...",
  "embedding": [0.012, -0.034, 0.056]
}
```

## 4. kNN 搜索

```json
GET /my-index/_search
{
  "knn": {
    "field": "embedding",
    "query_vector": [0.012, -0.034, 0.056],
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
    "query_vector": [0.012, -0.034, 0.056],
    "k": 10,
    "num_candidates": 100,
    "boost": 0.5
  }
}
```

同一请求中同时给出顶层 `query` 与顶层 `knn` 时，两者各自独立召回，匹配结果会合并，文档的最终 `_score` 由词法查询得分与 kNN 得分按各自权重合成，此例中的 `knn.boost` 用于缩放 kNN 分数。`boost` 只调整 kNN 分数在总分中的权重，不是归一化，也不做重新排序。顶层 `query` 里的 `filter` 只约束词法检索，不会作用于 kNN 检索；若要让同一条件约束向量检索候选，需将其放入 `knn.filter`，该过滤器用于向量检索的预过滤。更复杂的多路融合可选用 RRF（8.8 起可用），此处从略。

## 6. 文本向量化

使用多语言 NLP 模型将文本转换为向量：

```python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
text = "Elasticsearch 入门教程"
embedding = model.encode(text).tolist()
# 返回 384 维向量，支持中文等多语言
```

写入向量与查询向量必须由同一个嵌入模型生成，维度与预处理方式需保持一致。模型升级会改变向量空间，即使新旧模型输出维度相同也不能直接混用；升级时应记录模型标识与版本。模型版本变更后的默认做法是用新模型重新生成全量向量、建立新索引，验证检索效果后切换别名；只有明确验证过向量空间兼容性，才考虑其他迁移方式。

## 7. 相似度算法

| 算法 | 说明 | 适用场景 |
| :-- | :-- | :-- |
| `cosine` | 余弦相似度 | 文本语义相似度 |
| `dot_product` | 点积 | 对浮点向量要求单位长度向量 |
| `l2_norm` | 欧氏距离 | 图像特征 |

相似度函数应与模型训练目标及向量是否归一化匹配，而非按场景机械套用。

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
```

建立索引后执行语义搜索：

```json
GET /semantic-search/_search
{
  "knn": {
    "field": "embedding",
    "query_vector": [0.012, -0.034, 0.056],
    "k": 5,
    "num_candidates": 50
  },
  "_source": ["text"]
}
```

## 9. 最佳实践

- 向量维度与嵌入模型的输出保持一致，不要脱离模型单独调维度
- `num_candidates` 从适中规模起步，用固定数据集与查询集逐步调优，记录 Recall@K 与 P95/P99 延迟后取舍
- 相似度函数与模型训练目标及向量是否归一化匹配，文本向量常用 `cosine`
- 混合搜索同时给出 `query` 与 `knn` 时，明确 `boost` 与过滤条件的作用边界
- 使用近似 kNN 搜索时启用向量索引（`index: true`，映射中已默认启用）；通过 `num_candidates` 等参数评估召回率、延迟与资源开销，使用精确评分时则结合候选集大小评估扫描成本
- 已用 Elasticsearch 承载全文检索、过滤和聚合，且向量检索能满足延迟与召回目标时，可优先在现有集群内实现；若向量检索的资源隔离、规模或性能要求与现有负载冲突，再比较独立向量检索方案
