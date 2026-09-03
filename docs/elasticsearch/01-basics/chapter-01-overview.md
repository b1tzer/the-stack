# Elasticsearch 概览

## 1. 什么是 Elasticsearch

Elasticsearch 是基于 Lucene 的分布式搜索和分析引擎，由 Elastic 公司维护。

## 2. 核心能力

| 能力 | 说明 |
| :-- | :-- |
| 全文搜索 | 倒排索引，毫秒级响应 |
| 结构化查询 | SQL 类似查询 |
| 聚合分析 | 多维数据分析 |
| 近实时 | 数据写入后 1s 可搜索 |

## 3. 与 Solr/ClickHouse 对比

| 特性 | Elasticsearch | Solr | ClickHouse |
| :-- | :-- | :-- | :-- |
| 架构 | 分布式 | 主从 | 分布式列存 |
| 全文搜索 | ✅ 极强 | ✅ 强 | ❌ 弱 |
| 聚合分析 | ✅ 强 | ✅ 中 | ✅ 极强 |
| 实时性 | 近实时 | 近实时 | 准实时 |
| 适用场景 | 搜索/日志/分析 | 传统搜索 | OLAP分析 |

## 4. 应用场景

- 全文搜索（电商/内容）
- 日志分析（ELK）
- 应用性能监控（APM）
- 安全分析（SIEM）
- 地理位置搜索

## 5. Elastic Stack

```
Beats → Logstash → Elasticsearch → Kibana
  ↑        ↑            ↑            ↑
  采集     处理         存储/搜索    可视化
```

## 6. 版本演进

| 版本 | 重要特性 |
| :-- | :-- |
| 1.x | 初始版本，基础搜索功能 |
| 2.x | 引入 Pipeline Aggregation |
| 5.x | 统一版本号，引入 Ingest Node |
| 6.x | 引入 Sequence ID，跨集群复制 |
| 7.x | 引入 Frozen Index、Searchable Snapshots |
| 8.x | 默认启用安全特性、向量搜索（kNN）、Type 类型移除 |

## 7. 核心术语速查

| 术语 | 含义 |
| :-- | :-- |
| **Cluster** | 由一个或多个节点组成的 ES 集群 |
| **Node** | 集群中的单个服务器实例 |
| **Index** | 文档的逻辑集合，类似数据库中的表 |
| **Document** | 索引中的单条数据，JSON 格式 |
| **Shard** | 索引的物理分片，支持水平扩展 |
| **Replica** | 分片的副本，提供高可用 |
| **Segment** | Lucene 中的不可变数据段，倒排索引的载体 |
| **Mapping** | 定义文档字段类型和索引方式的 Schema |
| **DSL** | Domain Specific Language，ES 的查询语言 |

## 8. ES 的局限性

| 局限 | 说明 | 替代方案 |
| :-- | :-- | :-- |
| **不支持事务** | 无法像 MySQL 那样保证 ACID | MySQL 做主存储，ES 做搜索 |
| **不擅长关联查询** | Join 性能差，不支持复杂关联 | 反规范化建模或应用层关联 |
| **内存消耗大** | JVM 堆内存 + 文件系统缓存 | 合理规划硬件资源 |
| **近实时而非实时** | 写入后约 1s 可搜索 | 业务上可接受 1s 延迟 |
| **深度分页性能差** | from 越大，性能越差 | 使用 search_after |

## 9. 最佳实践

- **生产环境务必手动定义 Mapping**，不要依赖动态 Mapping
- **主分片数规划要提前**，创建后不可修改
- **单个分片大小建议 10~50GB**，过大影响查询和恢复速度
- **使用别名（Alias）指向索引**，便于零停机切换
- **批量写入使用 Bulk API**，比单条写入快 5~10 倍
- **全文搜索用 text + match，精确匹配用 keyword + term**