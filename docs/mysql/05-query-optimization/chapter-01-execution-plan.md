# 查询执行流程与 EXPLAIN

## 1. 执行流程与优化器

### 1.1 完整流程

```
SQL → 连接器 → 查询缓存(8.0移除) → 解析器 → 优化器 → 执行器 → 存储引擎
```

一条 SQL 从发出到返回结果，依次经过连接器、解析器、优化器、执行器，最后到达存储引擎。对性能影响最大的是**优化器**——它决定用哪个索引、按什么顺序连接表，同一个 SQL 可能跑出数量级差异。

### 1.2 优化器与成本模型

优化器不「猜」执行计划，而是基于**成本模型**打分，选成本最低的那个。成本由表的行数估算、索引页数、IO 代价共同决定，而这些数据来自统计信息。

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
```

统计信息默认持久化（MySQL 8.0 起 `innodb_stats_persistent = ON`），并靠采样估算：

```sql
SHOW VARIABLES LIKE 'innodb_stats_persistent';             -- ON
SHOW VARIABLES LIKE 'innodb_stats_persistent_sample_pages'; -- 默认 20
-- 大表可提高采样页数，让估算更准
SET GLOBAL innodb_stats_persistent_sample_pages = 100;
```

### 1.3 Optimizer Trace 详解

想知道优化器「为什么选这个计划」，单看 `EXPLAIN` 只给结果，要看决策过程得开 Optimizer Trace：

```sql
-- 开启 Optimizer Trace
SET optimizer_trace = 'enabled=on';

-- 执行查询
SELECT * FROM users WHERE age > 25 AND name LIKE '张%';

-- 查看 Trace 结果
SELECT * FROM information_schema.optimizer_trace\G

-- 关闭
SET optimizer_trace = 'enabled=off';
```

Trace 的关键字段：

- `join_preparation`：查询准备阶段
- `join_optimization`：优化阶段
  - `rows_estimation`：行数估算
  - `considered_execution_plans`：考虑过的执行计划
  - `cost_investment_plan`：成本计算
- `join_execution`：执行阶段

### 1.4 优化器提示 (Optimizer Hints)

当优化器选错计划时，可以用 Hint 在单条 SQL 上强制干预，而不是改全局参数：

```sql
-- 强制使用索引
SELECT /*+ INDEX(users idx_name) */ * FROM users WHERE name = '张三';

-- 忽略索引
SELECT /*+ NO_INDEX(users idx_name) */ * FROM users WHERE name = '张三';

-- 控制连接顺序
SELECT /*+ JOIN_ORDER(users, orders) */ * FROM users u JOIN orders o ON u.id = o.user_id;

-- 控制连接算法
SELECT /*+ HASH_JOIN(o) */ * FROM users u JOIN orders o ON u.id = o.user_id;

