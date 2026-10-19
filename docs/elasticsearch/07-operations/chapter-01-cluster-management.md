# 集群管理

## 1. 节点管理

### 1.1 添加节点

```yaml
# 新节点 elasticsearch.yml
cluster.name: prod-cluster
node.name: node-4
discovery.seed_hosts: ["node-1", "node-2", "node-3"]
node.roles: ["data"]
```

### 1.2 移除节点（优雅下线）

```json
// 1. 排空节点上的分片（排空是临时操作，用 transient 合理）
PUT /_cluster/settings
{
  "transient": {
    "cluster.routing.allocation.exclude._name": "node-4"
  }
}

// 2. 等待分片迁移完成
GET /_cat/shards?v&h=index,shard,prirep,state,node&s=node

// 3. 确认分片已迁移后清除排除条件
PUT /_cluster/settings
{
  "transient": {
    "cluster.routing.allocation.exclude._name": null
  }
}

// 4. 停止节点
```

### 1.3 节点角色配置

```yaml
# 专用 Master-eligible 节点（具备选举资格，不一定是当前 elected master）
node.roles: [master]

# 专用 Data 节点
node.roles: [data]

# 专用 Ingest 节点
node.roles: [ingest]
```

角色可以组合，例如 `node.roles: [master, data]`。只有在确实需要专用节点时，才单独配置对应角色。

## 2. 分片管理

### 2.1 查看分片分配

```json
GET /_cat/shards?v&h=index,shard,prirep,state,docs,store,node&s=store:desc

// 查看分片分配原因
GET /_cluster/allocation/explain
{
  "index": "my-index",
  "shard": 0,
  "primary": true
}
```

### 2.2 手动移动分片

```json
POST /_cluster/reroute
{
  "commands": [
    {
      "move": {
        "index": "my-index",
        "shard": 0,
        "from_node": "node-1",
        "to_node": "node-2"
      }
    }
  ]
}
```

### 2.3 分片分配控制

```json
// 禁止新的分片分配（不会自动迁移已分配的分片）
PUT /_cluster/settings
{
  "persistent": {
    "cluster.routing.allocation.enable": "none"
  }
}

// 仅暂停副本分配，主分片仍可分配（滚动重启时更常用）
PUT /_cluster/settings
{
  "persistent": {
    "cluster.routing.allocation.enable": "primaries"
  }
}

// 恢复默认分配（用 null 清除显式设置，回到其他配置层级决定的有效值）
PUT /_cluster/settings
{
  "persistent": {
    "cluster.routing.allocation.enable": null
  }
}
```

`none` 禁止新的分片分配，但不会迁移或取消已分配的分片；`primaries` 允许主分片分配、限制副本分片分配。两者适用于不同维护场景，不是可互换的通用开关。

## 3. 索引管理

```json
// 关闭索引（停止读写，释放部分运行时资源）
POST /my-index/_close

// 打开索引
POST /my-index/_open
```

冻结索引的 `_freeze` API 已在 Elasticsearch 8.0 移除，`_unfreeze` 在 8.x 仅用于兼容已有冻结索引，9.0 一并移除，不再作为现代集群的常规管理手段。

## 4. 集群设置

```json
// 查看集群设置
GET /_cluster/settings?include_defaults=true

// 持久设置（重启后保留，官方建议优先使用 persistent）
PUT /_cluster/settings
{
  "persistent": {
    "cluster.max_shards_per_node": 1000
  }
}

// 恢复默认值（用 null 清除显式设置）
PUT /_cluster/settings
{
  "persistent": {
    "cluster.max_shards_per_node": null
  }
}
```

`cluster.max_shards_per_node` 是示例配置值，不是所有集群都应采用的推荐值。

## 5. 最佳实践

- 生产环境至少 3 个具备 master 选举资格的节点
- 节点下线前先排空分片
- 维护时按场景选择分片分配策略，操作完成后用 null 清除设置恢复默认
- 监控节点磁盘使用率，设置合理的水位线
- 合理控制分片数量，实际分片规划应结合分片大小、查询负载、恢复耗时和节点资源评估
- 使用 `_cat` API 定期检查集群状态
