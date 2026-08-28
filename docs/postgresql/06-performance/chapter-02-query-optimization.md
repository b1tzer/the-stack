---
doc_id: pg-query-optimization
title: 查询优化技巧
---

# 查询优化技巧

> **核心问题**：如何定位慢查询？有哪些常见的优化手段？

## 1. pg_stat_statements：慢查询统计

```sql
-- 安装扩展
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Top 10 最耗时的 SQL
SELECT 
    calls,
    ROUND(total_exec_time::numeric, 2) AS total_time_ms,
    ROUND(mean_exec_time::numeric, 2) AS avg_time_ms,
    LEFT(query, 100) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;

-- Top 10 最慢的 SQL
SELECT 
    calls,
    ROUND(mean_exec_time::numeric, 2) AS avg_time_ms,
    LEFT(query, 100) AS query
FROM pg_stat_statements
WHERE calls > 10
ORDER BY mean_exec_time DESC
LIMIT 10;
```

## 2. auto_explain：自动记录慢查询执行计划

```ini
# postgresql.conf
shared_preload_libraries = 'auto_explain'
auto_explain.log_min_duration = 1000   -- 超过 1 秒的查询自动记录执行计划
auto_explain.log_analyze = true
auto_explain.log_buffers = true
```

## 3. 常见优化手段

### 3.1 避免 SELECT *

```sql
-- 差
SELECT * FROM users WHERE id = 1;
-- 好
SELECT id, name, email FROM users WHERE id = 1;
```

### 3.2 使用 EXISTS 替代 IN

```sql
-- 慢
SELECT * FROM users WHERE id IN (SELECT user_id FROM orders);
-- 快
SELECT * FROM users u WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);
```

### 3.3 分页优化

```sql
-- ❌ 低效分页：OFFSET 越大越慢
SELECT * FROM orders ORDER BY id LIMIT 10 OFFSET 100000;

-- ✅ 高效分页：基于游标（Keyset Pagination）
SELECT * FROM orders WHERE id > 100000 ORDER BY id LIMIT 10;

-- ✅ 复合排序分页
SELECT * FROM orders
WHERE (created_at, id) < ('2024-06-01', 5000)
ORDER BY created_at DESC, id DESC
LIMIT 10;
```

### 3.4 N+1 查询问题

```sql
-- ✅ 解决方案1：JOIN 一次查出
SELECT u.*, o.*
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.status = 'active';

-- ✅ 解决方案2：LATERAL JOIN
SELECT u.name, o.*
FROM users u
CROSS JOIN LATERAL (
    SELECT * FROM orders WHERE user_id = u.id ORDER BY created_at DESC LIMIT 3
) o;
```

### 3.5 避免隐式类型转换

```sql
-- ❌ 隐式类型转换导致索引失效
SELECT * FROM orders WHERE user_id = 12345;  -- user_id 是 VARCHAR

-- ✅ 显式类型转换
SELECT * FROM orders WHERE user_id = '12345';
```

### 3.6 CTE 物化与内联

```sql
-- 强制物化（防止优化器内联）
WITH MATERIALIZED active_users AS (
    SELECT * FROM users WHERE status = 'active'
)
SELECT * FROM active_users WHERE age > 25;

-- 强制内联
WITH NOT MATERIALIZED active_users AS (
    SELECT * FROM users WHERE status = 'active'
)
SELECT * FROM active_users WHERE age > 25;
```

## 4. 性能问题排查流程

![慢查询优化流程](/pg/query-optimize-flow.svg)

## 5. 索引优化建议

| 场景 | 推荐索引类型 | 示例 |
|------|------------|------|
| 等值查询 | B-tree | `CREATE INDEX ON users(email)` |
| JSONB 字段查询 | GIN | `CREATE INDEX ON docs USING GIN(data)` |
| 全文检索 | GIN + tsvector | `CREATE INDEX ON articles USING GIN(to_tsvector('chinese', content))` |
| 超大时序表 | BRIN | `CREATE INDEX ON logs USING BRIN(created_at)` |
| 多列查询 | 联合索引 | `CREATE INDEX ON orders(user_id, status, created_at)` |
| 部分数据查询 | 部分索引 | `CREATE INDEX ON orders(created_at) WHERE status = 'active'` |
