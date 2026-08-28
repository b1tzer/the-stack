---
doc_id: pg-stat-views
title: 系统视图监控
---

# 系统视图监控

> **核心问题**：PostgreSQL 提供了丰富的系统视图来暴露数据库内部状态，但这些视图众多且字段含义晦涩。如何系统地利用这些视图，快速定位连接瓶颈、表膨胀、索引失效、复制延迟等常见问题？

## 1. pg_stat_activity：连接和查询监控

`pg_stat_activity` 是最常用的系统视图，每个 PostgreSQL 后端进程对应一行，展示当前所有活跃和空闲连接的状态。

### 关键字段说明

| 字段 | 含义 | Java 开发者关注点 |
|------|------|------------------|
| `pid` | 后端进程 ID | 终止卡死连接时使用 |
| `state` | 活跃/空闲/空闲事务 | 空闲事务可能持有锁不释放 |
| `query` | 当前执行的 SQL | 排查慢查询 |
| `wait_event_type` | 等待事件类型 | 锁等待、IO 等待等 |
| `xact_start` | 事务开始时间 | 检测长事务 |
| `query_start` | 查询开始时间 | 检测慢查询 |
| `backend_start` | 后端启动时间 | 连接池健康检查 |

### 实用查询

```sql
-- 1. 查看当前所有活跃连接及执行时间
SELECT pid,
       usename,
       application_name,
       client_addr,
       state,
       now() - query_start AS query_duration,
       wait_event_type,
       wait_event,
       LEFT(query, 100) AS query_preview
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY query_duration DESC;

-- 2. 检测长事务（超过 5 分钟）
SELECT pid,
       usename,
       now() - xact_start AS xact_duration,
       now() - query_start AS query_duration,
       state,
       LEFT(query, 100) AS query_preview
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
  AND now() - xact_start > interval '5 minutes'
ORDER BY xact_duration DESC;

-- 3. 检测空闲事务（持有锁不释放，常见于 Spring 事务未提交）
SELECT pid,
       usename,
       state,
       now() - state_change AS idle_duration,
       LEFT(query, 100) AS last_query
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND now() - state_change > interval '1 minute'
ORDER BY idle_duration DESC;

-- 4. 查看各状态连接数统计
SELECT state, COUNT(*) AS cnt
FROM pg_stat_activity
GROUP BY state;

-- 5. 终止卡死连接（需谨慎）
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND now() - state_change > interval '10 minutes';
```

## 2. pg_stat_database：数据库级统计

`pg_stat_database` 每个数据库一行，提供事务提交/回滚数、缓存命中、死锁等全局统计。

```sql
-- 6. 缓存命中率（低于 99% 需要关注 shared_buffers）
SELECT datname,
       blks_hit,
       blks_read,
       ROUND(blks_hit::numeric / NULLIF(blks_hit + blks_read, 0) * 100, 2) AS hit_ratio_pct,
       xact_commit,
       xact_rollback,
       deadlocks,
       temp_files,
       pg_size_pretty(temp_bytes) AS temp_bytes
FROM pg_stat_database
WHERE datname NOT LIKE 'template%'
ORDER BY hit_ratio_pct ASC;
```

> **告警阈值建议**：缓存命中率 < 99% 表示 shared_buffers 可能不足；死锁 > 0 立即告警；临时文件持续增长说明 work_mem 不足。

## 3. pg_stat_user_tables：表级统计

```sql
-- 7. 表扫描方式分析：顺序扫描 vs 索引扫描
SELECT schemaname,
       relname,
       seq_scan,
       idx_scan,
       CASE WHEN seq_scan + idx_scan > 0
            THEN ROUND(idx_scan::numeric / (seq_scan + idx_scan) * 100, 2)
            ELSE 0 END AS idx_scan_ratio_pct,
       n_live_tup,
       n_dead_tup,
       CASE WHEN n_live_tup > 0
            THEN ROUND(n_dead_tup::numeric / n_live_tup * 100, 2)
            ELSE 0 END AS dead_tuple_ratio_pct,
       last_vacuum,
       last_autovacuum
FROM pg_stat_user_tables
ORDER BY seq_scan DESC
LIMIT 20;

-- 8. 死元组占比最高的表（膨胀预警）
SELECT schemaname,
       relname,
       n_live_tup,
       n_dead_tup,
       ROUND(n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) * 100, 2) AS dead_pct,
       last_autovacuum
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY dead_pct DESC
LIMIT 20;
```

> **告警阈值建议**：dead_tuple_ratio > 20% 需要关注 Autovacuum 是否正常运行；seq_scan 大量出现且表行数 > 10 万，检查是否缺少索引。

## 4. pg_stat_user_indexes：索引使用统计

