# 时序数据建模

## 1. 时序数据特点

时序数据（Time Series Data）是按时间顺序产生的数据，如日志、监控指标、IoT 数据等。

| 特点 | 说明 |
| :-- | :-- |
| **写入密集** | 持续高频写入 |
| **时间有序** | 数据按时间戳排列 |
| **查询模式固定** | 通常按时间范围查询 |
| **数据老化** | 近期数据查询频繁，历史数据逐渐变冷 |

## 2. 索引策略

本文示例基于 Elasticsearch 8.x 及之后版本。时序数据在 ES 中有不同建模方式，应先判断数据形态再选型。

日志、事件及一般带时间戳的数据，按写入模式、查询方式和保留周期，选择普通索引加别名加 ILM，或 Data Stream。

持续写入、以时间戳和一组维度标识的指标数据，评估 Time Series Data Stream（TSDS）。TSDS 通过维度字段与指标字段优化存储和查询，与普通索引不是同一模型。

需要自定义 `_id` 或频繁覆盖更新的数据，评估普通索引或带写索引的别名更合适。

### 2.1 按时间滚动索引

```json
// 索引模板
PUT /_index_template/logs-template
{
  "index_patterns": ["logs-*"],
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "index.lifecycle.name": "logs-policy",
      "index.lifecycle.rollover_alias": "logs",
      "index.codec": "best_compression",
      "index.sort.field": ["@timestamp"],
      "index.sort.order": ["desc"]
    },
    "mappings": {
      "properties": {
        "@timestamp": { "type": "date" },
        "message": { "type": "text" },
        "level": { "type": "keyword" },
        "service": { "type": "keyword" }
      }
    }
  }
}

// 创建初始索引
PUT /logs-000001
{
  "aliases": {
    "logs": { "is_write_index": true }
  }
}
```

### 2.2 ILM 策略（Index Lifecycle Management）

```json
PUT /_ilm/policy/logs-policy
{
  "policy": {
    "phases": {
      "hot": {
        "min_age": "0ms",
        "actions": {
          "rollover": {
            "max_size": "50gb",
            "max_age": "1d",
            "max_docs": 100000000
          },
          "set_priority": { "priority": 100 }
        }
      },
      "warm": {
        "min_age": "3d",
        "actions": {
          "shrink": { "number_of_shards": 1 },
          "forcemerge": { "max_num_segments": 1 },
          "set_priority": { "priority": 50 }
        }
      },
      "cold": {
        "min_age": "30d",
        "actions": {
          "set_priority": { "priority": 0 }
        }
      },
      "delete": {
        "min_age": "90d",
        "actions": {
          "delete": {}
        }
      }
    }
  }
}
```

cold 阶段只保留 `set_priority`。数据层迁移由 ILM 自动完成，进入 warm 或 cold 阶段时，ILM 自动调整索引的 `_tier_preference`，把索引分配到 `data_warm` 或 `data_cold` 节点。实际能否迁移到目标层，还取决于集群是否存在符合要求的节点以及分片分配是否成功。`set_priority` 仅调整分片恢复优先级，不是迁移动作。

## 3. 冷热架构

```json
// Hot 节点配置（SSD，高性能）
node.roles: [data_hot, data_content]

// Warm 节点配置（HDD，大容量）
node.roles: [data_warm]

// Cold 节点配置（低成本存储）
node.roles: [data_cold]
```

```txt
Hot（SSD）  →  Warm（HDD）  →  Cold（归档）  →  Delete
  0~3天         3~30天         30~90天          >90天
```

## 4. 数据压缩与优化

`index.codec` 与 `index.sort.*` 都是索引设置，其中 `index.sort.*` 是静态设置，只能在创建索引或通过索引模板配置，无法对已存在的索引直接修改。这两项已合并进第 2.1 节的索引模板。

已存在的索引无法通过修改上述静态设置启用索引排序，确有需要时应新建索引并通过 reindex 迁移数据。

| 优化手段 | 效果 |
| :-- | :-- |
| `best_compression` | 以更高压缩率的编码方式降低存储占用，但读取 stored fields 的延迟可能增加，实际收益取决于数据特征与查询负载，应基于代表性数据对比测试 |
| `index.sort` | 可能改善按时间范围查询的执行效率，实际收益取决于查询模式、数据分布与段结构 |
| `forcemerge` | 减少 Segment 数量，提升查询性能 |
| 只读索引 | 不需要写入的索引可设为只读 |

## 5. 查询时序数据

```json
GET /logs-*/_search
{
  "query": {
    "bool": {
      "filter": [
        {
          "range": {
            "@timestamp": {
              "gte": "now-1h",
              "lte": "now"
            }
          }
        },
        {
          "term": { "level": "ERROR" }
        }
      ]
    }
  },
  "sort": [{ "@timestamp": "desc" }],
  "size": 100
}
```

## 6. 最佳实践

- 使用索引别名 + ILM 策略自动化管理索引生命周期
- Hot/Warm/Cold 架构按数据温度分层存储
- 以存储成本为主、查询延迟要求宽松的索引，评估 `best_compression`，用代表性数据测试存储收益与读取开销
- 索引按时间滚动，避免单个索引过大
- 对已停止写入、确定不再更新的索引，评估收益后执行 `forcemerge`
- 以时间范围查询为主的索引，评估按 `@timestamp` 排序的收益，并在创建索引前通过代表性数据测试
- 监控索引增长速度，提前规划存储容量
