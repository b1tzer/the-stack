---
doc_id: pg-stat-statements
title: pg_stat_statements 深度使用
---

# pg_stat_statements 深度使用

> **核心问题**：系统视图告诉我们"数据库整体怎么样"，但无法回答"哪条 SQL 最吃资源"。pg_stat_statements 通过归一化 SQL 文本并聚合执行统计，让我们精准定位 Top N 问题 SQL。

## 1. 安装和启用

### postgresql.conf 配置

```ini
# 必须在 shared_preload_libraries 中加载
shared_preload_libraries = 'pg_stat_statements'

# 跟踪的 SQL 条数上限（建议 10000）
pg_stat_statements.max = 10000

# 按什么归一化：none / all / top / ltop
# top: 保留 top-level 常量值；ltop: 对 top-level 保留，嵌套子查询归一化
pg_stat_statements.track = top

# 跟踪所有语句还是仅 top-level
pg_stat_statements.track_utility = on

# 计时精度
pg_stat_statements.track_planning = off   # 是否跟踪计划生成时间（PG 13+）
```

### 启用扩展

```sql
-- 创建扩展（每个数据库需要单独启用）
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 验证安装
SELECT * FROM pg_stat_statements LIMIT 1;
```

> **Java 开发者注意**：如果使用连接池（如 HikariCP），确保所有连接共享同一数据库实例的 pg_stat_statements 数据。它是实例级视图，不绑定单个连接。

## 2. Top N 慢查询分析

### 核心字段说明

| 字段 | 含义 | 分析维度 |
| :-- | :-- | :-- |
| `calls` | 执行次数 | 高频调用 |
| `total_exec_time` | 总执行时间（毫秒） | 总耗时排名 |
| `mean_exec_time` | 平均执行时间 | 单次慢查询 |
| `rows` | 返回/影响的总行数 | 大量数据扫描 |
| `shared_blks_hit` | 共享缓冲区命中 | 缓存效率 |
| `shared_blks_read` | 磁盘读取的缓冲区数 | IO 热点 |
| `wal_records` | WAL 记录数 | 写入压力 |

### 实用分析 SQL

```sql
-- 1. Top 10 总耗时最高的 SQL（优化收益最大）
SELECT queryid,
       LEFT(query, 120) AS query_preview,
       calls,
       ROUND(total_exec_time::numeric, 2) AS total_time_ms,
       ROUND(mean_exec_time::numeric, 2) AS mean_time_ms,
       ROUND(stddev_exec_time::numeric, 2) AS stddev_ms,
       rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;

-- 2. Top 10 单次最慢的 SQL（排除低频调用）
SELECT queryid,
       LEFT(query, 120) AS query_preview,
       calls,
       ROUND(mean_exec_time::numeric, 2) AS mean_time_ms,
       ROUND(max_exec_time::numeric, 2) AS max_time_ms,
       rows
FROM pg_stat_statements
WHERE calls > 10
ORDER BY mean_exec_time DESC
LIMIT 10;

-- 3. Top 10 调用频率最高的 SQL（QPS 热点）
SELECT queryid,
       LEFT(query, 120) AS query_preview,
       calls,
       ROUND(calls::numeric / EXTRACT(EPOCH FROM now() - stats_reset) * 1, 2) AS calls_per_second,
       ROUND(mean_exec_time::numeric, 2) AS mean_time_ms
FROM pg_stat_statements, pg_stat_statements_info()
ORDER BY calls DESC
LIMIT 10;
```

## 3. 逻辑读/写分析

