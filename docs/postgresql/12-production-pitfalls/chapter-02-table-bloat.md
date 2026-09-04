---
doc_id: pg-table-bloat
title: 表膨胀检测与治理
---

# 表膨胀检测与治理

> **核心问题**：PostgreSQL 的 MVCC 机制在更新和删除时不会立即回收空间，导致表文件不断膨胀，占用大量磁盘空间并严重降低查询性能。

## 1. 表膨胀的成因

### MVCC 旧版本堆积

PostgreSQL 使用多版本并发控制（MVCC），每次 UPDATE 会创建新行版本，旧行版本由 VACUUM 清理。如果 VACUUM 不及时，旧版本就会堆积。

```sql
-- 模拟膨胀：大量 UPDATE 但 VACUUM 跟不上
UPDATE orders SET status = 'processed' WHERE created_at < '2026-01-01';
-- 每行更新都会产生一个 dead tuple（旧行版本）
```

### 长事务阻止 VACUUM

长事务持有的快照会阻止 VACUUM 清理旧版本——VACUUM 不确定长事务是否还需要这些旧数据。

```sql
-- 长事务示例：一个忘记提交的事务
BEGIN;
SELECT * FROM orders WHERE id = 12345;
-- 开发者忘记 COMMIT，事务一直挂着
-- 此时 VACUUM 无法清理 orders 表中的任何旧行
```

### 其他膨胀因素

- **高并发频繁更新**：更新频率远高于 VACUUM 频率
- **fillfactor 设置不当**：默认 100% 导致 HOT 更新无法生效
- **没有索引的列频繁更新**：无法使用 HOT（Heap Only Tuple）优化

## 2. 膨胀检测方法

### 使用 pgstattuple 扩展（精确）

```sql
-- 安装扩展
CREATE EXTENSION IF NOT EXISTS pgstattuple;

-- 检查单个表的膨胀情况
SELECT
    table_len,                           -- 表物理大小
    tuple_count,                         -- 活跃行数
    tuple_len,                           -- 活跃数据大小
    dead_tuple_count,                    -- 死行数
    dead_tuple_len,                      -- 死行占用空间
    free_space,                          -- 空闲空间
    round(dead_tuple_len::numeric / table_len * 100, 2) AS dead_pct,
    round(free_space::numeric / table_len * 100, 2) AS free_pct
FROM pgstattuple('orders');

-- 输出示例：
--  table_len  | tuple_count | dead_tuple_count | dead_pct | free_pct
-- ------------+-------------+------------------+----------+---------
--  1073741824 |    5000000  |         2000000  |    35.2  |    12.8
```

### 使用估算公式（无需扩展）

```sql
-- 基于 pg_stat_user_tables 的膨胀估算
SELECT
    schemaname,
    relname,
    n_live_tup,
    n_dead_tup,
    CASE WHEN n_live_tup > 0
         THEN round(n_dead_tup::numeric / n_live_tup * 100, 2)
         ELSE 0
    END AS dead_pct,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_dead_tup DESC
LIMIT 20;
```

**膨胀判断标准**：
- dead_pct > 20%：轻度膨胀，关注即可
- dead_pct > 50%：中度膨胀，建议治理
- dead_pct > 100%：严重膨胀，尽快处理

## 3. 治理方案对比

| 方案 | 锁表 | 在线 | 额外空间 | 适用场景 |
| :-- | :-- | :-- | :-- | :-- |
| `VACUUM FULL` | ACCESS EXCLUSIVE 锁 | ❌ | 表大小的 2 倍 | 小表、维护窗口期 |
| `pg_repack` | 短暂排他锁 | ✅ | 表大小的 1.5 倍 | 生产环境大表 |
| `pg_squeeze` | 短暂排他锁 | ✅ | 表大小的 1.5 倍 | 需要逻辑复制支持 |
| `CLUSTER` | ACCESS EXCLUSIVE 锁 | ❌ | 表大小的 2 倍 | 需要按索引重排数据 |

## 4. pg_repack 使用详解

pg_repack 是生产环境治理膨胀的首选方案，支持在线重建且不阻塞 DML 操作。

