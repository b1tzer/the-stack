---
doc_id: pg-returning-dml
title: PG 特有 DML 与 LATERAL
---

# PG 特有 DML 与 LATERAL

> **核心问题**：PostgreSQL 有哪些独有的 DML 特性？LATERAL JOIN 如何使用？

## 1. RETURNING 子句

PG 的 INSERT/UPDATE/DELETE 都支持 `RETURNING`，直接返回受影响的行数据：

```sql
-- INSERT 后返回生成的 ID
INSERT INTO users (username, email)
VALUES ('李四', 'lisi@example.com')
RETURNING id, username;

-- UPDATE 后返回修改后的数据
UPDATE users SET email = 'updated@example.com'
WHERE id = 1
RETURNING id, email;

-- DELETE 后返回被删除的数据
DELETE FROM users WHERE id = 1
RETURNING id, username;
```

## 2. UPSERT（INSERT ON CONFLICT）

```sql
-- 插入时如果冲突则更新
INSERT INTO users (username, email)
VALUES ('张三', 'new@example.com')
ON CONFLICT (username)
DO UPDATE SET email = EXCLUDED.email;

-- 忽略冲突
INSERT INTO users (username, email)
VALUES ('张三', 'zhangsan@example.com')
ON CONFLICT DO NOTHING;

-- 批量 UPSERT
INSERT INTO user_stats (user_id, login_count, last_login)
VALUES
    (1, 1, NOW()),
    (2, 1, NOW()),
    (3, 1, NOW())
ON CONFLICT (user_id)
DO UPDATE SET
    login_count = user_stats.login_count + EXCLUDED.login_count,
    last_login = EXCLUDED.last_login;
```

## 3. CTE 数据修改

```sql
-- CTE 中执行 DELETE 并归档
WITH deleted AS (
    DELETE FROM orders WHERE created_at < '2023-01-01' RETURNING *
)
INSERT INTO orders_archive SELECT * FROM deleted;

-- CTE 中执行 UPDATE 并记录变更
WITH updated AS (
    UPDATE products SET price = price * 0.9 WHERE category = '电子产品' RETURNING id, price
)
INSERT INTO price_change_log (product_id, new_price) SELECT id, price FROM updated;
```

## 4. 多表关联更新/删除

```sql
-- 多表关联更新
UPDATE orders o
SET status = 'shipped'
FROM users u
WHERE o.user_id = u.id AND u.region = 'north' AND o.status = 'pending';

-- 多表关联删除
DELETE FROM order_items oi
USING orders o
WHERE oi.order_id = o.id AND o.status = 'cancelled';
```

## 5. DISTINCT ON（PG 独有）

```sql
-- 取每个部门薪资最高的员工
SELECT DISTINCT ON (department)
    department, name, salary
FROM employees
ORDER BY department, salary DESC;
```

## 6. FILTER 子句

```sql
-- 条件聚合（比 CASE WHEN 更简洁）
SELECT
    department,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE salary > 10000) AS high_salary_count,
    AVG(salary) FILTER (WHERE status = 'active') AS active_avg_salary
FROM employees
GROUP BY department;
```

## 7. GROUPING SETS / ROLLUP / CUBE

```sql
-- ROLLUP：层级汇总
SELECT department, region, SUM(salary)
FROM employees
GROUP BY ROLLUP (department, region);

-- CUBE：所有维度组合的汇总
SELECT department, region, SUM(salary)
FROM employees
GROUP BY CUBE (department, region);

-- GROUPING SETS：自定义分组组合
SELECT department, region, SUM(salary)
FROM employees
GROUP BY GROUPING SETS (
    (department, region),
    (department),
    (region),
    ()
);
```

## 8. LATERAL JOIN

LATERAL 允许子查询引用前面表的列，实现"每行执行一次子查询"的效果：

```sql
-- 每个用户的最近3笔订单
SELECT u.name, o.*
FROM users u
CROSS JOIN LATERAL (
    SELECT * FROM orders 
    WHERE user_id = u.id 
    ORDER BY created_at DESC 
    LIMIT 3
) o;

-- 与 LEFT JOIN LATERAL 结合（没有订单的用户也返回）
SELECT u.name, o.*
FROM users u
LEFT JOIN LATERAL (
    SELECT * FROM orders 
    WHERE user_id = u.id 
    ORDER BY created_at DESC 
    LIMIT 3
) o ON true;
```

> **LATERAL vs 子查询**：普通子查询不能引用外部表的列，LATERAL 可以。LATERAL 本质上是"相关子查询"的标准化写法，优化器通常能更好地优化它。

## 9. 批量操作优化

```sql
-- 批量插入（比逐条 INSERT 快 10-100 倍）
INSERT INTO users (username, email) VALUES
    ('user1', 'user1@example.com'),
    ('user2', 'user2@example.com'),
    ('user3', 'user3@example.com');

-- COPY 批量导入（最快）
COPY users (name, email) FROM '/tmp/users.csv' WITH CSV HEADER;
```
