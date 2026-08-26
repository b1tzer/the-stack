# EXPLAIN/ANALYZE

## 1. 基本用法

```sql
EXPLAIN SELECT * FROM users WHERE age > 25;
EXPLAIN ANALYZE SELECT * FROM users WHERE age > 25;  -- 实际执行
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM users WHERE age > 25;
```

## 2. 执行计划解读

```
Seq Scan on users  (cost=0.00..15.00 rows=500 width=16)
  Filter: (age > 25)
```

- cost：启动代价..总代价
- rows：估计行数
- width：平均行宽（字节）

## 3. 常见扫描方式

| 方式 | 说明 | 适用场景 |
|------|------|---------|
| Seq Scan | 全表扫描 | 小表或无索引 |
| Index Scan | 索引扫描 | 有索引，需回表 |
| Index Only Scan | 仅索引扫描 | 覆盖索引 |
| Bitmap Index Scan | 位图索引扫描 | 多条件组合 |

## 4. 连接方式

| 方式 | 说明 | 适用场景 |
|------|------|---------|
| Nested Loop | 嵌套循环 | 小表驱动大表 |
| Hash Join | 哈希连接 | 等值连接，大表 |
| Merge Join | 归并连接 | 已排序数据 |
## 5. 执行计划详解

### 5.1 EXPLAIN 选项

```sql
-- 基本执行计划（不实际执行）
EXPLAIN SELECT * FROM users WHERE age > 25;

-- 实际执行计划（真正执行，显示真实耗时）
EXPLAIN ANALYZE SELECT * FROM users WHERE age > 25;

-- 显示缓冲区使用情况
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM users WHERE age > 25;

-- JSON 格式输出（便于程序解析）
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM users WHERE age > 25;

-- YAML 格式
EXPLAIN (ANALYZE, BUFFERS, FORMAT YAML) SELECT * FROM users WHERE age > 25;

-- 显示详细信息
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, COSTS, TIMING, SUMMARY)
SELECT * FROM users WHERE age > 25;
```

### 5.2 执行计划节点详解

```sql
-- 示例：多表关联查询
EXPLAIN (ANALYZE, BUFFERS)
SELECT u.name, o.total
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE o.created_at > '2024-01-01';
```

输出解读：
```
Hash Join  (cost=1.15..2.45 rows=3) (actual time=0.05..0.08 rows=3 loops=1)
  Hash Cond: (o.user_id = u.id)
  Buffers: shared hit=4
  ->  Seq Scan on orders o  (cost=0.00..1.25 rows=3)
        Filter: (created_at > '2024-01-01')
        Rows Removed by Filter: 7
  ->  Hash  (cost=1.10..1.10 rows=10)
        Buckets: 1024  Batches: 1
        ->  Seq Scan on users u  (cost=0.00..1.10 rows=10)
```

| 指标 | 含义 |
|------|------|
| cost=启动代价..总代价 | 优化器估算的代价（不是时间） |
| actual time=首行时间..总时间 | 真实耗时（毫秒） |
| rows | 实际返回的行数 |
| loops | 节点执行次数（嵌套循环时 > 1） |
| shared hit | 缓存命中的页面数 |
| shared read | 从磁盘读取的页面数 |
| Rows Removed by Filter | 被过滤掉的行数 |

### 5.3 优化器选择因素

```sql
-- 查看优化器参数
SHOW random_page_cost;       -- 随机 IO 代价（HDD=4.0, SSD=1.1）
SHOW seq_page_cost;          -- 顺序 IO 代价（默认 1.0）
SHOW cpu_tuple_cost;         -- CPU 处理每行的代价
SHOW cpu_index_tuple_cost;   -- CPU 处理索引行的代价
SHOW effective_cache_size;   -- 可用缓存大小

-- 临时调整优化器参数（测试不同执行计划）
SET random_page_cost = 4.0;  -- 模拟 HDD
EXPLAIN SELECT * FROM users WHERE email = 'test@example.com';

SET random_page_cost = 1.1;  -- 模拟 SSD
EXPLAIN SELECT * FROM users WHERE email = 'test@example.com';
```

### 5.4 统计信息与 ANALYZE

```sql
-- 查看表的统计信息
SELECT * FROM pg_stats WHERE tablename = 'users';

-- 查看列的基数（不同值的数量）
SELECT attname, n_distinct, most_common_vals, histogram_bounds
FROM pg_stats WHERE tablename = 'users';

-- 手动更新统计信息（大量数据变化后）
ANALYZE users;

-- 增加统计信息采样精度
ALTER TABLE users ALTER COLUMN email SET STATISTICS 1000;
ANALYZE users;
```

> **何时需要手动 ANALYZE**：大量数据批量导入后、数据分布发生显著变化时、优化器选择了明显不优的执行计划时。autovacuum 会自动执行 ANALYZE，但可能不够及时。

### 5.5 实用 EXPLAIN 技巧

```sql
-- 技巧1：查看是否有 Sort 溢出磁盘（work_mem 不足）
EXPLAIN ANALYZE SELECT * FROM orders ORDER BY amount DESC;
-- 看到 "Sort Method: external merge Disk" 说明 work_mem 不足

-- 技巧2：查看并行查询是否生效
EXPLAIN ANALYZE SELECT count(*) FROM large_table;
-- 看到 "Parallel Seq Scan" 说明并行查询生效

-- 技巧3：对比有无索引的执行计划
EXPLAIN SELECT * FROM users WHERE email = 'test@example.com';
CREATE INDEX idx_users_email ON users(email);
EXPLAIN SELECT * FROM users WHERE email = 'test@example.com';
DROP INDEX idx_users_email;

-- 技巧4：使用 pg_hint_plan 控制执行计划（需要安装扩展）
-- /*+ SeqScan(users) */ SELECT * FROM users WHERE id > 100;
```
