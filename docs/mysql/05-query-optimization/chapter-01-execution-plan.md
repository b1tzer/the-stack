# 查询执行流程

## 1. 完整流程

```
SQL → 连接器 → 查询缓存(8.0移除) → 解析器 → 优化器 → 执行器 → 存储引擎
```

## 2. 优化器

```sql
-- 查看优化器选择
EXPLAIN FORMAT=JSON SELECT * FROM users WHERE age > 25;

-- Optimizer Trace
SET optimizer_trace = 'enabled=on';
SELECT * FROM users WHERE age > 25;
SELECT * FROM information_schema.optimizer_trace\G
```

## 3. 成本模型

```sql
-- 查看表统计信息
SELECT * FROM mysql.innodb_table_stats WHERE table_name = 'users';

-- 更新统计信息
ANALYZE TABLE users;
```

## 4. 优化器成本模型

```sql
-- 查看表的统计信息
SELECT * FROM mysql.innodb_table_stats WHERE table_name = 'users';
-- n_rows: 估算行数
-- clustered_index_size: 聚簇索引页数
-- sum_of_other_index_sizes: 其他索引页数

-- 查看索引的统计信息
SELECT * FROM mysql.innodb_index_stats
WHERE table_name = 'users' AND stat_name = 'size';

-- 手动更新统计信息
ANALYZE TABLE users;

-- 统计信息持久化（MySQL 8.0 默认开启）
SHOW VARIABLES LIKE 'innodb_stats_persistent';  -- ON

-- 统计信息采样页数
SHOW VARIABLES LIKE 'innodb_stats_persistent_sample_pages';  -- 默认 20
-- 对于大表，可以增加采样页数提高准确性
SET GLOBAL innodb_stats_persistent_sample_pages = 100;
```

## 5. Optimizer Trace 详解

```sql
-- 开启 Optimizer Trace
SET optimizer_trace = 'enabled=on';

-- 执行查询
SELECT * FROM users WHERE age > 25 AND name LIKE '张%';

-- 查看 Trace 结果
SELECT * FROM information_schema.optimizer_trace\G

-- 关键字段：
-- join_preparation: 查询准备阶段
-- join_optimization: 优化阶段
--   - rows_estimation: 行数估算
--   - considered_execution_plans: 考虑的执行计划
--   - cost_investment_plan: 成本计算
-- join_execution: 执行阶段

-- 关闭
SET optimizer_trace = 'enabled=off';
```

## 6. 优化器提示 (Optimizer Hints)

```sql
-- MySQL 8.0+ 支持优化器提示

-- 强制使用索引
SELECT /*+ INDEX(users idx_name) */ * FROM users WHERE name = '张三';

-- 忽略索引
SELECT /*+ NO_INDEX(users idx_name) */ * FROM users WHERE name = '张三';

-- 控制连接顺序
SELECT /*+ JOIN_ORDER(users, orders) */ * FROM users u JOIN orders o ON u.id = o.user_id;

-- 控制连接算法
SELECT /*+ HASH_JOIN(o) */ * FROM users u JOIN orders o ON u.id = o.user_id;

-- 限制扫描行数
SELECT /*+ MAX_EXECUTION_TIME(1000) */ * FROM users WHERE age > 20;
```

## 7. 查询缓存（MySQL 8.0 已移除）

```sql
-- MySQL 5.7 及之前的查询缓存
-- 问题：
-- 1. 表级别失效，任何修改都导致缓存失效
-- 2. 在高并发下成为瓶颈（全局锁）
-- 3. 命中率通常很低
-- MySQL 8.0 彻底移除了查询缓存

-- 替代方案：
-- 1. 应用层缓存（Redis）
-- 2. ProxySQL 查询缓存
-- 3. 连接池复用
```

## 8. 最佳实践

1. **定期更新统计信息** — `ANALYZE TABLE` 或自动持久化
2. **使用 Optimizer Trace 排查慢查询** — 了解优化器选择
3. **谨慎使用 FORCE INDEX** — 优先让优化器自主选择
4. **关注成本模型的准确性** — 统计信息不准会导致错误的执行计划
5. **使用优化器提示替代全局参数调整** — 更精细的控制

