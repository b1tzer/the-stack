---
doc_id: pg-plan-flip
title: 执行计划翻转与优化器陷阱
---

# 执行计划翻转与优化器陷阱

> **核心问题**：相同的 SQL 在不同时间点可能产生完全不同的执行计划，导致原本毫秒级的查询突然变成秒级甚至分钟级，线上性能断崖式下跌。

## 1. 什么是执行计划翻转（Plan Flip）

执行计划翻转指同一条 SQL 语句的执行计划在没有 DDL 变更的情况下发生突变。典型表现：

- 昨天 50ms 的查询，今天突然变成 30s
- 应用重启后查询变慢（prepared statement 重建）
- 数据量增长到某个阈值后，索引扫描变成全表扫描

```sql
-- 使用 EXPLAIN 验证当前执行计划
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM orders WHERE user_id = 12345 AND status = 'pending';
```

## 2. 触发原因

### 统计信息过期

PostgreSQL 优化器依赖 `pg_statistic` 表中的统计信息来估算行数和选择率。统计信息过期会导致估算偏差。

```sql
-- 查看统计信息的最后更新时间
SELECT
    relname,
    last_analyze,
    last_autoanalyze,
    n_live_tup,
    n_dead_tup,
    n_mod_since_analyze  -- 自上次 ANALYZE 后的变更行数
FROM pg_stat_user_tables
WHERE relname = 'orders';

-- 如果 n_mod_since_analyze 很大，说明统计信息可能过期
```

### 参数嗅探

使用 prepared statement 时，执行计划在第一次 prepare 时生成并缓存。如果首次执行时传入的参数不具代表性，后续所有执行都会使用这个"坏计划"。

```sql
-- 示例：首次 prepare 时 user_id = 0（几乎无数据）
PREPARE find_orders(int) AS
SELECT * FROM orders WHERE user_id = $1;

-- 第一次执行：user_id = 0 → 只有 3 行 → 优化器选择全表扫描
EXECUTE find_orders(0);

-- 后续执行：user_id = 12345 → 有 50 万行 → 但仍然用全表扫描！
EXECUTE find_orders(12345);
```

### 数据分布变化

```sql
-- 某列的数据分布严重倾斜
SELECT status, count(*) FROM orders GROUP BY status ORDER BY count DESC;

--  status    |  count
-- ----------+--------
--  completed | 990000
--  pending   |   8000
--  cancelled |   2000

-- 查询 pending 时应该走索引，查询 completed 时应该走全表扫描
-- 但如果统计信息不准确，优化器可能做出错误判断
```

## 3. 检测方法

### pg_stat_statements 对比

```sql
-- 安装扩展
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 找出执行时间波动大的查询
SELECT
    queryid,
    query,
    calls,
    round(total_exec_time::numeric, 2) AS total_time_ms,
    round(mean_exec_time::numeric, 2) AS avg_time_ms,
    round(max_exec_time::numeric, 2) AS max_time_ms,
    round(stddev_exec_time::numeric, 2) AS stddev_ms,
    rows
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat%'
  AND calls > 100
ORDER BY mean_exec_time DESC
LIMIT 20;
```

### auto_explain 自动记录慢查询计划

```ini
# postgresql.conf
shared_preload_libraries = 'pg_stat_statements,auto_explain'

# 当查询超过 1 秒时自动记录执行计划
auto_explain.log_min_duration = '1s'
auto_explain.log_analyze = on
auto_explain.log_buffers = on
auto_explain.log_format = 'text'
```

```sql
-- 在会话级别开启（不重启数据库）
SET auto_explain.log_min_duration = '1s';
SET auto_explain.log_analyze = on;
```

## 4. 解决方案

### 使用 pg_hint_plan 固定执行计划

pg_hint_plan 通过 SQL 注释强制优化器使用指定的执行计划。

```sql
-- 安装
CREATE EXTENSION pg_hint_plan;

-- 强制使用索引扫描
/*+ IndexScan(orders idx_orders_user_id) */
SELECT * FROM orders WHERE user_id = 12345 AND status = 'pending';

-- 强制使用特定连接顺序
/*+ Leading((u o)) HashJoin(u o) */
SELECT * FROM users u JOIN orders o ON o.user_id = u.id
WHERE u.id = 12345;

-- 强制全表扫描（当索引扫描反而慢时）
/*+ SeqScan(orders) */
SELECT * FROM orders WHERE status = 'completed';
```

### 使用 PLAN CACHE MODE（PG 12+）

