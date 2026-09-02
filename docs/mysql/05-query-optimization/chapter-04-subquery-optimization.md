# 子查询优化

## 1. 子查询基础

### 1.1 子查询类型

```sql
-- 标量子查询
SELECT name, (SELECT COUNT(*) FROM orders WHERE user_id = u.id) FROM users u;

-- IN 子查询
SELECT * FROM users WHERE id IN (SELECT user_id FROM orders);

-- EXISTS 子查询
SELECT * FROM users u WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);
```

### 1.2 优化策略

```sql
-- 慢：IN 子查询
SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE amount > 1000);
-- 快：改用 JOIN
SELECT DISTINCT u.* FROM users u JOIN orders o ON u.id = o.user_id WHERE o.amount > 1000;

-- 慢：NOT IN
SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM orders);
-- 快：LEFT JOIN
SELECT u.* FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE o.id IS NULL;
```

### 1.3 半连接 (Semi-Join)

MySQL 8.0 自动将某些 IN 子查询转换为半连接。

## 2. 各类子查询优化

### 2.1 关联子查询优化

```sql
-- 关联子查询：子查询引用外部查询的列
-- 每次外部查询的行都要执行一次子查询

-- 慢：关联子查询
SELECT * FROM orders o
WHERE o.amount > (
    SELECT AVG(o2.amount) FROM orders o2 WHERE o2.user_id = o.user_id
);

-- 快：改用 JOIN + 子查询
SELECT o.* FROM orders o
JOIN (
    SELECT user_id, AVG(amount) AS avg_amount
    FROM orders GROUP BY user_id
) avg_t ON o.user_id = avg_t.user_id
WHERE o.amount > avg_t.avg_amount;
```

### 2.2 EXISTS vs IN 选择

```sql
-- 外层表大，内层表小 → IN 更好
SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE amount > 1000);
-- IN 子查询会物化为临时表，然后用索引查找

-- 外层表小，内层表大 → EXISTS 更好
SELECT * FROM users u WHERE EXISTS (
    SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.amount > 1000
);
-- EXISTS 对每个外部行执行一次子查询，内层表有索引时很快

-- 判断标准：
-- 用户表 1 万行，订单表 1000 万行
-- SELECT * FROM users WHERE id IN (SELECT user_id FROM orders ...);
-- → IN: 物化 1000 万行订单 → 效率低
-- → EXISTS: 遍历 1 万用户，每个在订单表索引查找 → 效率高
```

### 2.3 派生表优化

```sql
-- 派生表（FROM 子句中的子查询）
-- MySQL 8.0 支持派生表合并（Derived Table Merge）

-- 优化前：派生表物化
SELECT * FROM (
    SELECT id, name, age FROM users WHERE age > 20
) t WHERE t.name LIKE '张%';

-- MySQL 8.0 会合并为：
SELECT id, name, age FROM users WHERE age > 20 AND name LIKE '张%';

-- 如果派生表包含 GROUP BY、DISTINCT、LIMIT 等，无法合并
SELECT * FROM (
    SELECT department, COUNT(*) AS cnt FROM employees GROUP BY department
) t WHERE t.cnt > 5;
-- 必须物化派生表
```

### 2.4 ANY/ALL 子查询优化

```sql
-- ANY (等价于 IN)
SELECT * FROM users WHERE id = ANY (SELECT user_id FROM orders);
-- 等价于
SELECT * FROM users WHERE id IN (SELECT user_id FROM orders);

-- ALL
SELECT * FROM users WHERE salary > ALL (
    SELECT salary FROM employees WHERE department = 'IT'
);
-- 等价于
SELECT * FROM users WHERE salary > (SELECT MAX(salary) FROM employees WHERE department = 'IT');
```

## 3. 调试方法

### 3.1 子查询调试方法

```sql
-- 使用 EXPLAIN 分析子查询执行计划
EXPLAIN SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE amount > 1000);

-- 查看是否有子查询物化
EXPLAIN FORMAT=JSON SELECT * FROM users WHERE id IN (SELECT user_id FROM orders);
-- 查看 "materialized_from_subquery" 字段

-- 使用 Optimizer Trace 查看子查询优化过程
SET optimizer_trace = 'enabled=on';
SELECT * FROM users WHERE id IN (SELECT user_id FROM orders);
SELECT * FROM information_schema.optimizer_trace\G
SET optimizer_trace = 'enabled=off';
```

## 4. 最佳实践总结

| 场景 | 优化方法 | 原因 |
|------|---------|------|
| IN 子查询 | 改为 JOIN | 避免物化大临时表 |
| NOT IN | 改为 LEFT JOIN + IS NULL | 避免全表扫描 |
| 关联子查询 | 改为 JOIN + 聚合 | 避免重复执行子查询 |
| EXISTS | 确保内层表有索引 | 每次查找走索引 |
| 派生表 | 简化为 JOIN | MySQL 8.0 自动合并 |
| 大表 IN 小表 | 保持 IN | 物化后用索引查找 |
| 小表 IN 大表 | 改为 EXISTS | 避免物化大表 |
