# 查询处理流程

## 1. 完整流程

```
SQL → Parser → Analyzer → Rewriter → Planner/Optimizer → Executor → 结果
```

## 2. 各阶段说明

| 阶段 | 说明 |
|------|------|
| Parser | 语法检查，生成语法树 |
| Analyzer | 语义检查，解析表名/列名 |
| Rewriter | 规则重写（视图展开） |
| Planner | 生成执行计划，选择最优路径 |
| Executor | 执行计划，返回结果 |

## 3. EXPLAIN 解读

```sql
EXPLAIN ANALYZE SELECT * FROM users WHERE age > 25;

-- 输出示例：
-- Seq Scan on users  (cost=0.00..15.00 rows=500 width=...)
--   Filter: (age > 25)
--   Rows Removed by Filter: 500
```

## 4. 查询处理详解

### 4.1 Parser 阶段

将 SQL 文本解析为语法树（Parse Tree）。执行语法检查，识别关键字、标识符、字面量等。

```sql
-- 语法错误示例
SELECT * FORM users;  -- ERROR: syntax error at or near "FORM"
```

### 4.2 Analyzer 阶段

将语法树转换为查询树（Query Tree）。执行语义检查：表名、列名是否存在，类型是否匹配。

```sql
-- 语义错误示例
SELECT non_existent_column FROM users;  -- ERROR: column does not exist
```

### 4.3 Rewriter 阶段

应用规则系统，将查询树重写。主要处理视图展开和规则重写。

```sql
-- 视图展开示例
CREATE VIEW active_users AS SELECT * FROM users WHERE status = 'active';
SELECT * FROM active_users WHERE age > 25;
-- Rewriter 将其展开为：
-- SELECT * FROM users WHERE status = 'active' AND age > 25;
```

### 4.4 Planner/Optimizer 阶段

生成执行计划，选择最优的执行路径。这是查询处理中最复杂的阶段。

```sql
-- 查看优化器选择的执行计划
EXPLAIN SELECT * FROM users WHERE age > 25 ORDER BY name;

-- 查看所有可能的执行计划（调试用）
SET enable_seqscan = off;  -- 禁用顺序扫描
EXPLAIN SELECT * FROM users WHERE age > 25;
SET enable_seqscan = on;

-- 优化器代价参数
SHOW seq_page_cost;         -- 顺序 IO 代价（默认 1.0）
SHOW random_page_cost;       -- 随机 IO 代价（默认 4.0）
SHOW cpu_tuple_cost;         -- CPU 处理每行代价
SHOW cpu_index_tuple_cost;   -- CPU 处理索引行代价
SHOW cpu_operator_cost;      -- CPU 操作符代价
```

### 4.5 Executor 阶段

按执行计划执行查询，返回结果。使用 Volcano 模型（迭代器模型），每个节点提供 `next()` 接口。

```sql
-- 查看实际执行（EXPLAIN ANALYZE）
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT u.name, o.total
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE o.created_at > '2024-01-01';

-- 输出解读：
-- Hash Join (actual time=0.05..0.08 rows=3 loops=1)
--   -> Seq Scan on orders o (actual time=0.01..0.02 rows=3)
--   -> Hash (actual time=0.02..0.02 rows=10)
--         -> Seq Scan on users u (actual time=0.01..0.01 rows=10)
```

### 4.6 查询计划节点类型

| 节点类型 | 说明 | 触发条件 |
|---------|------|----------|
| Seq Scan | 全表扫描 | 无索引或选择性低 |
| Index Scan | 索引扫描 + 回表 | 有索引，需要回表取数据 |
| Index Only Scan | 仅索引扫描 | 覆盖索引，不需要回表 |
| Bitmap Index Scan | 位图索引扫描 | 多条件组合，中等选择性 |
| Bitmap Heap Scan | 位图堆扫描 | 配合 Bitmap Index Scan |
| Nested Loop | 嵌套循环连接 | 小表驱动大表 |
| Hash Join | 哈希连接 | 等值连接，大表 |
| Merge Join | 归并连接 | 已排序数据 |
| Sort | 排序 | ORDER BY |
| HashAggregate | 哈希聚合 | GROUP BY |
| Materialize | 物化 | 缓存中间结果 |

### 4.7 查询优化技巧

```sql
-- 1. 使用 EXPLAIN ANALYZE 定位瓶颈
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;

-- 2. 检查 estimated vs actual rows 差异
-- 差异大说明统计信息不准，需要 ANALYZE

-- 3. 检查是否有 Sort 溢出磁盘
-- "Sort Method: external merge Disk" 说明 work_mem 不足

-- 4. 检查是否使用了预期的索引
-- 如果没有，检查 WHERE 条件是否匹配索引

-- 5. 检查连接顺序
-- 小表应该驱动大表
```
