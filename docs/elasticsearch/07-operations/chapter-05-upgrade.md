# 版本升级

## 1. 升级策略

升级路径不按「小版本 / 大版本」简单二分，而应依据官方版本升级矩阵选择。同大版本内的升级（如 8.11 → 8.12）通常支持滚动重启；跨大版本时需先确认源版本到目标版本是否支持滚动升级（如 7.17 → 8.x 支持，更早的 7.x 需先升到 7.17）。

| 方式 | 说明 | 适用场景 |
| :-- | :-- | :-- |
| **滚动重启** | 逐个节点升级，零停机 | 官方矩阵支持滚动升级的路径（如 8.x 内、7.17 → 8.x） |
| **全量重启** | 停止所有节点后升级 | 不支持滚动升级、或需重建索引的路径 |

## 2. 滚动升级步骤

滚动升级每次只升级一个节点。节点恢复并验证通过后再升级下一个；分片分配策略的设置与恢复时机，应遵循目标版本的官方滚动升级流程，而非固定推迟到所有节点完成之后。

### 2.1 升级前准备

```json
// 1. 检查集群健康与未分配分片
GET /_cluster/health
GET /_cat/shards?v&h=index,shard,prirep,state,node

// 2. 检查磁盘水位与待处理任务
GET /_cat/allocation?v
GET /_cluster/pending_tasks

// 3. 按目标版本官方流程设置分片分配策略（不固定为某一值）
PUT /_cluster/settings
{
  "persistent": {
    "cluster.routing.allocation.enable": "primaries"
  }
}
```

### 2.2 升级单个节点

```bash
# 1. 停止节点
systemctl stop elasticsearch

# 2. 安装新版本
# 使用包管理器或解压新版本

# 3. 检查配置文件兼容性
# 比较新旧 elasticsearch.yml

# 4. 启动节点
systemctl start elasticsearch

# 5. 等待节点重新加入集群
GET /_cat/nodes?v
```

### 2.3 验证节点后继续

```json
// 确认节点版本与角色正确
GET /_cat/nodes?v&h=name,version,node.role

// 确认主分片正常分配、集群满足继续升级的条件
GET /_cat/shards?v&h=index,shard,prirep,state,node
GET /_cluster/health
```

验证通过后再升级下一个节点，重复 2.2 与 2.3。

### 2.4 恢复分配策略

按目标版本官方流程恢复分配设置。`null` 是清除持久设置、让配置回到其他层级决定的有效值，不等同于固定写入某个「正常值」。

```json
// 恢复分配策略
PUT /_cluster/settings
{
  "persistent": {
    "cluster.routing.allocation.enable": null
  }
}

// 等待集群恢复预期状态
GET /_cluster/health?wait_for_status=green&timeout=5m
```

## 3. 跨大版本升级（7.x → 8.x）

跨大版本升级分两阶段：不满足直接升级条件的 7.x 先升到 7.17，再从 7.17 按目标版本指南升到 8.x。以下以 7.17 → 8.x 为例，实际采用滚动升级还是全量重启，按官方矩阵判断。

```json
// 1. 检查弃用项（仅是兼容性检查的一项，还需按官方指南核对索引、插件与配置）
GET /_migration/deprecations

// 2. 创建快照（indices 是索引匹配模式，include_global_state 是全局集群状态，二者不保证覆盖所有系统数据）
PUT /_snapshot/upgrade_backup/pre_upgrade
{
  "indices": "*",
  "include_global_state": true
}

// 3. 确认快照仓库已注册、快照创建完成且状态为 SUCCESS，再停机
GET /_snapshot/upgrade_backup/pre_upgrade/_status

// 4. 停止所有节点

// 5. 升级所有节点

// 6. 启动集群

// 7. 验证集群状态
GET /_cluster/health
GET /_cat/indices?v
```

## 4. 升级失败后的恢复策略

Elasticsearch 不支持直接降级，快照恢复不等于版本回滚，二者需区分。

- 升级尚未产生不可逆状态变更：按官方升级指南判断能否安全停止或继续，不承诺可直接降级。
- 必须回到旧版本：准备旧版本集群，在满足快照与版本兼容性的前提下恢复数据；无法直接恢复的索引需通过兼容版本中转或 Reindex。

```json
// 恢复前需确认目标索引冲突、快照状态与版本兼容性
POST /_snapshot/upgrade_backup/pre_upgrade/_restore
{
  "indices": "*"
}
```

## 5. 兼容性矩阵

| 升级路径 | 方式 | 说明 |
| :-- | :-- | :-- |
| 8.x → 8.y | 滚动升级 | 同大版本内升级 |
| 7.17 → 8.x | 滚动升级 | 支持直接升级 |
| 7.x → 7.17 → 8.x | 两步升级 | 先升级到 7.17 |
| 6.x → 7.x | 按官方矩阵核对 | 需检查索引兼容性，可能需重建索引 |

## 6. 最佳实践

- 升级前创建快照备份，并确认快照创建成功
- 使用升级助手检查兼容性
- 生产环境先在测试环境验证
- 滚动升级期间按官方流程控制分片分配
- 升级后监控集群状态和性能
- 提前制定失败恢复方案（版本回退与数据恢复需区分）
