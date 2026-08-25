# SQL 规范与最佳实践

## 1. 命名规范

```sql
-- 表名：小写 + 下划线，名词复数
CREATE TABLE user_orders (...);
CREATE TABLE order_items (...);

-- 列名：小写 + 下划线
-- 主键：id
-- 外键：表名单数_id
-- 布尔：is_ 开头
-- 时间：_at 结尾（created_at, updated_at）
-- 状态：_status 结尾

-- 索引命名
-- 主键：PRIMARY
-- 唯一索引：uk_表名_列名
-- 普通索引：idx_表名_列名
-- 全文索引：ft_表名_列名
```

## 2. 常见反模式

### 2.1 SELECT *

```sql
-- ❌ 错误：返回不必要的列，浪费带宽和内存
SELECT * FROM users WHERE id = 1;

-- ✅ 正确：只查需要的列
SELECT id, name, email FROM users WHERE id = 1;
```

### 2.2 隐式类型转换

```sql
-- ❌ 错误：phone 是 VARCHAR，传入 INT 导致索引失效
SELECT * FROM users WHERE phone = 13800138000;

-- ✅ 正确：保持类型一致
SELECT * FROM users WHERE phone = '13800138000';
```

### 2.3 前导通配符

```sql
-- ❌ 错误：前导 % 导致索引失效
SELECT * FROM users WHERE name LIKE '%test';

-- ✅ 正确：后缀匹配可使用索引
SELECT * FROM users WHERE name LIKE 'test%';

-- ✅ 全文搜索场景使用全文索引
SELECT * FROM users WHERE MATCH(name) AGAINST('test');
```

### 2.4 OR 条件

```sql
-- ❌ 错误：OR 可能导致全表扫描
SELECT * FROM users WHERE status = 1 OR age > 25;

-- ✅ 正确：使用 UNION 或确保两边都有索引
SELECT * FROM users WHERE status = 1
UNION
SELECT * FROM users WHERE age > 25;
```

### 2.5 NOT IN

```sql
-- ❌ 错误：NOT IN 性能差且不处理 NULL
SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM orders);

-- ✅ 正确：使用 NOT EXISTS 或 LEFT JOIN
SELECT u.* FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE o.user_id IS NULL;
```

## 3. INSERT 最佳实践

```sql
-- ❌ 单条插入
INSERT INTO users (name, email) VALUES ('test1', 'test1@example.com');
INSERT INTO users (name, email) VALUES ('test2', 'test2@example.com');

-- ✅ 批量插入
INSERT INTO users (name, email) VALUES
('test1', 'test1@example.com'),
('test2', 'test2@example.com'),
('test3', 'test3@example.com');
-- 建议每批 500-1000 条

-- ✅ 使用 INSERT IGNORE 或 ON DUPLICATE KEY UPDATE
INSERT INTO users (id, name, email) VALUES (1, 'test', 'test@example.com')
ON DUPLICATE KEY UPDATE name = VALUES(name), email = VALUES(email);
```

## 4. UPDATE/DELETE 最佳实践

```sql
-- ❌ 不带 WHERE 条件
UPDATE users SET status = 1;
DELETE FROM logs;

-- ✅ 始终带 WHERE，先 SELECT 确认范围
SELECT * FROM users WHERE created_at < '2024-01-01' LIMIT 10;
-- 确认无误后
UPDATE users SET status = 0 WHERE created_at < '2024-01-01';

-- ✅ 大批量操作分批执行
DELETE FROM logs WHERE created_at < '2024-01-01' LIMIT 1000;
-- 循环执行直到影响行数为 0
```

## 5. JOIN 最佳实践

```sql
-- ❌ 隐式连接（笛卡尔积风险）
SELECT * FROM users u, orders o WHERE u.id = o.user_id;

-- ✅ 显式连接
SELECT u.name, o.amount
FROM users u
INNER JOIN orders o ON u.id = o.user_id;

-- ✅ 确保 JOIN 列有索引
-- users.id 应该是主键
-- orders.user_id 应该有索引

-- ✅ 小表驱动大表
-- 让小的结果集作为驱动表
```

## 6. 子查询优化

```sql
-- ❌ 相关子查询（逐行执行）
SELECT u.*, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count
FROM users u;

-- ✅ 改写为 JOIN
SELECT u.*, COUNT(o.id) AS order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.id;
```

## 7. LIMIT 分页

```sql
-- ❌ 大偏移量分页（扫描大量数据）
SELECT * FROM users ORDER BY id LIMIT 1000000, 10;

-- ✅ 使用游标分页
SELECT * FROM users WHERE id > 1000000 ORDER BY id LIMIT 10;

-- ✅ 延迟关联
SELECT u.* FROM users u
INNER JOIN (SELECT id FROM users ORDER BY id LIMIT 1000000, 10) t
ON u.id = t.id;
```

## 8. 索引使用规范

```sql
-- ✅ 遵循最左前缀原则
-- 联合索引 (a, b, c)
WHERE a = 1                    -- 使用索引
WHERE a = 1 AND b = 2          -- 使用索引
WHERE a = 1 AND b = 2 AND c = 3 -- 使用索引
WHERE b = 2                    -- 不使用索引
WHERE b = 2 AND c = 3          -- 不使用索引

-- ✅ 避免在索引列上使用函数
-- ❌ WHERE YEAR(created_at) = 2024
-- ✅ WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01'

-- ✅ 避免隐式转换
-- ❌ WHERE varchar_col = 123
-- ✅ WHERE varchar_col = '123'
```

## 9. 事务规范

```sql
-- ✅ 保持事务短小
START TRANSACTION;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;

-- ❌ 事务中包含 RPC/HTTP 调用
-- ❌ 事务中包含大量数据处理
-- ❌ 长时间不提交

-- ✅ 异常时回滚
START TRANSACTION;
-- ... SQL 操作
-- 如果出错
ROLLBACK;
-- 如果成功
COMMIT;
```

## 10. 代码规范 Checklist

| 检查项 | 要求 |
|--------|------|
| 表名 | 小写 + 下划线，名词复数 |
| 主键 | 每张表必须有主键，推荐自增 ID |
| 字符集 | 统一使用 utf8mb4 |
| 时间字段 | 使用 DATETIME 或 TIMESTAMP |
| 软删除 | 使用 is_deleted 字段而非物理删除 |
| 索引 | 单表索引不超过 5 个 |
| NULL | 尽量 NOT NULL，设置 DEFAULT 值 |
| 注释 | 表和列必须有 COMMENT |
