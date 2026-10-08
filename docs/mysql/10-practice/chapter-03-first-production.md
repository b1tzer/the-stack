# 首次生产部署

> 把 MySQL 从开发环境搬到生产环境的关键检查清单。参数机制见[存储与日志](../02-storage-and-logging/chapter-02-buffer-pool.md)，完整操作步骤按本页末尾链接进入对应运维章节。

## 1. 硬件规划

容量计算应从实际数据量、并发连接和写入吞吐出发；Buffer Pool 的作用见[Buffer Pool](../02-storage-and-logging/chapter-02-buffer-pool.md)。

| 组件 | 建议 |
| :-- | :-- |
| 内存 | ≥ 16G，`innodb_buffer_pool_size` 设为 60%~80% |
| 磁盘 | SSD，IOPS ≥ 3000 |
| CPU | ≥ 8 核 |
| 网络 | 千兆网卡，主从在同一机房 |

## 2. 必改参数

这些配置只给出首次上线的起点。参数含义和调整边界见[参数速查](../reference/parameters.md)，上线后的性能诊断见[性能调优](./chapter-05-performance-tuning.md)。

```ini
[mysqld]
# 缓冲池
innodb_buffer_pool_size = 12G
innodb_buffer_pool_instances = 8

# Redo Log
innodb_redo_log_capacity = 2G
innodb_flush_log_at_trx_commit = 1

# Binlog（主从必须）
log_bin = mysql-bin
binlog_format = ROW
sync_binlog = 1
binlog_expire_logs_seconds = 604800

# 连接
max_connections = 1000
wait_timeout = 600

# 慢查询
slow_query_log = ON
long_query_time = 1

# 安全
local_infile = OFF
sql_mode = STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION
```

## 3. 安全加固

账号、权限、TLS 和审计的完整要求见[安全与用户管理](../08-operations/chapter-04-security.md)。

```sql
-- 删除匿名用户
DELETE FROM mysql.user WHERE User = '';

-- 禁止远程 root
DELETE FROM mysql.user WHERE User = 'root' AND Host != 'localhost';

-- 创建应用专用账号
CREATE USER 'app'@'%' IDENTIFIED BY 'strong_password';
GRANT SELECT, INSERT, UPDATE, DELETE ON mydb.* TO 'app'@'%';

FLUSH PRIVILEGES;
```

## 4. 备份策略

备份工具、PITR 和恢复验证步骤见[备份恢复](../08-operations/chapter-01-backup-restore.md)。

- 全量备份：每天凌晨 `mysqldump` 或 `xtrabackup`
- Binlog 备份：实时归档到远程存储
- 恢复演练：每季度验证一次备份可恢复性

## 5. 监控

指标采集和告警见[监控](../08-operations/chapter-03-monitoring.md)；需要从数据库内部定位语句、锁和 I/O 时见[内省与可观测性](../08-operations/chapter-02-observability.md)。

- 连接数、QPS、TPS
- Buffer Pool 命中率
- 慢查询数量
- 复制延迟（主从）
- 磁盘使用率