```sql
-- 4. Top 10 逻辑读最高（IO 消耗最大）的 SQL
SELECT queryid,
       LEFT(query, 120) AS query_preview,
       calls,
       shared_blks_hit + shared_blks_read AS total_blks_accessed,
       shared_blks_hit,
       shared_blks_read,
       ROUND(shared_blks_hit::numeric / NULLIF(shared_blks_hit + shared_blks_read, 0) * 100, 2) AS hit_ratio_pct,
       ROUND(blk_read_time::numeric, 2) AS blk_read_time_ms,
       ROUND(blk_write_time::numeric, 2) AS blk_write_time_ms
FROM pg_stat_statements
WHERE shared_blks_hit + shared_blks_read > 0
ORDER BY shared_blks_hit + shared_blks_read DESC
LIMIT 10;

-- 5. Top 10 写入最重的 SQL（DML 语句）
SELECT queryid,
       LEFT(query, 120) AS query_preview,
       calls,
       rows,
       shared_blks_written,
       shared_blks_dirtied,
       wal_records,
       wal_bytes
FROM pg_stat_statements
WHERE shared_blks_written > 0
ORDER BY shared_blks_written DESC
LIMIT 10;

-- 6. 缓存命中率最低的 SQL（可能缺少索引或 shared_buffers 不足）
SELECT queryid,
       LEFT(query, 120) AS query_preview,
       calls,
       shared_blks_hit,
       shared_blks_read,
       ROUND(shared_blks_hit::numeric / NULLIF(shared_blks_hit + shared_blks_read, 0) * 100, 2) AS hit_ratio_pct
FROM pg_stat_statements
WHERE shared_blks_hit + shared_blks_read > 100
ORDER BY hit_ratio_pct ASC
LIMIT 10;
```

## 4. 执行计划变化检测

同一 `queryid` 可能因统计信息变化而切换执行计划。通过监控 `mean_exec_time` 的标准差可以发现计划抖动。

```sql
-- 7. 执行时间抖动最大的 SQL（可能发生了计划变化）
SELECT queryid,
       LEFT(query, 120) AS query_preview,
       calls,
       ROUND(mean_exec_time::numeric, 2) AS mean_ms,
       ROUND(stddev_exec_time::numeric, 2) AS stddev_ms,
       ROUND(stddev_exec_time::numeric / NULLIF(mean_exec_time, 0) * 100, 2) AS cv_pct,
       ROUND(min_exec_time::numeric, 2) AS min_ms,
       ROUND(max_exec_time::numeric, 2) AS max_ms
FROM pg_stat_statements
WHERE calls > 50
  AND stddev_exec_time > 0
ORDER BY cv_pct DESC
LIMIT 10;
```

> **cv_pct（变异系数）** > 100% 说明执行时间极不稳定，值得用 `EXPLAIN ANALYZE` 检查当前执行计划。

```sql
-- 8. 检查特定 SQL 的当前执行计划
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) 
SELECT * FROM orders WHERE user_id = 12345 ORDER BY created_at DESC LIMIT 10;
```

## 5. 定期清理和重置

```sql
-- 重置所有统计（在已知的时间点重置，便于计算增量）
SELECT pg_stat_statements_reset();

-- 查看统计信息重置时间（PG 13+）
SELECT stats_reset FROM pg_stat_statements_info();

-- 建议定期重置（如每天凌晨），避免累计数据掩盖近期问题
-- 可通过 cron 或 pg_cron 实现：
-- SELECT cron.schedule('reset-pgss', '0 2 * * *', 'SELECT pg_stat_statements_reset()');
```

> **实践建议**：在每次重大发布前重置统计，发布后对比优化效果。保留至少 7 天的数据用于趋势分析。

## 6. 综合分析 SQL

