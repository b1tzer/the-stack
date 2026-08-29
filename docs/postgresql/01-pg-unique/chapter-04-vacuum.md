---
doc_id: pg-vacuum
title: VACUUM 机制与调优
---

# VACUUM 机制与调优

> **核心问题**：VACUUM 是什么？为什么 PG 需要它？如何配置 autovacuum？什么时候该手动干预？

## 1. 为什么需要 VACUUM？

上一章讲了 PG 的 MVCC 机制：UPDATE 不覆盖原值，而是插入新行、标记旧行过期（Dead Tuple）。DELETE 也一样，只标记不删除。

问题在于：**Dead Tuple 不会自动消失**。它们一直留在表文件里，占用磁盘空间。如果没有机制清理，表会无限膨胀，查询越来越慢。

**VACUUM 就是 PG 的垃圾回收器**。它的职责是找到 Dead Tuple，把它们占用的空间标记为"可复用"（或彻底回收）。

```
没有 VACUUM 的表：
┌──────────────────────────────────────────────────┐
│ 活跃行 │ Dead │ Dead │ 活跃行 │ Dead │ Dead │ Dead │ ...
└──────────────────────────────────────────────────┘
         ↑ 越来越多的废弃数据，查询越来越慢

VACUUM 之后：
┌──────────────────────────────────────────────────┐
│ 活跃行 │ 可复用 │ 可复用 │ 活跃行 │ 可复用 │ ...
└──────────────────────────────────────────────────┘
         ↑ 空间标记为可复用，新数据可以插入这些位置
```

> **与 MySQL 的区别**：MySQL (InnoDB) 的旧版本存在 Undo Log 里，事务提交后自动回收，不需要手动 VACUUM。PG 把旧版本留在堆表里，好处是读性能稳定（不用回溯 Undo Log），代价是需要 VACUUM 清理。

## 2. VACUUM 的几种形式

PG 提供了多种 VACUUM 命令，适用于不同场景：

| 命令 | 做了什么 | 锁表？ | 空间归还 OS？ | 适用场景 |
|------|---------|--------|-------------|---------|
| `VACUUM` | 清理 Dead Tuple，标记空间可复用 | ❌ 不锁表 | ❌ 不归还 | 日常维护（首选） |
| `VACUUM FULL` | 重写整张表，彻底回收空间 | ✅ 锁表 | ✅ 归还 | 表膨胀严重，低峰期执行 |
| `ANALYZE` | 更新统计信息（不清理数据） | ❌ | — | 大量数据变化后 |
| `VACUUM ANALYZE` | 清理 + 更新统计 | ❌ | ❌ | 推荐的日常组合 |
| `VACUUM FREEZE` | 冻结旧事务 ID | ❌ | ❌ | 事务 ID 年龄过大时 |

**关键区别**：
- **VACUUM**（普通）：把 Dead Tuple 的空间标记为"可复用"，但**不会把空间还给操作系统**。表文件大小不变，只是里面的空位可以被新数据填充。
- **VACUUM FULL**：重写整个表文件，把空间**彻底归还给操作系统**。表文件缩小，但执行期间**锁表**，所有读写操作都被阻塞。

> **生产环境建议**：日常维护用 `VACUUM`（不锁表）。表膨胀严重需要回收空间时，用 `pg_repack` 替代 `VACUUM FULL`（在线重建，不锁表）。

## 3. Autovacuum：自动清理

手动执行 VACUUM 不现实，PG 默认开启了 **autovacuum**——一个后台进程，自动检测需要清理的表并执行 VACUUM。

### 3.1 工作原理

autovacuum 定期扫描所有表，检查 Dead Tuple 数量是否超过阈值。超过就执行 VACUUM。

**触发条件**：`dead_tuples > threshold + scale_factor × total_tuples`

```ini
# postgresql.conf 中的 autovacuum 配置

# 基本开关
autovacuum = on                    # 默认开启，不要关闭！
autovacuum_max_workers = 3         # 同时运行几个 autovacuum 进程
autovacuum_naptime = 1min          # 每隔多久扫描一次

# VACUUM 触发条件
autovacuum_vacuum_threshold = 50   # 最少 50 个 Dead Tuple 才考虑
autovacuum_vacuum_scale_factor = 0.2  # 超过 20% 的行是 Dead Tuple 时触发

# ANALYZE 触发条件
autovacuum_analyze_threshold = 50
autovacuum_analyze_scale_factor = 0.1
```

### 3.2 为什么大表需要降低 scale_factor？

默认配置的触发公式：`dead_tuples > 50 + 0.2 × total_tuples`

| 表大小 | 触发阈值 | 说明 |
|--------|---------|------|
| 1,000 行 | 250 个 Dead Tuple | 合理 |
| 100 万行 | 20 万个 Dead Tuple | **太大了！** 20 万个废弃行才会触发清理 |
| 1 亿行 | 2000 万个 Dead Tuple | **灾难级**，表已经严重膨胀 |

**解决方案**：对高频更新的大表，降低 `scale_factor`：

```sql
-- 高频更新的大表：1% 行变化就触发，不限速
ALTER TABLE hot_table SET (
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_vacuum_threshold = 100,
    autovacuum_analyze_scale_factor = 0.01,
    autovacuum_vacuum_cost_delay = 0  -- 不限速，尽快清理
);

-- 只读表：禁用 autovacuum（不会产生 Dead Tuple，浪费资源）
ALTER TABLE static_data SET (
    autovacuum_enabled = false
);

-- 查看表级别的 autovacuum 参数
SELECT reloptions FROM pg_class WHERE relname = 'hot_table';
```

## 4. VACUUM 的 IO 控制：代价延迟机制

