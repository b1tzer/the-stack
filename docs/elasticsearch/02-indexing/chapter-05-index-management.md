# 索引生命周期管理

## 1. 索引别名

```json
# 创建别名
POST /_aliases
{
  "actions": [
    { "add": { "index": "my-index-v1", "alias": "my-index" } }
  ]
}

# 切换别名（零停机）
POST /_aliases
{
  "actions": [
    { "remove": { "index": "my-index-v1", "alias": "my-index" } },
    { "add": { "index": "my-index-v2", "alias": "my-index" } }
  ]
}
```

## 2. 索引模板

```json
PUT /_index_template/my-template
{
  "index_patterns": ["logs-*"],
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1
    },
    "mappings": {
      "properties": {
        "timestamp": { "type": "date" },
        "message": { "type": "text" }
      }
    }
  }
}
```

## 3. ILM (Index Lifecycle Management)

```json
PUT /_ilm/policy/my-policy
{
  "policy": {
    "phases": {
      "hot": {
        "actions": {
          "rollover": { "max_size": "50GB", "max_age": "1d" }
        }
      },
      "warm": {
        "min_age": "7d",
        "actions": {
          "shrink": { "number_of_shards": 1 }
        }
      },
      "delete": {
        "min_age": "30d",
        "actions": { "delete": {} }
      }
    }
  }
}
```

## 4. Reindex（重建索引）

当需要修改 Mapping（如字段类型变更）时，需要通过 Reindex 重建索引：

```json
POST /_reindex
{
  "source": { "index": "my-index-v1" },
  "dest": { "index": "my-index-v2" }
}
```

配合别名实现零停机迁移：

```json
POST /_aliases
{
  "actions": [
    { "add": { "index": "my-index-v2", "alias": "my-index" } },
    { "remove": { "index": "my-index-v1", "alias": "my-index" } }
  ]
}
```

## 5. 索引模板最佳实践

- 使用 `index_patterns` 匹配多个索引（如 `logs-*`）
- 模板有优先级（`priority` 字段），高优先级覆盖低优先级
- ILM 策略绑定到模板，实现自动化生命周期管理
- 滚动索引（Rollover）配合别名，按大小或时间自动创建新索引

## 6. 常用索引管理 API

```json
# 查看索引设置
GET /my-index/_settings

# 修改副本数
PUT /my-index/_settings
{
  "number_of_replicas": 2
}

# 修改刷新间隔
PUT /my-index/_settings
{
  "index.refresh_interval": "5s"
}

# 打开/关闭索引（关闭后不占用资源，但不可读写）
POST /my-index/_close
POST /my-index/_open

# 强制合并（减少 Segment 数量）
POST /my-index/_forcemerge?max_num_segments=1
```

## 7. 最佳实践

- 使用别名指向索引，永远不要直接查询索引名
- ILM 策略建议：Hot → Warm → Cold → Delete
- 滚动索引按大小（50GB）或时间（1天）触发
- 定期执行 forcemerge 减少只读索引的 Segment 数量
- 删除索引前务必确认别名已切换

