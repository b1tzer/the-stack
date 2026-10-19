# 备份恢复

## 1. Snapshot/Restore 概述

ES 使用 Snapshot（快照）机制进行备份，支持增量备份，可以备份到本地或远程存储（S3、HDFS、Azure Blob 等）。

## 2. 配置仓库

### 2.1 本地仓库

```json
// 创建本地仓库
PUT /_snapshot/my_backup
{
  "type": "fs",
  "settings": {
    "location": "/data/backups/es",
    "compress": true,
    "max_snapshot_bytes_per_sec": "50mb",
    "max_restore_bytes_per_sec": "50mb"
  }
}
```

```yaml
# elasticsearch.yml 中配置仓库路径
path.repo: ["/data/backups"]
```

`location` 必须位于 `path.repo` 允许的目录下。生产集群中，所有需要访问该仓库的节点都要通过共享文件系统（如 NFS）访问同一份仓库数据，并在对应节点配置 `path.repo`，修改后重启节点。如果其他集群需要读取该仓库，应使用只读方式访问，避免多个集群并发写入破坏仓库数据。

### 2.2 S3 仓库

```bash
# 安装 S3 插件（需在集群每个节点执行，并按插件要求重启节点）
./bin/elasticsearch-plugin install repository-s3
```

```json
PUT /_snapshot/s3_backup
{
  "type": "s3",
  "settings": {
    "bucket": "my-es-backups",
    "region": "us-east-1",
    "base_path": "prod-cluster"
  }
}
```

## 3. 创建快照

```json
// 备份所有索引
PUT /_snapshot/my_backup/snapshot_all_20240115
{
  "indices": "*",
  "ignore_unavailable": true,
  "include_global_state": true
}

// 备份指定索引
PUT /_snapshot/my_backup/snapshot_orders_20240115
{
  "indices": "orders,users,products",
  "ignore_unavailable": true
}

// 增量快照：复用仓库中已有的不可变数据文件，只传输仓库中尚不存在的数据文件
PUT /_snapshot/my_backup/snapshot_20240116
{
  "indices": "*"
}
```

同一仓库中不能使用已存在的快照名称创建新快照，否则会因名称冲突而失败。

## 4. 查看快照

```json
// 查看所有快照
GET /_snapshot/my_backup/_all

// 查看特定快照
GET /_snapshot/my_backup/snapshot_all_20240115

// 查看快照状态
GET /_snapshot/my_backup/snapshot_all_20240115/_status
```

## 5. 恢复快照

```json
// 恢复所有索引
POST /_snapshot/my_backup/snapshot_all_20240115/_restore

// 恢复指定索引
POST /_snapshot/my_backup/snapshot_orders_20240115/_restore
{
  "indices": "orders,users",
  "ignore_unavailable": true,
  "include_global_state": false
}

// 恢复到新索引名
POST /_snapshot/my_backup/snapshot_orders_20240115/_restore
{
  "indices": "orders",
  "rename_pattern": "(.+)",
  "rename_replacement": "restored_$1"
}
```

快照可恢复性由快照版本、索引创建版本和目标集群版本共同决定。快照不能恢复到更低版本的集群，旧版本创建的索引恢复到新版本集群时，也要核对索引创建版本与目标集群的兼容关系，升级或迁移前应先核对三者版本。

恢复完成后还需检查恢复任务状态、目标索引健康状态和文档数量，并用关键业务查询验证数据完整性。API 请求成功或快照状态为 SUCCESS，不能单独证明业务已恢复。

## 6. 自动化备份

```bash
#!/bin/bash
# backup_es.sh
DATE=$(date +%Y%m%d)

# 创建快照并检查请求是否被接受
curl -s --max-time 30 -X PUT "localhost:9200/_snapshot/my_backup/snapshot_$DATE" \
  -H 'Content-Type: application/json' \
  -d '{"indices": "*", "ignore_unavailable": true}' | grep -q '"accepted":true' \
  || { echo "快照创建请求失败"; exit 1; }

# 等待快照完成，最多 30 分钟（快照是异步任务，SUCCESS 才算有效备份）
for i in $(seq 1 30); do
  STATE=$(curl -s --max-time 30 "localhost:9200/_snapshot/my_backup/snapshot_$DATE" \
    | grep -o '"state":"[A-Z]*"' | head -1 | cut -d'"' -f4)
  [ "$STATE" = "SUCCESS" ] && break
  [ "$STATE" = "FAILED" ] && { echo "快照失败"; exit 1; }
  [ -z "$STATE" ] && { echo "查询快照状态失败"; exit 1; }
  sleep 60
done
[ "$STATE" = "SUCCESS" ] || { echo "快照超时未完成"; exit 1; }
```

保留策略（如保留最近 30 天）应由 §7 的 SLM 统一管理，不要用按日期拼接名称的单次删除实现。备份失败、任务漏跑或命名变化，都会使这种删除偏离预期的保留结果。

```bash
# crontab
0 2 * * * /opt/scripts/backup_es.sh
```

## 7. SLM（Snapshot Lifecycle Management）

```json
PUT /_slm/policy/backup-policy
{
  "schedule": "0 30 1 * * ?",
  "name": "<snapshot-{now/d}>",
  "repository": "my_backup",
  "config": {
    "indices": ["*"],
    "ignore_unavailable": true,
    "include_global_state": false
  },
  "retention": {
    "expire_after": "30d",
    "min_count": 5,
    "max_count": 50
  }
}
```

`max_count` 只统计状态为 SUCCESS 的快照，不是仓库中所有快照的绝对上限。

## 8. 最佳实践

- 生产环境必须配置自动备份
- 使用 SLM 策略自动化快照管理
- 备份到远程存储（S3/HDFS），避免本地磁盘故障
- 定期将快照恢复到隔离的验证环境，检查索引健康与文档数量，用关键业务查询验证数据完整性，并记录恢复耗时
- 升级或迁移前核对快照版本、索引创建版本与目标集群版本
- 增量快照复用仓库中已有的数据文件，节省存储空间和时间
- 保留至少 30 天的备份历史