```sql
-- 9. 未使用的索引（浪费空间和写入性能）
SELECT schemaname,
       relname AS table_name,
       indexrelname AS index_name,
       idx_scan,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND indexrelname NOT LIKE '%pkey%'
ORDER BY pg_relation_size(indexrelid) DESC;

-- 10. 索引使用率排名
SELECT schemaname,
       relname,
       indexrelname,
       idx_scan,
       idx_tup_read,
       idx_tup_fetch,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC
LIMIT 20;
```

## 5. pg_stat_bgwriter：后台写入统计

```sql
-- 11. 后台写入统计概览
SELECT checkpoints_timed,
       checkpoints_req,
       buffers_checkpoint,
       buffers_clean,
       buffers_backend,
       buffers_alloc,
       ROUND(checkpoints_req::numeric / NULLIF(checkpoints_timed + checkpoints_req, 0) * 100, 2) AS forced_checkpoint_pct
FROM pg_stat_bgwriter;
```

| 指标 | 含义 | 告警阈值 |
|------|------|---------|
| `checkpoints_req` vs `checkpoints_timed` | 强制检查点占比 | 强制检查点占比 > 50% 说明 checkpoint_timeout 或 max_wal_size 过小 |
| `buffers_backend` | 后端直接写出的缓冲区 | 占总缓冲区比例高说明 bgwriter 来不及清理 |
| `buffers_alloc` | 新分配的缓冲区数 | 持续高增长可能表示 shared_buffers 不足 |

## 6. pg_stat_replication：复制延迟监控

```sql
-- 12. 复制延迟监控
SELECT client_addr,
       application_name,
       state,
       sync_state,
       sent_lsn,
       write_lsn,
       flush_lsn,
       replay_lsn,
       pg_wal_lsn_diff(sent_lsn, replay_lsn) AS replay_lag_bytes,
       pg_size_pretty(pg_wal_lsn_diff(sent_lsn, replay_lsn)) AS replay_lag_pretty
FROM pg_stat_replication;
```

## 7. 常用监控 SQL 速查

```sql
-- 13. 表空间使用情况
SELECT schemaname,
       relname,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
       pg_size_pretty(pg_relation_size(relid)) AS table_size,
       pg_size_pretty(pg_indexes_size(relid)) AS indexes_size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;

-- 14. 事务 ID 年龄（接近 2^31 需要紧急 VACUUM FREEZE）
SELECT datname,
       age(datfrozenxid) AS xid_age,
       ROUND(age(datfrozenxid)::numeric / 2147483647 * 100, 2) AS age_pct
FROM pg_database
ORDER BY xid_age DESC;

-- 15. 锁等待分析
SELECT blocked.pid AS blocked_pid,
       blocked.query AS blocked_query,
       blocking.pid AS blocking_pid,
       blocking.query AS blocking_query,
       now() - blocked.query_start AS wait_duration
FROM pg_stat_activity blocked
JOIN pg_locks bl ON bl.pid = blocked.pid
JOIN pg_locks kl ON kl.locktype = bl.locktype
  AND kl.database IS NOT DISTINCT FROM bl.database
  AND kl.relation IS NOT DISTINCT FROM bl.relation
  AND kl.page IS NOT DISTINCT FROM bl.page
  AND kl.tuple IS NOT DISTINCT FROM bl.tuple
  AND kl.transactionid IS NOT DISTINCT FROM bl.transactionid
  AND kl.classid IS NOT DISTINCT FROM bl.classid
  AND kl.objid IS NOT DISTINCT FROM bl.objid
  AND kl.objsubid IS NOT DISTINCT FROM bl.objsubid
  AND kl.pid != bl.pid
JOIN pg_stat_activity blocking ON blocking.pid = kl.pid
WHERE NOT bl.granted
ORDER BY wait_duration DESC;

-- 16. 当前 WAL 生成速率
SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0')::numeric / 1024 / 1024 AS wal_mb_generated;

-- 17. 表的膨胀估算（基于 pgstattuple 扩展，需安装）
-- CREATE EXTENSION IF NOT EXISTS pgstattuple;
-- SELECT * FROM pgstattuple('your_table_name');
```

## 监控视图关系图

```
pg_stat_activity        → 连接级（每进程一行）
pg_stat_database        → 数据库级（每库一行）
pg_stat_user_tables     → 表级（每表一行）
pg_stat_user_indexes    → 索引级（每索引一行）
pg_stat_bgwriter        → 全局单行
pg_stat_replication     → 复制连接（每个 standby 一行）
pg_stat_wal             → WAL 统计（PG 10+）
pg_stat_progress_*      → 长操作进度（VACUUM、CREATE INDEX 等）
```

## 小结

系统视图是 PostgreSQL 监控的基石。建议将上述 SQL 集成到监控系统（Prometheus exporter 或自定义采集脚本），定期采集并设置告警阈值。下一章我们将深入 `pg_stat_statements`，从 SQL 维度进行更精细的性能分析。
