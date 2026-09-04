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
      "index.lifecycle.rollover_alias": "logs"
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
          "set_priority": { "priority": 0 },
          "freeze": {}
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

```json
PUT /logs-2024.01.15/_settings
{
  "index.codec": "best_compression",
  "index.sort.field": "@timestamp",
  "index.sort.order": "desc"
}
```

| 优化手段 | 效果 |
| :-- | :-- |
| `best_compression` | 压缩率提升 30%~50% |
| 按时间排序 | 时间范围查询只读取相关 Segment |
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
- 冷数据使用 `best_compression` 压缩
- 索引按时间滚动，避免单个索引过大
- 只读索引执行 `forcemerge` 减少 Segment 数量
- 使用 `@timestamp` 作为索引排序字段
- 监控索引增长速度，提前规划存储容量