VACUUM 是 IO 密集型操作。如果清理速度太快，会抢占业务查询的 IO 带宽；太慢又跟不上 Dead Tuple 的产生速度。

PG 用 **代价延迟（Cost-based Throttling）** 机制来平衡：

### 4.1 工作原理

```text
VACUUM 扫描数据页 → 每读/写一个页面，累积"代价"
                    → 代价达到 vacuum_cost_limit 时
                    → 暂停 vacuum_cost_delay 毫秒
                    → 代价清零，继续扫描
                    → 循环...
```

代价计算规则：

| 操作 | 代价 | 说明 |
|------|------|------|
| 读到已在缓存中的页面 | `vacuum_cost_page_hit = 1` | 代价最低 |
| 读到不在缓存中的页面 | `vacuum_cost_page_miss = 10` | 需要磁盘 IO |
| 修改（标记为可复用） | `vacuum_cost_page_dirty = 20` | 代价最高 |

```ini
# 全局默认值
vacuum_cost_delay = 2ms           # 暂停时间
vacuum_cost_limit = 200           # 代价阈值

# autovacuum 可以单独设置（覆盖全局）
autovacuum_vacuum_cost_delay = 2ms
autovacuum_vacuum_cost_limit = -1  # -1 表示用全局 vacuum_cost_limit
```

### 4.2 调优原则

| 场景 | 调整方式 |
|------|---------|
| VACUUM 太慢，跟不上 Dead Tuple 产生 | 降低 `cost_delay` 或提高 `cost_limit` |
| VACUUM 影响业务 IO | 提高 `cost_delay` 或降低 `cost_limit` |
| 高频更新的关键表 | 表级设置 `autovacuum_vacuum_cost_delay = 0`（不限速） |

## 5. 监控 VACUUM 进度

VACUUM 执行过程中，可以通过系统视图查看实时进度：

```sql
-- 查看正在执行的 VACUUM 进度（PG 12+）
SELECT
    pid,
    phase,                    -- 当前阶段：scanning heap / vacuuming indexes / vacuuming heap
    heap_blks_total,          -- 总页面数
    heap_blks_scanned,        -- 已扫描页面数
    heap_blks_vacuumed,       -- 已清理页面数
    index_vacuum_count,       -- 已清理的索引数
    max_dead_tuples,          -- 最大容纳的 Dead Tuple 数
    num_dead_tuples           -- 当前已收集的 Dead Tuple 数
FROM pg_stat_progress_vacuum;

-- 查看 autovacuum 工作进程
SELECT pid, query, wait_event_type, state
FROM pg_stat_activity
WHERE backend_type = 'autovacuum worker';
```

## 6. VACUUM FREEZE：事务 ID 回卷防护

VACUUM FREEZE 是一种特殊的 VACUUM，它的目的不是清理 Dead Tuple，而是**冻结旧事务 ID**，防止事务 ID 回卷（详见[上一章 §6](./chapter-03-mvcc.md#xid-wraparound)）。

```text
正常 VACUUM：清理 Dead Tuple，释放空间
VACUUM FREEZE：把旧行的 xmin 改为特殊的 FrozenTransactionId（2），表示"已冻结，不再参与可见性判断"
```

**什么时候需要 VACUUM FREEZE？**

- 事务 ID 年龄超过 5 亿（告警阈值）
- autovacuum 因故未能及时执行（被长事务阻塞等）
- 大表长期没有被 autovacuum 扫描到

```sql
-- 查看事务 ID 年龄
SELECT
    datname,
    age(datfrozenxid) AS xid_age,
    2^31 - age(datfrozenxid) AS remaining
FROM pg_database
ORDER BY xid_age DESC;

-- 手动执行 FREEZE
VACUUM FREEZE large_table;

-- 整个数据库
vacuumdb --freeze --all
```

## 7. 日常维护脚本

### 7.1 膨胀率监控

```sql
-- 查看每个表的膨胀情况
SELECT 
    schemaname, 
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
    n_live_tup,
    n_dead_tup,
    ROUND(n_dead_tup * 100.0 / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_pct,
    last_vacuum,
    last_autovacuum
FROM pg_stat_user_tables
WHERE n_dead_tup > 0
ORDER BY n_dead_tup DESC
LIMIT 20;
```

### 7.2 分批清理过期数据

大量删除数据时，不要一次性 DELETE 几百万行——这会产生一个超长事务，阻塞 VACUUM。应该分批删除：

```sql
-- 分批删除，每批 1000 行，批间暂停 100ms
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
        PERFORM pg_sleep(0.1);  -- 暂停 100ms，让 VACUUM 和其他事务有机会执行
        RAISE NOTICE 'Deleted % rows', deleted;
    END LOOP;
END $$;
```

> **为什么分批？** 一次性删除几百万行会：① 产生大量 Dead Tuple，② 持有行锁时间过长，③ 事务太大导致 WAL 暴增。分批删除避免这些问题。

## 8. 最佳实践总结

| 实践 | 说明 |
|------|------|
| **不要关闭 autovacuum** | 默认开启，关闭会导致表膨胀和事务 ID 回卷 |
| **大表降低 scale_factor** | `autovacuum_vacuum_scale_factor = 0.01`（1% 就触发） |
| **高频表取消 IO 限制** | `autovacuum_vacuum_cost_delay = 0` |
| **避免长事务** | 设置 `idle_in_transaction_session_timeout = '5min'` |
| **大量删除用分批** | 不要一次性 DELETE 几百万行 |
| **严重膨胀用 pg_repack** | 替代 VACUUM FULL，在线重建不锁表 |
| **监控 Dead Tuple** | 定期查询 `pg_stat_user_tables` 的 `n_dead_tup` |
| **监控事务 ID 年龄** | 告警阈值：5 亿 |
