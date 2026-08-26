# 连接优化

## 1. 连接算法

| 算法 | 说明 | 适用场景 |
|------|------|---------|
| Nested Loop Join | 嵌套循环 | 小表驱动大表 |
| Block Nested Loop | 块嵌套循环 | 无索引连接 |
| Hash Join | 哈希连接 | 8.0+ 等值连接 |

## 2. 优化原则

```sql
-- 小表驱动大表
SELECT * FROM orders o 
JOIN users u ON o.user_id = u.id  -- users 是小表
WHERE u.status = 'active';

-- 被驱动表连接字段加索引
CREATE INDEX idx_user_id ON orders(user_id);
```

## 3. JOIN 优化

```sql
-- 使用 EXPLAIN 查看驱动表
EXPLAIN SELECT * FROM orders o JOIN users u ON o.user_id = u.id;

-- 确保被驱动表有索引
-- 确保小表驱动大表
```

## 4. Nested Loop Join (NLJ)

```sql
-- 最基本的连接算法
-- 外层循环遍历驱动表，内层循环在被驱动表上查找匹配行

-- 示例：users (100行) JOIN orders (100万行)
-- 驱动表：users (小表)
-- 被驱动表：orders (大表，需要有索引)

-- 伪代码：
-- for each row u in users:
--     for each row o in orders WHERE o.user_id = u.id:
--         output (u, o)

-- 总 IO 成本：100 (扫描 users) + 100 × 3 (索引查找 orders) = 400 次 IO
```

## 5. Block Nested Loop Join (BNL)

```sql
-- 当被驱动表没有索引时使用
-- 将驱动表的数据分块读入 join_buffer，然后扫描被驱动表

-- 示例：users (100行) JOIN user_profiles (无索引)
-- join_buffer_size = 256KB，假设能装 50 行 users 数据

-- 伪代码：
-- for each block of 50 rows from users:
--     for each row in user_profiles:
--         if match: output

-- 总扫描次数：2 (users 分块) × 10000 (user_profiles) = 20000 次

-- 优化：
-- 1. 给被驱动表加索引
CREATE INDEX idx_user_id ON user_profiles(user_id);
-- 2. 增大 join_buffer_size
SET SESSION join_buffer_size = 1024 * 1024;  -- 1MB
```

## 6. Hash Join（MySQL 8.0.18+）

```sql
-- 等值连接时，优化器自动选择 Hash Join
-- 比 BNL 快很多

-- 示例
EXPLAIN FORMAT=TREE
SELECT * FROM users u
JOIN user_profiles p ON u.id = p.user_id;
-- 输出：-> Hash join (p.user_id = u.id)

-- Hash Join 只支持等值连接
-- 不支持：>, <, !=, LIKE 等

-- 内存不够时会溢出到磁盘
SHOW VARIABLES LIKE 'join_buffer_size';  -- 默认 256KB
```

## 7. 连接顺序优化

```sql
-- 优化器会自动选择最优连接顺序
-- 但有时需要手动干预

-- 查看当前连接顺序
EXPLAIN SELECT * FROM t1 JOIN t2 JOIN t3 WHERE t1.id = t2.t1_id AND t2.id = t3.t2_id;

-- 使用 STRAIGHT_JOIN 强制连接顺序
SELECT STRAIGHT_JOIN * FROM t1 JOIN t2 ON t1.id = t2.t1_id JOIN t3 ON t2.id = t3.t2_id;

-- 使用优化器提示
SELECT /*+ JOIN_ORDER(t1, t2, t3) */ * FROM t1 JOIN t2 JOIN t3 WHERE ...;
```

## 8. 自连接优化

```sql
-- 查找同部门薪资最高的员工
SELECT e1.* FROM employees e1
WHERE e1.salary = (
    SELECT MAX(e2.salary) FROM employees e2 WHERE e2.department = e1.department
);

-- 优化为 JOIN
SELECT e1.* FROM employees e1
JOIN (
    SELECT department, MAX(salary) AS max_salary
    FROM employees GROUP BY department
) e2 ON e1.department = e2.department AND e1.salary = e2.max_salary;
```

## 9. 最佳实践

1. **被驱动表连接字段必须有索引** — 最重要的优化
2. **小表驱动大表** — 优化器通常自动选择
3. **使用 Hash Join 替代 BNL** — MySQL 8.0.18+ 自动选择
4. **避免超过 3 个表的 JOIN** — 过多表连接优化器可能选择错误计划
5. **使用 EXPLAIN FORMAT=TREE 查看连接算法** — 确认使用了正确的算法
6. **适当增大 join_buffer_size** — 减少 BNL 的磁盘溢出