-- 限制执行时间（毫秒）
SELECT /*+ MAX_EXECUTION_TIME(1000) */ * FROM users WHERE age > 20;
```

### 1.5 查询缓存（MySQL 8.0 已移除）

MySQL 5.7 及之前的查询缓存，因三个缺陷被移除：

1. 表级别失效，任何修改都导致整表缓存失效
2. 高并发下成为瓶颈（全局锁）
3. 命中率通常很低

替代方案：应用层缓存（Redis）、ProxySQL 查询缓存、连接池复用。

## 2. EXPLAIN 基础

### 2.1 EXPLAIN 基本用法

`EXPLAIN` 是观察执行计划、验证优化器决策的主要工具：

```sql
EXPLAIN SELECT * FROM users WHERE age > 25;
EXPLAIN ANALYZE SELECT * FROM users WHERE age > 25;  -- 8.0.18+，含实际执行时间
```

### 2.2 核心字段

| 字段 | 说明 |
|------|------|
| type | 访问类型 |
| possible_keys | 可能使用的索引 |
| key | 实际使用的索引 |
| key_len | 索引使用长度 |
| rows | 预估扫描行数 |
| filtered | 过滤比例 |
| Extra | 额外信息 |

### 2.3 type 访问类型（从差到好）

| type | 说明 |
|------|------|
| ALL | 全表扫描 |
| index | 全索引扫描 |
| range | 范围扫描 |
| ref | 非唯一索引等值查询 |
| eq_ref | 唯一索引等值查询 |
| const | 主键/唯一索引等值查询 |
| system | 系统表 |

### 2.4 Extra 常见值

| Extra | 说明 |
|------|------|
| Using index | 覆盖索引 |
| Using where | 存储引擎返回后再过滤 |
| Using temporary | 使用临时表 |
| Using filesort | 文件排序 |
| Using index condition | 索引下推 |

## 3. EXPLAIN 进阶格式

### 3.1 EXPLAIN FORMAT=JSON

```sql
EXPLAIN FORMAT=JSON SELECT * FROM users WHERE name = '张三' AND age > 25;
```

输出包含成本明细：

```json
{
  "query_block": {
    "select_id": 1,
    "cost_info": {
      "query_cost": "2.40"
    },
    "table": {
      "table_name": "users",
      "access_type": "ref",
      "possible_keys": ["idx_name", "idx_name_age"],
      "key": "idx_name_age",
      "used_key_parts": ["name"],
      "key_length": "202",
      "rows_examined_per_scan": 3,
      "filtered": "33.33",
      "cost_info": {
        "read_cost": "1.80",
        "eval_cost": "0.60"
      }
    }
  }
}
```

### 3.2 EXPLAIN ANALYZE（MySQL 8.0.18+）

```sql
-- 显示实际执行时间，而不仅是估算
EXPLAIN ANALYZE SELECT * FROM users u
JOIN orders o ON u.id = o.user_id
WHERE u.age > 25;
```

输出示例：

```
-> Nested loop inner join  (cost=4.95 rows=15) (actual time=0.045..0.102 rows=15 loops=1)
    -> Index lookup on u using idx_age (age > 25)  (cost=1.10 rows=5) (actual time=0.028..0.038 rows=5 loops=1)
    -> Index lookup on o using idx_user_id (user_id = u.id)  (cost=0.68 rows=3) (actual time=0.010..0.012 rows=3 loops=5)
```

**关键信息：**

- `cost`: 估算成本
- `rows`: 估算行数
- `actual time`: 实际执行时间（毫秒）
- `loops`: 执行次数

### 3.3 EXPLAIN FORMAT=TREE（MySQL 8.0.16+）

```sql
-- 树形格式，更容易理解
EXPLAIN FORMAT=TREE SELECT * FROM users u
JOIN orders o ON u.id = o.user_id
WHERE u.age > 25;
```

输出：

```
-> Nested loop inner join  (cost=4.95 rows=15)
    -> Index lookup on u using idx_age (age > 25)  (cost=1.10 rows=5)
    -> Index lookup on o using idx_user_id (user_id = u.id)  (cost=0.68 rows=3)
```

### 3.4 常见 EXPLAIN 结果解读

| 场景 | type | Extra | 说明 | 优化建议 |
|------|------|-------|------|----------|
| 全表扫描 | ALL | Using where | 最差 | 添加合适索引 |
| 全索引扫描 | index | Using index | 索引全扫描 | 检查 WHERE 条件 |
| 范围扫描 | range | Using index condition | 范围查询 | 可接受 |
| 非唯一索引 | ref | Using index | 等值查询 | 良好 |
| 唯一索引 | eq_ref | - | 连接查询最优 | 最佳 |
| 主键查询 | const | - | 最快 | 最佳 |
| 使用临时表 | ALL | Using temporary | 需要优化 | GROUP BY/ORDER BY 优化 |
| 文件排序 | ALL | Using filesort | 需要优化 | ORDER BY 列加索引 |

## 4. 最佳实践

1. **定期更新统计信息** — `ANALYZE TABLE` 或依赖自动持久化，统计不准是执行计划跑偏的常见根因
2. **用 Optimizer Trace 排查慢查询** — 看清优化器为什么这么选
3. **谨慎使用 FORCE INDEX / Hint** — 优先让优化器自主选择，只在确认选错时干预
4. **开发环境用 EXPLAIN ANALYZE** — 拿到实际执行时间，而不只是估算
5. **关注 rows 和 filtered** — 估算扫描行数越少越好
6. **关注 Extra 列** — 出现 Using temporary / Using filesort 需要优化
7. **type 至少达到 range 级别** — ALL 表示全表扫描，必须优化
8. **key_len 越短越好** — 说明索引使用效率高
