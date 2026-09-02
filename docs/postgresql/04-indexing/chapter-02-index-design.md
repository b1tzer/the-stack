---
doc_id: pg-index-design
title: 索引设计原则
---

# 索引设计原则

> **核心问题**：如何设计高效的索引？部分索引、覆盖索引、表达式索引怎么用？

## 1. 选择性原则

```sql
-- 高选择性列适合索引
SELECT COUNT(DISTINCT email) * 100.0 / COUNT(*) FROM users;  -- > 80% 好
SELECT COUNT(DISTINCT status) * 100.0 / COUNT(*) FROM users;  -- < 10% 差
```

## 2. 多列索引的列顺序

```sql
-- 多列索引遵循最左前缀原则
CREATE INDEX idx_status_created ON orders(status, created_at);

-- ✅ 能使用索引
SELECT * FROM orders WHERE status = 'pending';
SELECT * FROM orders WHERE status = 'pending' AND created_at > '2024-01-01';
SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at;

-- ❌ 不能使用索引（跳过了最左列）
SELECT * FROM orders WHERE created_at > '2024-01-01';
```

列顺序选择原则：
1. 等值查询的列放前面
2. 范围查询的列放后面
3. 选择性高的列放前面

## 3. 部分索引（Partial Index）

PG 独有的特性，只对满足条件的行建索引：

```sql
-- 只对活跃订单建索引（节省空间和维护成本）
CREATE INDEX idx_active_orders ON orders(created_at)
WHERE status = 'active';

-- 只对未处理的错误日志建索引
CREATE INDEX idx_unprocessed_errors ON error_logs(created_at)
WHERE processed = false;

-- 查询条件必须包含索引的 WHERE 条件
SELECT * FROM orders WHERE status = 'active' AND created_at > '2024-01-01';
-- ✅ 使用 idx_active_orders
```

### 3.1 部分唯一索引

```sql
-- 只对活跃用户要求 email 唯一
CREATE UNIQUE INDEX idx_active_email ON users(email)
WHERE status = 'active';

-- 允许已删除用户有重复 email，但活跃用户 email 必须唯一
INSERT INTO users (email, status) VALUES ('test@example.com', 'deleted');  -- ✅ 允许
INSERT INTO users (email, status) VALUES ('test@example.com', 'active');   -- ❌ 冲突
```

## 4. 表达式索引

```sql
-- 大小写不敏感的 email 查询
CREATE INDEX idx_lower_email ON users(LOWER(email));
SELECT * FROM users WHERE LOWER(email) = 'test@example.com';

-- 对 JSONB 字段建索引
CREATE INDEX idx_product_price ON products(((attrs ->> 'price')::numeric));
SELECT * FROM products WHERE (attrs ->> 'price')::numeric > 1000;

-- 对计算列建索引
CREATE INDEX idx_order_year ON orders(EXTRACT(YEAR FROM created_at));
SELECT * FROM orders WHERE EXTRACT(YEAR FROM created_at) = 2024;
```

## 5. 覆盖索引（INCLUDE）

```sql
-- INCLUDE 子句将非键列存储在索引叶子节点
CREATE INDEX idx_orders_covering ON orders(user_id, created_at)
INCLUDE (amount, status);

-- 覆盖查询（不需要回表）
SELECT user_id, created_at, amount, status
FROM orders
WHERE user_id = 1 AND created_at > '2024-01-01';
-- Index Only Scan（最优）
```

## 6. 并发创建索引

```sql
-- CONCURRENTLY：不阻塞写操作（生产环境必备）
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);

-- 注意：CONCURRENTLY 创建的索引如果失败会留下无效索引
-- 检查无效索引
SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes
WHERE idx_scan = 0 AND schemaname = 'public';

-- 删除无效索引
DROP INDEX CONCURRENTLY IF EXISTS idx_invalid;
```

> **最佳实践**：生产环境创建索引务必使用 `CONCURRENTLY`，避免阻塞业务。但 CONCURRENTLY 不能在事务块内执行。

## 7. 索引维护

```sql
-- 查看索引使用情况
SELECT
    schemaname,
    relname AS table_name,
    indexrelname AS index_name,
    idx_scan AS times_used,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;

-- 重建膨胀的索引（不锁表）
REINDEX INDEX CONCURRENTLY idx_users_email;
```

## 8. 查找缺失索引

```sql
-- 查找全表扫描次数最多的表（可能缺少索引）
SELECT 
    schemaname,
    relname AS table_name,
    seq_scan,
    seq_tup_read,
    idx_scan,
    CASE WHEN seq_scan + idx_scan > 0 
        THEN ROUND(100.0 * idx_scan / (seq_scan + idx_scan), 2) 
        ELSE 0 
    END AS idx_scan_ratio
FROM pg_stat_user_tables
WHERE seq_scan > 100
ORDER BY seq_tup_read DESC
LIMIT 20;
```