```sql
-- 9. SQL 资源消耗综合排名（加权评分）
SELECT queryid,
       LEFT(query, 100) AS query_preview,
       calls,
       ROUND(total_exec_time::numeric, 2) AS total_time_ms,
       ROUND(mean_exec_time::numeric, 2) AS mean_time_ms,
       rows,
       shared_blks_hit + shared_blks_read AS total_blks,
       -- 综合评分：总时间权重 40% + 总IO权重 40% + 调用频率权重 20%
       ROUND(
         (total_exec_time / NULLIF(MAX(total_exec_time) OVER(), 0)) * 40 +
         ((shared_blks_hit + shared_blks_read)::numeric / NULLIF(MAX(shared_blks_hit + shared_blks_read) OVER(), 0)) * 40 +
         (calls::numeric / NULLIF(MAX(calls) OVER(), 0)) * 20
       , 2) AS composite_score
FROM pg_stat_statements
WHERE calls > 0
ORDER BY composite_score DESC
LIMIT 20;

-- 10. 每日增量分析（需要定期采集数据到历史表）
-- 建表
CREATE TABLE IF NOT EXISTS pg_stat_statements_history (
    snapshot_time timestamptz DEFAULT now(),
    queryid bigint,
    query text,
    calls bigint,
    total_exec_time numeric,
    mean_exec_time numeric,
    rows bigint,
    shared_blks_hit bigint,
    shared_blks_read bigint
);

-- 采集快照
INSERT INTO pg_stat_statements_history
    (queryid, query, calls, total_exec_time, mean_exec_time, rows, shared_blks_hit, shared_blks_read)
SELECT queryid, query, calls, total_exec_time, mean_exec_time, rows, shared_blks_hit, shared_blks_read
FROM pg_stat_statements;

-- 查询昨日 vs 今日的 Top SQL 变化
SELECT queryid,
       LEFT(query, 80) AS query_preview,
       SUM(CASE WHEN snapshot_time >= date_trunc('day', now()) THEN calls ELSE 0 END) -
       SUM(CASE WHEN snapshot_time < date_trunc('day', now()) THEN calls ELSE 0 END) AS calls_delta,
       SUM(CASE WHEN snapshot_time >= date_trunc('day', now()) THEN total_exec_time ELSE 0 END) -
       SUM(CASE WHEN snapshot_time < date_trunc('day', now()) THEN total_exec_time ELSE 0 END) AS time_delta_ms
FROM pg_stat_statements_history
GROUP BY queryid, query
ORDER BY time_delta_ms DESC
LIMIT 10;
```

## 7. 扩展生态配合

### pg_stat_kcache：OS 级资源监控

`pg_stat_kcache` 通过 `getrusage()` 获取每个 SQL 的实际 CPU 时间和系统调用数据。

```sql
-- 安装
CREATE EXTENSION IF NOT EXISTS pg_stat_kcache;

-- 查看 SQL 级 CPU 和 IO 消耗
SELECT s.queryid,
       LEFT(s.query, 100) AS query_preview,
       s.calls,
       ROUND(k.read_bytes::numeric / 1024 / 1024, 2) AS read_mb,
       ROUND(k.write_bytes::numeric / 1024 / 1024, 2) AS write_mb,
       ROUND(k.user_time::numeric * 1000, 2) AS user_cpu_ms,
       ROUND(k.system_time::numeric * 1000, 2) AS system_cpu_ms
FROM pg_stat_statements s
JOIN pg_stat_kcache() k USING (queryid)
ORDER BY k.read_bytes + k.write_bytes DESC
LIMIT 10;
```

### pg_wait_sampling：等待事件采样

`pg_wait_sampling` 对等待事件进行持续采样，比 `pg_stat_activity` 的瞬时快照更准确。

```sql
-- 安装
CREATE EXTENSION IF NOT EXISTS pg_wait_sampling;

-- 查看等待事件分布
SELECT event_type,
       event,
       count
FROM pg_wait_sampling_profile
WHERE count > 0
ORDER BY count DESC
LIMIT 20;

-- 与 pg_stat_statements 关联，找出哪些 SQL 在等什么
SELECT s.queryid,
       LEFT(s.query, 80) AS query_preview,
       w.event_type,
       w.event,
       w.count AS wait_count
FROM pg_wait_sampling_profile w
JOIN pg_stat_statements s ON s.queryid = w.queryid
ORDER BY w.count DESC
LIMIT 20;
```

## 小结

`pg_stat_statements` 是 SQL 级性能分析的核心工具。配合 `pg_stat_kcache` 和 `pg_wait_sampling`，可以构建从"哪条 SQL 慢 → 慢在 CPU 还是 IO → 等在什么事件"的完整诊断链路。建议定期采集并持久化统计数据，建立 SQL 性能基线。
