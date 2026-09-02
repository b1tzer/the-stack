# 连接优化

连接（JOIN）是多表查询的执行核心，也是 OLTP 场景下查询变慢的常见根源。本文回答一个具体问题：一条 JOIN 语句变慢，应该从哪里入手排查。

**目标**：讲清 MySQL 三种连接算法及其成本模型，让读者能读懂 `EXPLAIN` 输出的连接计划，并掌握两条核心优化手段——小表驱动大表、被驱动表连接字段建索引。

**推理过程**：连接优化的所有判断都源自成本模型，所以本文先讲算法。NLJ 的成本约等于「驱动表行数 × 每次索引查找成本」，BNL 约等于「驱动表分块数 × 被驱动表全表扫描」，Hash Join 则是「构建哈希表 + 逐行探测」。理解成本从何而来，才能解释「小表驱动大表」「被驱动表必须建索引」这两条原则为什么成立，而不是把结论当教条。之后再落到连接顺序与自连接等具体写法，最后收束为可执行的最佳实践清单。

**边界**：本文只覆盖连接算法与连接顺序，不重复以下内容——索引失效与走索引的判定见 [索引使用与失效](../03-index/chapter-03-index-usage.md)，子查询与 IN/EXISTS 改写见 [子查询优化](./chapter-04-subquery-optimization.md)，单表 SQL 写法见 [SQL 优化技巧](./chapter-02-sql-optimization.md)。

## 1. 连接基础与原则

### 1.1 连接算法

MySQL 执行 JOIN 时，按连接字段是否走索引、连接条件是否为等值，在三种算法中选择。看懂这三种算法，是理解后续所有优化判断的前提。

| 算法 | 原理 | 触发条件 | 成本特征 |
|------|------|---------|---------|
| Nested Loop Join | 双层循环，外层驱动表，内层走索引查找 | 被驱动表连接字段有索引 | 驱动表行数 × 单次索引查找 |
| Block Nested Loop | 驱动表分块入 `join_buffer`，每块全扫被驱动表 | 被驱动表无索引 | 分块数 × 被驱动表行数 |
| Hash Join | 小表建哈希表，大表逐行探测 | 8.0.18+ 等值连接 | 建表 + 一次大表扫描 |

### 1.2 两条优化原则

这两条原则都来自成本公式，不是经验教条：

- **小表驱动大表**：驱动表每一行都要在被驱动表上做一次查找，查找总次数与驱动表行数成正比。驱动表越小，查找次数越少。
- **被驱动表连接字段加索引**：有索引时内层走 B+ 树索引查找（NLJ），无索引时退化为全表扫描（BNL）。成本从「行数 × 常数」恶化成「行数 × 行数」。

```sql
-- 小表驱动大表
SELECT * FROM orders o
JOIN users u ON o.user_id = u.id  -- users 是小表
WHERE u.status = 'active';
-- users 100 行、orders 100 万行时，驱动表应为 users：
-- 100 次索引查找 vs 100 万次索引查找

-- 被驱动表连接字段加索引
CREATE INDEX idx_user_id ON orders(user_id);
```

### 1.3 用 EXPLAIN 验证

原则是否生效，用 `EXPLAIN` 看执行计划验证，而不是凭直觉判断。

```sql
EXPLAIN SELECT * FROM orders o JOIN users u ON o.user_id = u.id;
-- 关注两点：
-- 1. 第一行出现的表是驱动表，确认它是不是小表
-- 2. 被驱动表所在行的 type 是否为 ref（走索引）而非 ALL（全表扫描）
```

## 2. 三种连接算法

### 2.1 Nested Loop Join (NLJ)

**是什么**：两层循环。外层遍历驱动表每一行，内层到被驱动表找匹配行。

**原理**：内层查找依赖被驱动表连接字段上的索引，走 B+ 树，单次查找成本约为常数（2~3 次磁盘 IO）。因此总成本 = 驱动表行数 × 单次查找成本，随驱动表行数线性增长。

**作用**：这是被驱动表有索引时的默认算法，也是成本最低的路径。

```text
示例：users (100 行) JOIN orders (100 万行)
驱动表：users（小表）
被驱动表：orders（大表，连接字段有索引）

for each row u in users:            -- 100 行
    for each row o in orders        -- 走 idx_user_id 索引查找
        where o.user_id = u.id:
        output (u, o)

-- 总 IO：100(扫 users) + 100 × 3(查 orders 索引) = 400 次
```

### 2.2 Block Nested Loop Join (BNL)

**是什么**：被驱动表连接字段没有索引时，NLJ 无法走索引查找，MySQL 改用 BNL 兜底。

**原理**：把驱动表数据分块读入 `join_buffer`，然后对被驱动表做一次全表扫描，在内存里比对。每扫一次被驱动表，只能处理 `join_buffer` 装得下的那部分驱动表行。

