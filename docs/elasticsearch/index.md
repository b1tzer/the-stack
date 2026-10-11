# Elasticsearch 知识库

本页负责选择入口。Elasticsearch 的定义、核心能力、技术对比和适用边界见[第一篇概览](./01-basics/chapter-01-overview.md)。

## 从问题进入

| 你现在的问题 | 入口 |
| :-- | :-- |
| 第一次建立搜索数据模型 | [核心概念](./01-basics/chapter-03-core-concepts.md) |
| 字段类型、分词或中文检索不符合预期 | [Mapping](./02-indexing/chapter-02-mapping.md) |
| 查询结果不准确或分页异常 | [Query DSL](./03-search/chapter-01-query-dsl.md) |
| 聚合结果慢或内存占用过高 | [聚合优化](./04-aggregation/chapter-04-agg-optimization.md) |
| 集群恢复缓慢、磁盘压力或升级异常 | [故障排查](./07-operations/chapter-06-troubleshooting.md) |

## 按目录浏览

- **基础与索引**：[概览](./01-basics/chapter-01-overview.md)、[Mapping](./02-indexing/chapter-02-mapping.md)、[分析器](./02-indexing/chapter-03-analysis.md)。
- **搜索与聚合**：[查询 DSL](./03-search/chapter-01-query-dsl.md)、[全文搜索](./03-search/chapter-02-full-text-search.md)、[聚合](./04-aggregation/chapter-01-metrics-agg.md)。
- **分布式与建模**：[分片与副本](./05-distributed-internals/chapter-02-sharding.md)、[写入流程](./05-distributed-internals/chapter-04-write-path.md)、[数据建模](./06-data-modeling/chapter-01-modeling-principles.md)。
- **运维与参考**：[集群管理](./07-operations/chapter-01-cluster-management.md)、[性能优化](./08-performance/chapter-01-index-optimization.md)、[API 速查](./reference/api.md)。

## 内容边界

Spring 接入方式进入[Spring Data Elasticsearch 集成](../spring/04-data-access/chapter-09-elasticsearch-integration.md)，业务搜索方案进入[场景实战](../scenarios/index.md)。
