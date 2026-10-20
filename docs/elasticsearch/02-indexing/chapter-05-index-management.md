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

# 原子切换别名：单次请求内完成 remove + add
POST /_aliases
{
  "actions": [
    { "remove": { "index": "my-index-v1", "alias": "my-index" } },
    { "add": { "index": "my-index-v2", "alias": "my-index" } }
  ]
}
```

`_aliases` 请求能原子地完成别名关系变更，但这只覆盖切换瞬间，不等于业务全程无中断，也不保证迁移期间的数据一致性——后者取决于迁移前的同步、切换期间的写入协调和切换后的验证（见 §4.2）。业务读写入口应通过别名访问索引，避免把具体索引名写死在应用配置中。

## 2. 索引模板

索引模板用于为新创建的索引自动应用 Settings 和 Mappings。模板只在索引创建时生效，不会为已有索引补齐配置。结合 ILM 使用时，模板还需配置生命周期策略名和滚动别名：

```json
PUT /_index_template/my-template
{
  "index_patterns": ["logs-*"],
  "priority": 100,
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "index.lifecycle.name": "my-policy",
      "index.lifecycle.rollover_alias": "logs"
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

模板本身不会启动滚动流程：使用 ILM 管理滚动索引时，还需先创建生命周期策略，再手动创建匹配 `index_patterns` 的首个索引并绑定写别名（见 §3）。

## 3. ILM (Index Lifecycle Management)

ILM 策略定义了索引在各阶段的行为。以下示例在 hot 阶段按大小（`max_size`）或时间（`max_age`）触发滚动，warm 阶段收缩分片，滚动 30 天后删除。对已滚动的索引，`warm.min_age: 7d` 和 `delete.min_age: 30d` 以 Rollover 时间为基准计算，而非索引创建时间；`min_age` 是进入该阶段的最早门槛，实际执行动作还会受 ILM 轮询调度和前序动作完成情况影响，可能晚于门槛时刻：

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

要使 ILM rollover 正常工作，还需完成以下步骤：

**创建首个索引并绑定写别名**。使用省略目标索引名、由 Elasticsearch 自动生成下一个索引名的常规 Rollover（ILM 自动滚动属于此类）时，索引名需要以数字结尾，如 `logs-000001`，这样 rollover 才能自动生成下一个索引名。同时要满足三项配置关系：索引名匹配模板的 `index_patterns`、`index.lifecycle.rollover_alias` 与实际写别名一致、首个索引在该别名下设置 `is_write_index: true`：

```json
PUT /logs-000001
{
  "aliases": {
    "logs": { "is_write_index": true }
  }
}
```

此后所有写入都通过别名 `logs` 进行。当 rollover 条件触发时，ILM 自动创建 `logs-000002` 并将写别名指向新索引；旧索引要等满足阶段门槛（示例中为滚动 7 天后）和前序条件，才会进入 warm 阶段。

> **注意**：`max_size` 和 `max_age` 是触发条件，不保证在精确时刻完成滚动。`max_size` 统计索引全部主分片的存储大小之和（不含副本分片），`max_primary_shard_size` 以最大的单个主分片为阈值；配置时按想限制的是主分片总量还是单个分片大小来选择。官方 ILM 教程当前用 `max_primary_shard_size` 配合 `max_age` 作为滚动条件示例。ILM 按 `indices.lifecycle.poll_interval`（默认 10 分钟）轮询检查，且一次滚动可能分多个步骤、由 ILM 多次执行完成，实际滚动时间可能晚于条件满足时刻。排查滚动状态可用 `GET /logs-*/_ilm/explain` 查看当前索引所处的 ILM 阶段、动作和执行步骤。

## 4. Reindex（重建索引）

当需要修改 Mapping（如字段类型变更）时，需要通过 Reindex 重建索引。`_reindex` 不会自动复制源索引的 Mapping 和 Settings，目标索引必须提前创建并配置好所需结构。

### 4.1 基本用法

```json
# 1. 先创建目标索引（配置新的 Mapping 和 Settings）
PUT /my-index-v2
{
  "settings": { "number_of_shards": 3, "number_of_replicas": 1 },
  "mappings": {
    "properties": {
      "title": { "type": "text" },
      "status": { "type": "keyword" }
    }
  }
}

# 2. 将数据从 v1 复制到 v2
POST /_reindex
{
  "source": { "index": "my-index-v1" },
  "dest": { "index": "my-index-v2" }
}
```

### 4.2 迁移策略

`_reindex` 复制的是启动时刻的快照，源索引在复制期间继续接收的写入不会自动出现在目标索引中。根据业务对停写的容忍度，选择以下策略：

**场景一：允许短暂停写**

1. 暂停所有写入源索引的业务入口（不只给索引加写保护），并确认进行中的写请求已完成
2. 对源索引设置写保护并执行 `_reindex`：`PUT /my-index-v1/_settings { "index.blocks.write": true }`
3. 校验目标索引文档数量与关键业务数据：`GET /my-index-v2/_count`。数量相同不代表内容一致，关键字段还需抽样或按业务口径汇总核对
4. 通过单次 `_aliases` 请求原子切换业务实际使用的读写别名（切换请求需与 §1 一致，别名指向目标索引）
5. 恢复业务写入（后续请求全部走新别名），保留旧索引观察一段时间作为回滚备份，确认无误后删除

**场景二：迁移期间要求持续写入**

持续写入场景不能仅靠一次全量 Reindex 和一次时间戳增量 Reindex 保证数据一致。全量复制期间，源索引中的文档可能继续被更新或删除：时间戳 `range` 查询只能复制 `updated_at` 变化的文档，删除不会同步；目标索引中已存在的同 `_id` 文档，`op_type: create` 不会更新，`conflicts: proceed` 只会让任务跳过冲突继续执行。所以重复执行增量任务不会让这些文档自动补齐，任务「成功执行」也不等于数据一致。

生产迁移应使用能可靠追踪变更的机制，例如双写或 CDC，并处理变更顺序、删除同步和失败重试；切换前建立明确的同步屏障，确认源端变更已全部应用到目标索引，再原子切换别名。如果业务无法提供可靠的增量变更机制，应重新评估是否能安排短暂停写，而不是把时间戳查询当作无损迁移方案。

下面的请求只演示**按时间窗筛选增量文档并跳过冲突**这一机制，不代表可重复执行达成最终一致的迁移方案。使用前先完成全量 `_reindex` 并记录开始时间 T，把 `gte` 替换为 T；同时要求 `updated_at` 可靠记录了所有相关更新、业务没有删除或删除另行处理、且接受同 `_id` 文档不会被更新：

```json
POST /_reindex
{
  "source": {
    "index": "my-index-v1",
    "query": { "range": { "updated_at": { "gte": "<全量复制开始时间 T>" } } }
  },
  "dest": { "index": "my-index-v2", "op_type": "create" },
  "conflicts": "proceed"
}
```

筛选和冲突处理确认无误、数据核对通过后，按场景一的方式原子切换别名并保留旧索引回滚。

> **注意**：别名切换 API 本身是原子的，但这只保证切换瞬间无中断，不等于整个迁移过程的数据一致性。迁移的可靠性取决于上述同步策略，而非切换动作本身。

## 5. 索引模板最佳实践

- 使用 `index_patterns` 匹配多个索引（如 `logs-*`）
- 多个可组合索引模板匹配同一索引时，`priority` 决定优先采用哪个模板；最终生效的 Settings 和 Mappings 还受组件模板组合与合并规则影响，不能理解为高优先级模板无条件整体覆盖低优先级模板
- 结合 ILM 时，模板中配置 `index.lifecycle.name` 和 `index.lifecycle.rollover_alias`（见 §2、§3 完整示例）
- 对于新增的时序数据场景，优先评估 Data Stream，以减少手动管理滚动索引和写别名的工作；数据保留和生命周期管理仍需按需配置 ILM，Data Stream 可以直接挂接 ILM 策略，两者不是替代关系

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

# 打开/关闭索引（关闭后不可读写，释放部分运行时资源，但数据仍占用磁盘）
POST /my-index/_close
POST /my-index/_open

# 强制合并（仅对不再写入的只读索引使用）
POST /my-index/_forcemerge?max_num_segments=1
```

## 7. 索引管理注意事项

- 业务读写通过别名访问索引，避免把具体索引名写死在应用配置中；运维排查、数据校验和迁移任务可按需直接访问具体索引
- ILM 阶段按数据保留期限、访问频率和存储成本设计，不必每个策略都走 Hot → Warm → Cold → Delete；数据量较小或访问模式简单的场景可以只配置需要的阶段
- Rollover 条件按写入速率和主分片大小设计，§3 示例中的 50GB/1天是该示例的配置值，不是通用默认值
- 对已停止写入的历史索引，可评估是否执行 forcemerge 以减少 Segment 数量、优化查询性能。执行前检查磁盘余量（`max_num_segments=1` 的最坏情况可能需要高达三倍的临时空间，用于容量规划而非必然消耗）、节点负载和任务并发。避免对持续写入的索引例行执行 `max_num_segments=1`，否则可能生成超大 Segment（可能超过 5GB，具体阈值与版本和合并策略有关），难以再被常规合并有效处理，反而导致磁盘占用上升和搜索性能下降
- 删除索引前务必确认别名已切换