**作用**：相比逐行回表，分块能减少被驱动表的扫描次数，但本质仍是全表扫描，成本 = 分块数 × 被驱动表行数，比有索引的 NLJ 慢一个数量级。

```text
示例：users (100 行) JOIN user_profiles (10000 行，无索引)
join_buffer_size = 256KB，假设能装 50 行 users

for each block of 50 rows from users:   -- 2 块
    for each row in user_profiles:      -- 全表扫描 10000 行
        if match: output

-- 总扫描：2 × 10000 = 20000 次
```

两个优化方向：加索引（回到 NLJ）、增大 `join_buffer_size`（减少分块数）。

```sql
-- 1. 给被驱动表加索引，让优化器回到 NLJ
CREATE INDEX idx_user_id ON user_profiles(user_id);

-- 2. 增大 join_buffer_size，减少分块数
SET SESSION join_buffer_size = 1024 * 1024;  -- 1MB
```

### 2.3 Hash Join（MySQL 8.0.18+）

**是什么**：等值连接时，优化器把较小的表构建成哈希表，再遍历较大的表逐行探测。

**原理**：哈希查找是 O(1)，探测阶段每行只需一次哈希定位，不必全表扫描大表。成本约等于「构建哈希表 + 大表一次扫描」。

**作用**：连接字段无索引、又是等值连接时，Hash Join 取代 BNL，把「分块数 × 被驱动表行数」降到「被驱动表行数 × 常数」。

**边界**：只支持等值连接，`>`、`<`、`!=`、`LIKE` 等非等值条件用不了；哈希表装不下时会溢出到磁盘。

```sql
EXPLAIN FORMAT=TREE
SELECT * FROM users u
JOIN user_profiles p ON u.id = p.user_id;
-- 输出：-> Hash join (p.user_id = u.id)

-- 内存大小由 join_buffer_size 决定
SHOW VARIABLES LIKE 'join_buffer_size';  -- 默认 256KB
```

## 3. 连接优化技巧

### 3.1 连接顺序优化

**是什么**：多表 JOIN 时，表的连接顺序直接决定成本。优化器用表的统计信息估算每种顺序的成本，选最低的一种。

**为什么需要手动干预**：统计信息可能失真（大表被误判成小表），优化器就会选错顺序。此时用 `STRAIGHT_JOIN` 或 `JOIN_ORDER` 提示强制指定。

```sql
-- 查看优化器最终选定的连接顺序
EXPLAIN SELECT * FROM t1 JOIN t2 JOIN t3
WHERE t1.id = t2.t1_id AND t2.id = t3.t2_id;

-- STRAIGHT_JOIN：按书写顺序连接
SELECT STRAIGHT_JOIN * FROM t1
JOIN t2 ON t1.id = t2.t1_id
JOIN t3 ON t2.id = t3.t2_id;

-- 优化器提示：显式指定连接顺序
SELECT /*+ JOIN_ORDER(t1, t2, t3) */ * FROM t1 JOIN t2 JOIN t3 WHERE ...;
```

### 3.2 自连接优化

**是什么**：同一张表与自己连接，常见于「找分组内极值」一类需求，往往被写成关联子查询。

**为什么改写**：关联子查询会对每个外层行执行一次子查询，外层行多时重复执行严重。改成派生表 JOIN 后，聚合只计算一次，再走索引连接，成本大幅下降。

```sql
-- ❌ 关联子查询：每个员工行都执行一次子查询
SELECT e1.* FROM employees e1
WHERE e1.salary = (
    SELECT MAX(e2.salary) FROM employees e2
    WHERE e2.department = e1.department
);

-- ✅ 派生表 JOIN：聚合只算一次
SELECT e1.* FROM employees e1
JOIN (
    SELECT department, MAX(salary) AS max_salary
    FROM employees GROUP BY department
) e2 ON e1.department = e2.department AND e1.salary = e2.max_salary;
```

## 4. 最佳实践

1. **被驱动表连接字段必须有索引**：决定走 NLJ 还是 BNL，是影响最大的单一因素。无索引时成本从线性恶化成平方级。
2. **小表驱动大表**：查找次数与驱动表行数成正比，优化器通常能自动选对，但统计信息失真时要手动干预。
3. **等值连接优先 Hash Join**：8.0.18+ 自动选择，无索引等值连接时远快于 BNL。
4. **避免超过 3 张表 JOIN**：表越多，可能的连接顺序呈阶乘增长，优化器更容易选错计划。
5. **用 EXPLAIN FORMAT=TREE 确认算法**：看计划是否真的走了预期的连接算法，而不是凭直觉假设。
6. **按需调 join_buffer_size**：BNL / Hash Join 内存不够时会溢出磁盘，按实际数据量增大。
