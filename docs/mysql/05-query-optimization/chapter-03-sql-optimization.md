# SQL 优化技巧

## 1. 避免 SELECT *

```sql
-- 差
SELECT * FROM users WHERE id = 1;
-- 好
SELECT id, name, email FROM users WHERE id = 1;
```

## 2. 避免索引失效

```sql
-- 差：函数操作
WHERE YEAR(created_at) = 2024
-- 好
WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01'

-- 差：隐式类型转换
WHERE phone = 13800138000
-- 好
WHERE phone = '13800138000'
```

## 3. 分页优化

```sql
-- 慢：OFFSET 大
SELECT * FROM users ORDER BY id LIMIT 1000000, 10;
-- 快：游标分页
SELECT * FROM users WHERE id > 1000000 ORDER BY id LIMIT 10;
```

## 4. 批量操作

```sql
-- 慢
INSERT INTO users (name) VALUES ('a');
INSERT INTO users (name) VALUES ('b');
-- 快
INSERT INTO users (name) VALUES ('a'), ('b'), ('c');
```

## 5. COUNT 优化

```sql
-- COUNT(*) vs COUNT(1) vs COUNT(col)
SELECT COUNT(*) FROM users;      -- 统计所有行（包括 NULL）
SELECT COUNT(1) FROM users;      -- 等价于 COUNT(*)
SELECT COUNT(email) FROM users;  -- 不统计 email 为 NULL 的行

-- 性能：COUNT(*) ≈ COUNT(1) > COUNT(主键) > COUNT(普通列)
-- InnoDB 下 COUNT(*) 会选最小的索引遍历

-- 大表 COUNT 优化方案：
-- 1. 使用近似值
EXPLAIN SELECT COUNT(*) FROM users;  -- rows 列是估算值

-- 2. 维护计数表
CREATE TABLE table_counts (
    table_name VARCHAR(100) PRIMARY KEY,
    row_count BIGINT
);
-- 使用触发器或应用层维护计数

-- 3. Redis 计数
-- 缓存行数，定期与数据库同步
```

## 6. ORDER BY 优化

```sql
-- 利用索引排序，避免 filesort
-- 联合索引 (a, b, c)
SELECT * FROM t WHERE a = 1 ORDER BY b;           -- ✅ 利用索引排序
SELECT * FROM t WHERE a = 1 ORDER BY b, c;        -- ✅ 利用索引排序
SELECT * FROM t WHERE a = 1 ORDER BY c;           -- ❌ filesort
SELECT * FROM t WHERE a = 1 ORDER BY b DESC;      -- ✅ 8.0+ 降序索引支持

-- filesort 排序算法
-- 1. 双路排序：数据量大时，读取排序列+主键，排序后回表
-- 2. 单路排序：数据量小时，读取所有列，内存排序
SHOW VARIABLES LIKE 'max_length_for_sort_data';  -- 默认 4096 字节
```

## 7. GROUP BY 优化

```sql
-- GROUP BY 也会产生 filesort 或 temporary
SELECT department, COUNT(*) FROM employees GROUP BY department;

-- 优化：确保 GROUP BY 列有索引
CREATE INDEX idx_department ON employees(department);

-- 松散索引扫描（Loose Index Scan）
-- 如果 GROUP BY 列是索引前缀，可以使用
EXPLAIN SELECT department, COUNT(*) FROM employees GROUP BY department;
-- Extra: Using index for group-by

-- 紧凑索引扫描（Tight Index Scan）
SELECT department, COUNT(*) FROM employees
WHERE department IN ('IT', 'HR')
GROUP BY department;
```

## 8. UNION 优化

```sql
-- UNION vs UNION ALL
-- UNION 会去重（隐式 DISTINCT），有排序开销
-- UNION ALL 不去重，性能更好

-- ❌ 如果确定没有重复数据
SELECT id, name FROM users_a
UNION
SELECT id, name FROM users_b;

-- ✅ 使用 UNION ALL
SELECT id, name FROM users_a
UNION ALL
SELECT id, name FROM users_b;

-- UNION 优化：每个子查询加 LIMIT
(SELECT * FROM users WHERE age > 30 ORDER BY created_at DESC LIMIT 10)
UNION ALL
(SELECT * FROM users WHERE age < 20 ORDER BY created_at DESC LIMIT 10)
ORDER BY created_at DESC LIMIT 10;
```

## 9. UPDATE/DELETE 优化

```sql
-- 批量删除优化
-- ❌ 大事务删除
DELETE FROM logs WHERE created_at < '2024-01-01';

-- ✅ 分批删除
DELIMITER //
CREATE PROCEDURE batch_delete()
BEGIN
    DECLARE affected INT DEFAULT 1;
    WHILE affected > 0 DO
        DELETE FROM logs WHERE created_at < '2024-01-01' LIMIT 5000;
        SET affected = ROW_COUNT();
        DO SLEEP(0.1);  -- 降低对线上影响
    END WHILE;
END //
DELIMITER ;

-- 批量更新优化
-- ❌ 逐条更新
UPDATE users SET status = 'inactive' WHERE id = 1;
UPDATE users SET status = 'inactive' WHERE id = 2;

-- ✅ 批量更新
UPDATE users SET status = 'inactive' WHERE id IN (1, 2, 3, ...);

-- 使用 CASE WHEN 批量更新不同值
UPDATE products SET price = CASE
    WHEN id = 1 THEN 100
    WHEN id = 2 THEN 200
    WHEN id = 3 THEN 300
END
WHERE id IN (1, 2, 3);
```

## 10. 最佳实践总结

| 优化项 | 方法 | 效果 |
|--------|------|------|
| SELECT * | 只查需要的列 | 减少网络传输和回表 |
| 分页 | 游标分页 | 避免大 OFFSET |
| COUNT | 近似值或计数表 | 避免全表扫描 |
| ORDER BY | 利用索引排序 | 避免 filesort |
| GROUP BY | 索引前缀 | 避免临时表 |
| 批量操作 | 合并多条语句 | 减少网络往返 |
| 大表删除 | 分批执行 | 避免长事务 |