```sql
-- 强制每次执行都重新生成计划（避免参数嗅探）
SET plan_cache_mode = 'force_custom_plan';

-- 对特定查询使用
PREPARE find_orders(int) AS
SELECT * FROM orders WHERE user_id = $1;

-- 为该会话强制自定义计划
SET LOCAL plan_cache_mode = 'force_custom_plan';
EXECUTE find_orders(12345);
```

### 手动更新统计信息

```sql
-- 对特定表更新统计信息
ANALYZE orders;

-- 对特定列增加统计精度（默认 100，最大 10000）
ALTER TABLE orders ALTER COLUMN user_id SET STATISTICS 1000;
ALTER TABLE orders ALTER COLUMN status SET STATISTICS 500;
ANALYZE orders;
```

## 5. 统计信息调优

```ini
# postgresql.conf

# 全局统计精度（默认 100）
# 提高后 ANALYZE 会更慢但估算更准
default_statistics_target = 200
```

```sql
-- 针对特定高基数列提高统计精度
ALTER TABLE orders ALTER COLUMN user_id SET STATISTICS 1000;
ALTER TABLE orders ALTER COLUMN created_at SET STATISTICS 500;

-- 查看列的统计信息
SELECT
    attname,
    n_distinct,          -- 不同值的估计数
    most_common_vals,    -- 最常见的值
    most_common_freqs,   -- 最常见值的频率
    histogram_bounds     -- 直方图边界
FROM pg_stats
WHERE tablename = 'orders' AND attname = 'user_id';
```

## 6. 绑定变量与 Prepared Statement

### Java 应用中的问题

```java
// JDBC 默认使用 prepared statement
// 首次执行时的参数会"污染"缓存的执行计划

// 问题代码
PreparedStatement ps = conn.prepareStatement(
    "SELECT * FROM orders WHERE user_id = ? AND status = ?");
ps.setInt(1, 0);        // 首次：测试用户，几乎无数据
ps.setString(2, "pending");
ps.executeQuery();

// 后续所有执行都可能使用首次的"坏计划"
ps.setInt(1, 12345);    // 真实用户，大量数据
ps.setString(2, "pending");
ps.executeQuery();       // 可能很慢！
```

```java
// 解决方案 1：在连接 URL 中禁用 prepared statement
// jdbc:postgresql://host/db?prepareThreshold=0

// 解决方案 2：使用 pg_hint_plan 在 SQL 中固定计划
PreparedStatement ps = conn.prepareStatement(
    "/*+ IndexScan(orders idx_orders_user_id) */ " +
    "SELECT * FROM orders WHERE user_id = ? AND status = ?");

// 解决方案 3：设置 plan_cache_mode
stmt.execute("SET plan_cache_mode = 'force_custom_plan'");
```

## 7. 真实案例

### 背景

某 SaaS 平台的订单查询接口，正常响应时间 P99 为 100ms。某次发布后，P99 突然飙升到 15s。

### 排查过程

```sql
-- 1. 通过 pg_stat_statements 发现该查询平均耗时异常
SELECT queryid, query, mean_exec_time, calls
FROM pg_stat_statements
WHERE query LIKE '%orders%user_id%'
ORDER BY mean_exec_time DESC;

-- 2. 查看执行计划，发现从 Index Scan 变成了 Seq Scan
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 12345 AND status = 'pending';
-- 结果：Seq Scan on orders  (cost=0.00..185432.00 rows=1 width=...)

-- 3. 查看统计信息
SELECT last_autoanalyze, n_mod_since_analyze
FROM pg_stat_user_tables WHERE relname = 'orders';
-- last_autoanalyze: 3 天前
-- n_mod_since_analyze: 500 万（大量变更未统计）

-- 4. 手动更新统计信息
ANALYZE orders;

-- 5. 再次查看执行计划 → 恢复 Index Scan
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 12345 AND status = 'pending';
-- Index Scan using idx_orders_user_id on orders
```

### 根因

发布时批量导入了 500 万条订单数据，触发了大量 `n_mod_since_analyze`。autovacuum 的 ANALYZE 任务被排队等待，未能及时更新统计信息。优化器基于过期统计信息估算 `user_id = 12345` 的行数为 1 行（实际 5000 行），选择了全表扫描。

### 修复

```ini
# 降低 ANALYZE 触发阈值
autovacuum_analyze_scale_factor = 0.02   # 从默认 0.1 降低
autovacuum_analyze_threshold = 50

# 增加 autovacuum 工作进程
autovacuum_max_workers = 4
```

```sql
-- 对关键查询列提高统计精度
ALTER TABLE orders ALTER COLUMN user_id SET STATISTICS 1000;
ALTER TABLE orders ALTER COLUMN status SET STATISTICS 500;
ANALYZE orders;
```
