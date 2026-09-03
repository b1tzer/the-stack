# 版本升级

## 1. 升级策略

| 方式 | 说明 | 适用场景 |
| :-- | :-- | :-- |
| **滚动重启** | 逐个节点升级，零停机 | 小版本升级（如 8.11 → 8.12） |
| **全量重启** | 停止所有节点后升级 | 大版本升级（如 7.x → 8.x） |

## 2. 滚动升级步骤

### 2.1 升级前准备

```json
// 1. 检查集群健康
GET /_cluster/health

// 2. 禁用分片分配
PUT /_cluster/settings
{
  "transient": {
    "cluster.routing.allocation.enable": "primaries"
  }
}

// 3. 执行同步 flush
POST /_flush/synced

// 4. 停止非必要的索引操作
```

### 2.2 升级节点

```bash
# 1. 停止节点
systemctl stop elasticsearch

# 2. 安装新版本
# 使用包管理器或解压新版本

# 3. 检查配置文件兼容性
# 比较新旧 elasticsearch.yml

# 4. 启动节点
systemctl start elasticsearch

# 5. 等待节点加入集群
GET /_cat/nodes?v
```

### 2.3 升级后恢复

```json
// 重新启用分片分配
PUT /_cluster/settings
{
  "transient": {
    "cluster.routing.allocation.enable": "all"
  }
}

// 等待集群恢复 Green
GET /_cluster/health?wait_for_status=green&timeout=5m
```

### 2.4 重复升级其他节点

对集群中的每个节点重复上述步骤，逐个升级。

## 3. 大版本升级（7.x → 8.x）

```bash
# 1. 使用升级助手检查兼容性
GET /_migration/deprecations

# 2. 创建完整备份
PUT /_snapshot/upgrade_backup/pre_upgrade
{
  "indices": "*"
}

# 3. 停止所有节点

# 4. 升级所有节点

# 5. 启动集群

# 6. 验证集群状态
GET /_cluster/health
GET /_cat/indices?v
```

## 4. 升级回滚

```json
// 如果升级失败，恢复备份
POST /_snapshot/upgrade_backup/pre_upgrade/_restore
{
  "indices": "*"
}
```

## 5. 兼容性矩阵

| 升级路径 | 方式 | 说明 |
| :-- | :-- | :-- |
| 8.x → 8.y | 滚动升级 | 小版本升级 |
| 7.17 → 8.x | 滚动升级 | 支持直接升级 |
| 7.x → 7.17 → 8.x | 两步升级 | 先升级到 7.17 |
| 6.x → 7.x | 全量重启 | 需要重建索引 |

## 6. 最佳实践

- 升级前务必创建完整备份
- 使用升级助手检查兼容性
- 生产环境先在测试环境验证
- 滚动升级期间禁用分片分配
- 升级后监控集群状态和性能
- 保留回滚方案
