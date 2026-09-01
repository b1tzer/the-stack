# SQL 规范与最佳实践

规范回答「SQL 该怎么写」，性能回答「SQL 怎么写得快」。本篇只讲规范；索引失效、分页、子查询等性能优化见 [SQL 优化技巧](../05-query-optimization/chapter-02-sql-optimization.md)。

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

## 2. SELECT 规范

```sql
-- ❌ 返回多余列，表结构变更后易出错
SELECT * FROM users WHERE id = 1;

-- ✅ 明确列出需要的列
SELECT id, name, email FROM users WHERE id = 1;
```

## 3. INSERT 规范

```sql
-- ✅ 显式列出列名，不依赖列顺序
INSERT INTO users (name, email) VALUES ('test', 'test@example.com');

-- ✅ 批量插入，减少网络往返
INSERT INTO users (name, email) VALUES
('test1', 'test1@example.com'),
('test2', 'test2@example.com'),
('test3', 'test3@example.com');
```

## 4. UPDATE/DELETE 规范

```sql
-- ❌ 不带 WHERE 会更新/删除整张表
UPDATE users SET status = 1;
DELETE FROM logs;

-- ✅ 始终带 WHERE，先 SELECT 确认范围
SELECT * FROM users WHERE created_at < '2024-01-01' LIMIT 10;
UPDATE users SET status = 0 WHERE created_at < '2024-01-01';

-- ✅ 大批量操作分批执行
DELETE FROM logs WHERE created_at < '2024-01-01' LIMIT 1000;
-- 循环执行直到影响行数为 0
```

## 5. JOIN 规范

```sql
-- ❌ 隐式连接，易漏 WHERE 产生笛卡尔积
SELECT * FROM users u, orders o WHERE u.id = o.user_id;

-- ✅ 显式 JOIN，关联条件与过滤条件分离
SELECT u.name, o.amount
FROM users u
INNER JOIN orders o ON u.id = o.user_id;
```

## 6. 事务规范

```sql
-- ✅ 事务短小，只包含必要的 SQL
START TRANSACTION;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;

-- ❌ 事务中包含 RPC/HTTP 调用或大量数据处理
-- ❌ 长时间不提交
```

## 7. 代码规范 Checklist

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
