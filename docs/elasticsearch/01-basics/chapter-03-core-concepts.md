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

## 4. 节点 (Node)

| 角色 | 说明 |
| :-- | :-- |
| Master | 集群管理 |
| Data | 数据存储 |
| Coordinating | 查询协调 |
| Ingest | 数据预处理 |

## 5. 集群 (Cluster)

```
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
| **Refresh** | 将 Buffer 数据写入 Segment，默认 1s，写入后可搜索 |
| **Flush** | 将 Segment 持久化到磁盘，清空 Translog |
| **Translog** | 事务日志，防止数据丢失 |

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

> ⚠️ **Mapping 一旦创建不可修改已有字段类型**，只能通过 Reindex 重建索引。

## 10. 最佳实践

- 生产环境至少 3 个节点，满足 Master 选举要求
- 主分片数提前规划，创建后不可修改
- 单分片大小建议 10~50GB
- 使用别名指向索引，便于零停机迁移
- 全文搜索用 `text`，精确匹配用 `keyword`
