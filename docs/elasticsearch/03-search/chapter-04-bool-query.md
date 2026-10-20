# 布尔查询

## 1. bool 查询

```json
GET /my-index/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "Elasticsearch" } }
      ],
      "should": [
        { "match": { "content": "入门" } },
        { "match": { "content": "教程" } }
      ],
      "must_not": [
        { "term": { "status": "draft" } }
      ],
      "filter": [
        { "range": { "price": { "gte": 100, "lte": 500 } } }
      ]
    }
  }
}
```

## 2. 子句说明

| 子句 | 说明 | 影响得分 |
| :-- | :-- | :-- |
| must | 必须匹配 | ✅ |
| should | 应该匹配 | ✅ |
| must_not | 必须不匹配 | ❌ |
| filter | 必须匹配 | ❌ |

`must` 和 `filter` 都限定结果集，区别是 `must` 参与评分、`filter` 不参与，`must_not` 只过滤不计分。不关心相关性得分的硬性条件（价格、状态等）优先放 `filter`。

多个参与评分的子句得分会累加，因此调整查询结构既可能改变匹配范围，也可能改变排序。影响排序的偏好条件放 `must` 或 `should`；`should` 是否为必选用 `minimum_should_match` 显式控制，不要依赖默认值（见 §3）。

## 3. should 的 minimum_should_match

当 `bool` 查询中只有 `should` 子句时，至少需要匹配一个。当同时存在 `must` 或 `filter` 时，`should` 变为可选（加分项）。

```json
GET /my-index/_search
{
  "query": {
    "bool": {
      "should": [
        { "match": { "title": "Elasticsearch" } },
        { "match": { "title": "搜索引擎" } },
        { "match": { "title": "分布式" } }
      ],
      "minimum_should_match": 2
    }
  }
}
```

`minimum_should_match` 支持百分比：按子句总数计算并**向下取整**。例如 3 个 should 子句用 `"75%"`，实际至少匹配 2 个（2/3，约 66.7%），不是 75%。负百分比表示允许不匹配的比例，计算规则不同：`"-25%"` 先把 25% 向下取整，再用总数减去它；同样是 5 个子句，`"75%"` 要求匹配 3 个，而 `"-25%"` 要求 4 个。需要精确控制数量时直接写整数。

## 4. 嵌套 bool 查询

```json
GET /my-index/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "Java" } }
      ],
      "should": [
        {
          "bool": {
            "must": [
              { "match": { "content": "Spring" } },
              { "range": { "price": { "lte": 100 } } }
            ]
          }
        },
        {
          "bool": {
            "must": [
              { "match": { "content": "微服务" } },
              { "term": { "status": "published" } }
            ]
          }
        }
      ],
      "minimum_should_match": 1
    }
  }
}
```

父级 `bool` 同时含 `must` 和 `should` 时，`minimum_should_match` 默认为 0：两个分支都不匹配，只要标题命中 Java 也仍会返回，`should` 只影响得分不扩结果集。加上 `"minimum_should_match": 1` 才要求至少命中一个分支（默认值规则见 §3）。

## 5. constant_score 查询

当过滤条件命中的文档需要获得统一得分、不按相关性区分高低时，用 `constant_score` 包装；只是想不计分地过滤，`bool.filter` 已经足够。示例：

```json
GET /my-index/_search
{
  "query": {
    "constant_score": {
      "filter": {
        "term": { "status": "published" }
      },
      "boost": 1.2
    }
  }
}
```

## 6. 最佳实践

- `filter` 不计分，符合条件的过滤结果可能被节点查询缓存——使用 `filter` 不等于必然命中缓存
- `should` 配合 `minimum_should_match` 显式控制匹配精度，注意百分比向下取整
- 需要统一得分、不关心得分高低时用 `constant_score` 包装（`filter` 本身已不计分，速度不是选用它的理由）
- 保持查询结构扁平；性能问题用 Profile 结合实际查询结构和数据规模定位，不按嵌套层数预判
- `explain` 用于诊断指定文档为何匹配及得分构成；查询耗时与子句执行情况用 Profile 分析