```bash
# 安装
# Ubuntu/Debian
apt install postgresql-16-repack

# CentOS/RHEL
yum install pg_repack_16

# 在数据库中创建扩展
psql -c "CREATE EXTENSION pg_repack;"
```

```bash
# 重建整个表（包括索引）
pg_repack -d mydb -t orders

# 仅重建索引
pg_repack -d mydb -t orders --only-indexes

# 并行重建（加快速度）
pg_repack -d mydb -t orders --jobs 4

# 指定表空间
pg_repack -d mydb -t orders --tablespace ssd_space
```

**pg_repack 工作原理**：
1. 创建一个与原表结构相同的新表
2. 在新表上创建触发器，捕获原表的增量变更
3. 将原表数据复制到新表
4. 应用增量变更
5. 短暂锁定，交换表名（毫秒级）
6. 清理旧表

```sql
-- 查看 pg_repack 进度
SELECT * FROM pg_stat_activity WHERE query LIKE '%pg_repack%';
```

## 5. 长事务检测和终止

```sql
-- 查看当前所有长事务（执行时间超过 5 分钟）
SELECT
    pid,
    usename,
    application_name,
    client_addr,
    now() - xact_start AS duration,
    state,
    query,
    wait_event_type,
    wait_event
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
  AND now() - xact_start > interval '5 minutes'
  AND pid != pg_backend_pid()
ORDER BY duration DESC;

-- 终止长事务
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
  AND now() - xact_start > interval '1 hour'
  AND pid != pg_backend_pid();
```

```ini
# 限制事务最大执行时间（可选，需谨慎）
# 建议在应用层控制，而不是数据库层
# statement_timeout = 300000  -- 5 分钟后终止 SQL
# idle_in_transaction_session_timeout = 60000  -- 空闲事务 1 分钟后终止
```

## 6. autovacuum 调优实战

### 针对高更新量大表

```sql
-- 为特定表设置独立的 autovacuum 参数
ALTER TABLE orders SET (
    autovacuum_vacuum_scale_factor = 0.01,    -- 死行 1% 时触发（默认 20%）
    autovacuum_analyze_scale_factor = 0.005,  -- 变更 0.5% 时触发分析
    autovacuum_vacuum_cost_delay = 2,         -- 降低 I/O 影响
    fillfactor = 85                           -- 留 15% 空间给 HOT 更新
);
```

### 全局 autovacuum 调优

```ini
# postgresql.conf

# 工作进程数（大表多时适当增加）
autovacuum_max_workers = 4

# 触发阈值
autovacuum_vacuum_scale_factor = 0.05
autovacuum_analyze_scale_factor = 0.02

# I/O 控制
autovacuum_vacuum_cost_delay = 2ms
autovacuum_vacuum_cost_limit = 1000

# 对大表的 vacuum 超时保护（PG 12+）
autovacuum_vacuum_insert_scale_factor = 0.1
autovacuum_vacuum_insert_threshold = 1000
```

### fillfactor 与 HOT 更新

```sql
-- 当 UPDATE 不修改索引列时，HOT 更新可以避免索引膨胀
-- fillfactor 设置为 85-90，为 HOT 更新留出空间
ALTER TABLE orders SET (fillfactor = 85);

-- 验证 HOT 更新是否生效
SELECT relname, n_tup_hot_upd, n_tup_upd
FROM pg_stat_user_tables
WHERE relname = 'orders';
-- n_tup_hot_upd 应该接近 n_tup_upd
```

## 7. 预防措施

1. **保持 autovacuum 开启**：绝不要关闭 autovacuum
2. **高更新表设独立参数**：降低 `autovacuum_vacuum_scale_factor` 到 0.01-0.05
3. **监控长事务**：设置告警，超过 30 分钟的长事务需要人工介入
4. **合理设置 fillfactor**：频繁更新的表设置 85-90
5. **使用 pg_repack 定期维护**：每月或每季度对大表执行一次在线重建
6. **监控表膨胀**：每周运行膨胀检测脚本，及时发现和治理
7. **避免大批量 UPDATE**：使用分批更新，每批 1000-5000 行，避免单次大事务
