# 异步复制与半同步复制

## 1. 异步复制

```ini
# 主库
server-id = 1
log-bin = mysql-bin
binlog_format = ROW

# 从库
server-id = 2
relay-log = relay-bin
read_only = ON
```

```sql
-- 从库配置
CHANGE MASTER TO
    MASTER_HOST='192.168.1.100',
    MASTER_USER='repl',
    MASTER_PASSWORD='secret',
    MASTER_AUTO_POSITION=1;

START SLAVE;
SHOW SLAVE STATUS\G
```

## 2. 半同步复制

```sql
-- 主库
INSTALL PLUGIN rpl_semi_sync_master SONAME 'semisync_master.so';
SET GLOBAL rpl_semi_sync_master_enabled = 1;

-- 从库
INSTALL PLUGIN rpl_semi_sync_slave SONAME 'semisync_slave.so';
SET GLOBAL rpl_semi_sync_slave_enabled = 1;
```

## 3. 延迟问题

```sql
-- 查看从库延迟
SHOW SLAVE STATUS\G
-- Seconds_Behind_Master
```

## 4. 复制原理详解

复制的数据来源是 Binlog，其记录格式与事件类型见 [Binlog](../02-innodb-internals/chapter-06-binlog.md)。

```
主库：
1. 事务提交 → 写入 Binlog
2. Binlog Dump Thread 发送 Binlog 事件给从库

从库：
1. IO Thread 接收 Binlog 事件 → 写入 Relay Log
2. SQL Thread 读取 Relay Log → 重放 SQL/行变更

MySQL 8.0.26+ 改名：
- Binlog Dump Thread → Binlog Dump Thread
- IO Thread → Replica IO Thread
- SQL Thread → Replica SQL Thread
```

## 5. 复制延迟排查

```sql
-- 查看从库延迟
SHOW REPLICA STATUS\G
-- Seconds_Behind_Source: 延迟秒数
-- Replica_SQL_Running: SQL 线程是否运行
-- Replica_IO_Running: IO 线程是否运行

-- 延迟原因排查：
-- 1. 主库大事务
SELECT * FROM information_schema.innodb_trx ORDER BY trx_started ASC;

-- 2. 从库单线程回放（MySQL 5.7 之前）
-- 解决：开启多线程复制
SET GLOBAL slave_parallel_type = 'LOGICAL_CLOCK';
SET GLOBAL slave_parallel_workers = 8;

-- 3. 从库硬件性能不足
-- 4. 网络延迟
```

## 6. 多线程复制

```sql
-- MySQL 5.7+ 支持基于 LOGICAL_CLOCK 的多线程复制

-- 查看当前并行复制配置
SHOW VARIABLES LIKE 'slave_parallel_type';      -- DATABASE / LOGICAL_CLOCK
SHOW VARIABLES LIKE 'slave_parallel_workers';    -- 默认 0（单线程）

-- 启用多线程复制
STOP REPLICA;
SET GLOBAL slave_parallel_type = 'LOGICAL_CLOCK';
SET GLOBAL slave_parallel_workers = 8;
SET GLOBAL slave_preserve_commit_order = ON;  -- 保证提交顺序
START REPLICA;

-- MySQL 8.0.27+ 支持写集（Write Set）并行复制
SET GLOBAL binlog_transaction_dependency_tracking = 'WRITESET';
```

## 7. 复制过滤

```sql
-- 主库端过滤（不推荐，会丢失数据）
# my.cnf
binlog-do-db = mydb        -- 只记录指定库
binlog-ignore-db = test    -- 忽略指定库

-- 从库端过滤（推荐）
# my.cnf
replicate-do-db = mydb           -- 只复制指定库
replicate-ignore-db = test        -- 忽略指定库
replicate-do-table = mydb.users   -- 只复制指定表
replicate-wild-do-table = mydb.log_%  -- 通配符匹配

-- 动态设置（MySQL 8.0.26+）
STOP REPLICA;
CHANGE REPLICATION FILTER REPLICATE_DO_DB = (mydb, mydb2);
START REPLICA;
```

## 8. 复制监控

```sql
-- 监控复制状态
SHOW REPLICA STATUS\G

-- 监控复制延迟
SELECT
    TIMESTAMPDIFF(SECOND, MAX(COMMIT_TIMESTAMP), NOW()) AS delay_seconds
FROM performance_schema.replication_applier_status_by_worker;

-- 监控复制错误
SELECT * FROM performance_schema.replication_applier_status_by_worker
WHERE LAST_ERROR_NUMBER != 0;

-- 跳过错误（谨慎使用）
STOP REPLICA;
SET GLOBAL sql_replica_skip_counter = 1;
START REPLICA;
```

## 9. 最佳实践

1. **使用 ROW 格式 Binlog** — 数据一致性最好
2. **开启多线程复制** — 减少从库延迟
3. **监控复制延迟** — 设置告警阈值
4. **从库设置 read_only** — 防止误写
5. **定期检查复制一致性** — 使用 pt-table-checksum
6. **主从切换使用 GTID** — 简化切换流程

