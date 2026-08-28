---
doc_id: pg-vacuum
title: VACUUM 机制与调优
---

# VACUUM 机制与调优

> **核心问题**：VACUUM 有哪几种形式？如何配置 autovacuum？如何处理事务 ID 回卷？

## 1. VACUUM 的几种形式

| 命令 | 作用 | 特点 | 适用场景 |
|------|------|------|---------|
| `VACUUM table_name` | 清理 Dead Tuple，标记空间可复用 | **不锁表**，空间不归还 OS | 日常维护 |
| `VACUUM FULL table_name` | 重写整张表，彻底回收空间 | **锁表**，空间归还 OS | 表膨胀严重时，业务低峰期 |
| `ANALYZE table_name` | 更新统计信息，优化查询计划 | 不清理数据，只更新统计 | 大量数据变化后 |
| `VACUUM ANALYZE` | 同时执行清理和统计更新 | 推荐日常使用 | 定期维护 |
| `VACUUM FREEZE` | 强制冻结事务 ID | 防止事务 ID 回卷 | 事务 ID 年龄过大时 |

> **为什么 VACUUM FULL 要慎用**：VACUUM FULL 会锁表，期间所有读写操作都被阻塞。对大表执行可能持续数小时，导致业务中断。替代方案：使用 `pg_repack` 工具在线重建表（不锁表）。

## 2. Autovacuum 配置

PostgreSQL 默认开启 `autovacuum`，自动在后台执行 VACUUM：

```ini
# 全局 autovacuum 配置
autovacuum = on
autovacuum_max_workers = 3
autovacuum_naptime = 1min

# VACUUM 触发条件：dead_tuples > threshold + scale_factor * total_tuples
autovacuum_vacuum_threshold = 50
autovacuum_vacuum_scale_factor = 0.2

# ANALYZE 触发条件：changed_tuples > threshold + scale_factor * total_tuples
autovacuum_analyze_threshold = 50
autovacuum_analyze_scale_factor = 0.1

# VACUUM 执行代价延迟（防止 IO 过载）
autovacuum_vacuum_cost_delay = 2ms
autovacuum_vacuum_cost_limit = -1  # -1 使用 vacuum_cost_limit 的值
vacuum_cost_limit = 200
vacuum_cost_page_hit = 1
vacuum_cost_page_miss = 10
vacuum_cost_page_dirty = 20
```

> **为什么大表需要降低 scale_factor**：默认 20% 对小表合理，但对百万行大表意味着需要 20 万个 Dead Tuple 才触发，可能导致表膨胀过大。高频更新的大表应适当降低阈值。

### 2.1 针对特定表调优

```sql
-- 高频更新的大表：降低触发阈值
ALTER TABLE hot_table SET (
    autovacuum_vacuum_scale_factor = 0.01,  -- 1% 行变化就触发
    autovacuum_vacuum_threshold = 100,
    autovacuum_analyze_scale_factor = 0.01,
    autovacuum_vacuum_cost_delay = 0  -- 不限速，尽快清理
);

-- 只读表：禁用 autovacuum（节省资源）
ALTER TABLE static_data SET (
    autovacuum_enabled = false
);

-- 查看表级别的 autovacuum 参数
SELECT reloptions FROM pg_class WHERE relname = 'hot_table';
```

## 3. 监控 VACUUM 进度

```sql
-- 查看正在执行的 VACUUM（PG 12+）
SELECT
    pid,
    phase,
    heap_blks_total,
    heap_blks_scanned,
    heap_blks_vacuumed,
    index_vacuum_count,
    max_dead_tuples,
    num_dead_tuples
FROM pg_stat_progress_vacuum;

-- 查看 autovacuum 工作进程
SELECT pid, query, wait_event_type, state
FROM pg_stat_activity
WHERE backend_type = 'autovacuum worker';
```

## 4. VACUUM 与 IO 控制

```ini
# VACUUM 代价延迟（控制 VACUUM 的 IO 速度，避免影响业务）
vacuum_cost_delay = 2ms          # 每超过 cost_limit 后暂停的时间
vacuum_cost_limit = 200          # 累积代价达到此值后暂停
```

> **调优原则**：如果 VACUUM 清理速度跟不上 Dead Tuple 产生速度，降低 `vacuum_cost_delay` 或提高 `vacuum_cost_limit`，让 VACUUM 更积极地工作。如果 VACUUM 影响业务 IO，增加延迟或降低限制。

## 5. 事务 ID 回卷防护

> **重要**：当事务 ID 年龄接近 2^31（约 21 亿）时，PG 会强制关闭数据库以防止事务 ID 回卷。确保 autovacuum 正常工作，`autovacuum_freeze_max_age` 默认为 2 亿，触发强制 VACUUM FREEZE。

```sql
-- 查看事务 ID 年龄（正常应 < 2 亿，告警阈值 5 亿）
SELECT
    datname,
    age(datfrozenxid) AS xid_age,
    2^31 - age(datfrozenxid) AS remaining
FROM pg_database
ORDER BY xid_age DESC;

-- 查看表的事务 ID 年龄
SELECT
    relname,
    age(relfrozenxid) AS xid_age
FROM pg_class
WHERE relkind = 'r'
ORDER BY xid_age DESC
LIMIT 20;

-- 手动执行 FREEZE（当年龄过大时）
VACUUM FREEZE large_table;
```

## 6. 日常维护脚本

```sql
-- 查看膨胀率
SELECT 
    schemaname, tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
    n_dead_tup,
    n_live_tup,
    round(n_dead_tup * 100.0 / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_pct
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;

-- 清理过期数据（分批删除，避免长事务）
DO $$
DECLARE
    batch_size INT := 1000;
    deleted INT;
BEGIN
    LOOP
        DELETE FROM audit_logs
        WHERE id IN (
            SELECT id FROM audit_logs
            WHERE created_at < NOW() - INTERVAL '1 year'
            LIMIT batch_size
        );
        GET DIAGNOSTICS deleted = ROW_COUNT;
        EXIT WHEN deleted = 0;
        PERFORM pg_sleep(0.1);
        RAISE NOTICE 'Deleted % rows', deleted;
    END LOOP;
END $$;
```

## 7. 避免表膨胀的最佳实践

| 实践 | 说明 |
|------|------|
| **确保 autovacuum 开启** | 默认开启，不要关闭 |
| **降低大表的触发阈值** | 高频更新的大表降低 `autovacuum_vacuum_scale_factor` |
| **避免长事务** | 长事务会阻止 VACUUM 清理旧版本，是表膨胀的主要原因 |
| **定期监控** | 监控 `pg_stat_user_tables` 中的 `n_dead_tup` |
| **严重膨胀时用 pg_repack** | 替代 `VACUUM FULL`，在线重建表不锁表 |

## 8. 常见问题

**Q：VACUUM 和 VACUUM FULL 有什么区别？**

> VACUUM 清理 Dead Tuple，将空间标记为可复用，不锁表，是日常维护命令；VACUUM FULL 重写整张表，彻底回收空间并归还 OS，但会锁表，期间业务不可用。生产环境表膨胀严重时，推荐用 `pg_repack` 替代 VACUUM FULL。

**Q：为什么长事务会导致表膨胀？**

> VACUUM 不能清理比最老活跃事务更新的 Dead Tuple，因为长事务可能需要读取这些旧版本数据（MVCC 保证）。长事务运行期间，所有新产生的 Dead Tuple 都无法被清理，导致表膨胀。
