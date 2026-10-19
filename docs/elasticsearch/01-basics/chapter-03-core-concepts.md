# 核心概念

## 1. 文档 (Document)

- ES 中最小数据单元
- JSON 格式
- 有唯一 _id

## 2. 索引 (Index)

- 文档的集合
- 类似数据库中的表
- 有映射（Mapping）定义字段类型

## 3. 分片 (Shard)

- 索引的物理分片
- 主分片（Primary）：写入
- 副本分片（Replica）：冗余备份

详见 [集群架构与分片机制](../05-distributed-internals/chapter-02-sharding.md)。

## 4. 节点 (Node)

一个节点可以同时承担多个角色，协调（Coordinating）是每个节点默认具备的能力，只有 `node.roles: []` 才是专用协调节点。

| 角色 | 说明 |
| :-- | :-- |
| Master-eligible | 具备主节点选举资格，集群中当前当选的称为 elected master，负责集群管理 |
| Data | 数据存储 |
| Coordinating | 请求协调（默认能力，非互斥角色） |
| Ingest | 数据预处理 |

## 5. 集群 (Cluster)

```txt
┌─────────────────────────────────┐
│        Cluster                  │
│  ┌─────────┐  ┌─────────┐     │
│  │ Node 1  │  │ Node 2  │     │
│  │ (Master)│  │ (Data)  │     │
│  │         │  │         │     │
│  │ Shard 0 │  │ Shard 1 │     │
│  │ Replica1│  │ Replica0│     │
│  └─────────┘  └─────────┘     │
└─────────────────────────────────┘
```

## 6. 与关系型数据库对比

| ES | RDBMS |
| :-- | :-- |
| Index | Table |
| Document | Row |
| Field | Column |
| Mapping | Schema |

## 7. 近实时（Near Real-Time）

ES 不是实时搜索引擎。文档写入后，需要经过 refresh（默认 1 秒）才能被搜索到。

| 概念 | 说明 |
| :-- | :-- |
| **Buffer** | 文档写入后首先进入内存缓冲区 |
| **Refresh** | 将 Buffer 中的操作生成新的 Lucene Segment 并打开新搜索视图，使其可搜索（默认 1s）；不执行 fsync，不等于持久化到磁盘 |
| **Flush** | 执行 Lucene commit 将 Segment 落盘，启动新的 Translog 代际，旧代际在不再需要时才删除 |
| **Translog** | 事务日志，记录 commit 前的写入操作用于崩溃恢复；持久性取决于 `index.translog.durability` 同步策略 |

> `index.refresh_interval` 默认 1s 是后台刷新的目标间隔，并非每个分片都严格每秒刷新。默认配置下，长期无搜索/GET 请求的分片在达到 `index.search.idle.after` 阈值后可能暂停后台刷新，后续搜索到达时再触发。该暂停行为仅在未显式设置 `index.refresh_interval` 时生效。

详见 [写入流程](../05-distributed-internals/chapter-04-write-path.md)。

## 8. 索引别名（Alias）

别名是一个或多个索引的虚拟名称，常用于零停机重建索引、简化客户端代码、滚动索引等场景。

```json
POST /_aliases
{
  "actions": [
    { "add": { "index": "my-index-v2", "alias": "my-index" } },
    { "remove": { "index": "my-index-v1", "alias": "my-index" } }
  ]
}
```

## 9. 映射（Mapping）

Mapping 定义索引中字段的类型和索引方式，类似数据库的 Schema。

| 字段类型 | 说明 | 是否分词 |
| :-- | :-- | :-- |
| `text` | 全文检索字段 | ✅ 是 |
| `keyword` | 精确匹配字段 | ❌ 否 |
| `long/integer` | 数值类型 | ❌ 否 |
| `date` | 日期类型 | ❌ 否 |
| `boolean` | 布尔类型 | ❌ 否 |
| `nested` | 嵌套对象 | - |

> ⚠️ **已有字段的类型不能原地修改**。Mapping 并非完全不可变：可以新增字段、为已有字段增加 multi-field，部分参数也允许更新；需要改变已有字段类型时，通常创建带新 Mapping 的目标索引，再通过 Reindex 迁移数据并切换别名。注意，给已有字段新增 multi-field 不会自动为历史文档补建该子字段的索引数据，需通过 update_by_query 或 Reindex 回填后才能按新字段查询或聚合。详见 [Mapping 设计](../02-indexing/chapter-02-mapping.md)。

## 10. 最佳实践

- 生产环境通常配置 3 个 master-eligible 节点（至少 2 个非 voting-only），选举容错取决于投票资格节点及其配置，而非单纯的节点总数
- 主分片数提前规划，创建后不能直接修改，如需调整需评估 Split、Shrink 或 Reindex 等迁移方案
- 单分片大小建议 10~50GB
- 使用别名指向索引，便于零停机迁移
- 全文搜索用 `text`，精确匹配用 `keyword`
