# 查询执行流程与 EXPLAIN

## 1. 执行流程与优化器

### 1.1 MySQL 8.0 执行流程

```txt
SQL → 连接器 → 解析器 → 优化器 → 执行器 → 存储引擎
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

### 1.5 历史说明：查询缓存（MySQL 8.0 已移除）

MySQL 5.7 及之前的查询缓存，因三个缺陷被移除：

1. 表级别失效，任何修改都导致整表缓存失效
2. 高并发下成为瓶颈（全局锁）
3. 命中率通常很低

替代方案：应用层缓存（Redis）、ProxySQL 查询缓存、连接池复用。

## 2. EXPLAIN 基础

### 2.1 EXPLAIN 基本用法

`EXPLAIN` 是观察执行计划、验证优化器决策的主要工具。它**并不执行查询**——只是让优化器把「打算怎么执行」输出出来；真正执行并报告实际耗时的是 `EXPLAIN ANALYZE`（MySQL 8.0.18+，见 §3.2）。

```sql
EXPLAIN SELECT * FROM users WHERE age > 25;

-- UPDATE / DELETE 同样可以 EXPLAIN（MySQL 5.6+），用于看改写后的执行计划
EXPLAIN UPDATE users SET name = 'x' WHERE age = 25;
```

多表查询时，EXPLAIN 为参与的每张表各输出一行（用到临时表时还会多出一行 `table=temporary`），`id` 列标明这些行的执行顺序。读任何一份 EXPLAIN，建议固定三步：

1. **type 定性质**：这一步是全表扫、走索引，还是精准定位（§2.3）；
2. **key / rows / filtered 定量**：实际用了哪个索引、预估扫描多少行、其中多少行能通过过滤；
3. **Extra 定动作**：有没有额外的回表、临时表、排序（§2.4）。

### 2.2 核心字段

| 字段 | 说明 |
| :-- | :-- |
| `id` | 执行顺序：`id` 相同的行属于同一组，按出现顺序从上到下执行；`id` 不同则数值大的先执行（子查询、派生表） |
| `select_type` | 查询类型：`SIMPLE`（简单查询，无子查询/UNION）、`PRIMARY`（最外层）、`SUBQUERY`、`DERIVED`、`UNION` 等 |
| `table` | 当前步骤访问的表；出现 `temporary` 表示这一步用到了临时表 |
| `type` | 访问类型，决定这一步的性质，详见 §2.3 |
| `possible_keys` | 优化器**评估过**的候选索引，只是候选 |
| `key` | 优化器**实际选用**的索引；`NULL` 表示没有用上索引 |
| `key_len` | 实际用到了联合索引的前多少字节——据此判断是哪几列参与了定位 |
| `ref` | 等值匹配使用的值：常量（`const`）、别的表的列（如 `u.id`），或 `NULL` |
| `rows` | 该步骤的**预估扫描行数**，不是最终返回的结果行数 |
| `filtered` | 扫描行中能通过 WHERE 的百分比；交给下一步的行数约为 `rows × filtered%` |
| `Extra` | 额外动作，详见 §2.4 |

拿 §3.2 用过的同一条两表连接，跑一次传统格式的 EXPLAIN：

```sql
EXPLAIN SELECT u.name, o.amount
FROM users u JOIN orders o ON u.id = o.user_id
WHERE u.age > 25;
```

```txt
id  select_type  table  type   possible_keys  key          key_len  ref    rows  filtered  Extra
1   SIMPLE       u      range  idx_age        idx_age       5       NULL   5     100.00   Using where
1   SIMPLE       o      ref    idx_user_id    idx_user_id   8       u.id   3     100.00   NULL
```

逐列把这份输出读一遍：

- **`id` 都是 1、`select_type` 都是 `SIMPLE`**：没有子查询，两张表属于同一组，按行的先后顺序执行——先扫 `u`，再对 `u` 的每一行去查 `o`。
- **`type=range` + `key=idx_age`**：`u` 上的 `age > 25` 形成一个区间，按范围扫描 `idx_age`；`possible_keys` 只有 `idx_age`，说明优化器没有别的候选。
- **`key_len=5`**：`age` 是 `INT`（4 字节）且允许 `NULL`（+1 字节）。如果查询还用到了联合索引的其他列，key_len 会接近索引总长度；明显偏短就说明只有前几列参与了定位——这正是用 key_len 判断「索引用到了哪几列」的依据。
- **`ref`**：`u` 是 `NULL`——range 扫描不走等值匹配；`o` 用 `u.id` 匹配——「驱动表在前、被驱动表按关联列跟随」在 EXPLAIN 里就是这个样子。
- **`rows`**：`u` 预估扫 5 行；`o` 的 3 是**每次查找**的预估行数，嵌套循环的总扫描量约为 5 × 3。
- **`filtered=100.00`**：扫出来的行全部通过过滤。这个值越低，说明白扫的比例越高——比如 10.00 就意味着九成的行取回来后被丢弃。
- **`Extra=Using where`**：存储引擎交出行之后，Server 层还要再过滤一次；对 `u` 而言就是 `age > 25` 的判断落在这一步。

同一查询换 `EXPLAIN ANALYZE`（§3.2）后，actual rows 的 5 和 3 正好可以与这里的估算对照。估算与实际长期偏差大，通常意味着统计信息过期，先执行 `ANALYZE TABLE`（见 §1.2）。

### 2.3 type 访问类型

type 回答「这一步怎么找行」，是整份 EXPLAIN 里最先要看的一列。按访问代价从高到低（从差到好）：

| type | 说明 |
| :-- | :-- |
| `ALL` | 全表扫描：逐行读主键索引，代价最高 |
| `index` | 全索引扫描：扫完整棵索引树（通常是二级索引），比 `ALL` 略好，但仍是全量 |
| `range` | 范围扫描：按区间读索引；`>`、`BETWEEN`、`LIKE '张%'`、聚合 min/max 都属于这一档 |
| `ref` | 非唯一索引的等值（或前缀等值）查找：命中索引中的一组行 |
| `eq_ref` | 连接中用唯一索引/主键做等值匹配：每个外层行只对应一行，最优的连接访问 |
| `const` | 主键/唯一索引等值匹配常量，优化阶段直接当成常量，至多查一次 |
| `system` | 系统表或只有一行的表，开销可忽略 |

判读要点：

- 看到 **`ALL` / `index` 先查 `rows` 和 `filtered`**：小表、或行数有限的覆盖索引扫描，代价可能完全可接受（见 §4 最佳实践第 7 条）；
- 大表上 `ALL` 且 `rows` 接近表的总行数，基本可以判定要补索引或改写条件；
- 连接查询的优化目标，是把被驱动表压到 **`eq_ref` / `ref`**；范围查询停在 `range` 就是正常水平；`const`、`system` 只在常量查询和特殊表上出现。

### 2.4 Extra 常见值

Extra 描述「type 之外还发生了什么」，每一项都对应一个明确动作：

| Extra | 场景与处理 |
| :-- | :-- |
| `Using index` | 索引本身就答完了查询，不回表——覆盖索引，高效且应争取 |
| `Using where` | 引擎交出行后 Server 层再过滤；若 `rows` 大而 `filtered` 低，说明白扫严重，考虑把过滤列纳入索引 |
| `Using index condition` | 索引下推（ICP）生效：过滤在引擎层提前完成，回表次数减少，是好事 |
| `Using temporary` | `GROUP BY`、`DISTINCT`、`UNION` 等需要临时表；结果集大时会落磁盘，优先让分组列命中索引 |
| `Using filesort` | `ORDER BY` 无法由索引完成；给排序列建联合索引，让排序顺着索引读出来 |
| `Using join buffer` | 连接列上没有可用索引，只能整批匹配（block nested loop）；给被驱动表的关联列补索引 |

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

```txt
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

```txt
-> Nested loop inner join  (cost=4.95 rows=15)
    -> Index lookup on u using idx_age (age > 25)  (cost=1.10 rows=5)
    -> Index lookup on o using idx_user_id (user_id = u.id)  (cost=0.68 rows=3)
```

### 3.4 常见 EXPLAIN 结果解读

| 场景 | type | Extra | 说明 | 优化建议 |
| :-- | :-- | :-- | :-- | :-- |
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
7. **结合查询目标判断 type** — ALL 对小表或无合适索引的查询可能成本最低，出现后先确认行数、过滤率和目标延迟
8. **用 key_len 判断索引使用范围** — 越短不一定越好；需要结合选择性、回表代价和实际扫描行数判断
