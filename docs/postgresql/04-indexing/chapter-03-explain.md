---
doc_id: pg-explain
title: EXPLAIN 与查询处理
---

# EXPLAIN 与查询处理

> **核心问题**：如何用 EXPLAIN 分析执行计划？查询处理流程是什么？如何优化慢查询？

## 1. 查询处理流程

```
SQL → Parser → Analyzer → Rewriter → Planner/Optimizer → Executor → 结果
```

| 阶段 | 说明 |
| :-- | :-- |
| Parser | 语法检查，生成语法树 |
| Analyzer | 语义检查，解析表名/列名 |
| Rewriter | 规则重写（视图展开） |
| Planner | 生成执行计划，选择最优路径 |
| Executor | 执行计划，返回结果 |

## 2. EXPLAIN 基本用法

```sql
-- 查看执行计划（不实际执行）
EXPLAIN SELECT * FROM users WHERE age > 25;

-- 实际执行计划（真正执行，显示真实耗时）
EXPLAIN ANALYZE SELECT * FROM users WHERE age > 25;

-- 显示缓冲区使用情况
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM users WHERE age > 25;

-- JSON 格式输出
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM users WHERE age > 25;

-- 显示详细信息
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, COSTS, TIMING, SUMMARY)
SELECT * FROM users WHERE age > 25;
```

## 3. 执行计划解读

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
| :-- | :-- |
| cost=启动代价..总代价 | 优化器估算的代价（不是时间） |
| actual time=首行时间..总时间 | 真实耗时（毫秒） |
| rows | 实际返回的行数 |
| loops | 节点执行次数（嵌套循环时 > 1） |
| shared hit | 缓存命中的页面数 |
| shared read | 从磁盘读取的页面数 |
| Rows Removed by Filter | 被过滤掉的行数 |

阅读要点：
1. **从内到外读**：最内层的节点先执行
2. **关注 actual time**：首行时间和总时间
3. **对比 estimated vs actual rows**：差异大需要 `ANALYZE` 更新统计信息
4. **关注 Buffers**：`shared hit` 是缓存命中，`shared read` 是磁盘读取

## 4. 常见扫描方式

| 方式 | 说明 | 适用场景 |
| :-- | :-- | :-- |
| Seq Scan | 全表扫描 | 小表或无索引 |
| Index Scan | 索引扫描 + 回表 | 有索引，需回表 |
| Index Only Scan | 仅索引扫描 | 覆盖索引 |
| Bitmap Index Scan | 位图索引扫描 | 多条件组合 |

## 5. 连接方式

| 方式 | 说明 | 适用场景 |
| :-- | :-- | :-- |
| Nested Loop | 嵌套循环 | 小表驱动大表 |
| Hash Join | 哈希连接 | 等值连接，大表 |
| Merge Join | 归并连接 | 已排序数据 |

## 6. 查询计划节点类型

| 节点类型 | 说明 | 触发条件 |
| :-- | :-- | :-- |
| Seq Scan | 全表扫描 | 无索引或选择性低 |
| Index Scan | 索引扫描 + 回表 | 有索引，需要回表取数据 |
| Index Only Scan | 仅索引扫描 | 覆盖索引，不需要回表 |
| Bitmap Index Scan | 位图索引扫描 | 多条件组合，中等选择性 |
| Nested Loop | 嵌套循环连接 | 小表驱动大表 |
| Hash Join | 哈希连接 | 等值连接，大表 |
| Merge Join | 归并连接 | 已排序数据 |
| Sort | 排序 | ORDER BY |
| HashAggregate | 哈希聚合 | GROUP BY |

## 7. 优化器参数

```sql
-- 查看优化器参数
SHOW random_page_cost;       -- 随机 IO 代价（HDD=4.0, SSD=1.1）
SHOW seq_page_cost;          -- 顺序 IO 代价（默认 1.0）
SHOW effective_cache_size;   -- 可用缓存大小

-- 临时调整优化器参数（测试不同执行计划）
SET random_page_cost = 1.1;  -- 模拟 SSD
EXPLAIN SELECT * FROM users WHERE email = 'test@example.com';
```

## 8. 统计信息

```sql
-- 查看表的统计信息
SELECT * FROM pg_stats WHERE tablename = 'users';

-- 手动更新统计信息（大量数据变化后）
ANALYZE users;

-- 增加统计信息采样精度
ALTER TABLE users ALTER COLUMN email SET STATISTICS 1000;
ANALYZE users;
```

> **何时需要手动 ANALYZE**：大量数据批量导入后、数据分布发生显著变化时、优化器选择了明显不优的执行计划时。

## 9. 实用 EXPLAIN 技巧

```sql
-- 技巧1：查看是否有 Sort 溢出磁盘（work_mem 不足）
EXPLAIN ANALYZE SELECT * FROM orders ORDER BY amount DESC;
-- 看到 "Sort Method: external merge Disk" 说明 work_mem 不足

-- 技巧2：查看并行查询是否生效
EXPLAIN ANALYZE SELECT count(*) FROM large_table;
-- 看到 "Parallel Seq Scan" 说明并行查询生效

-- 技巧3：使用 pg_hint_plan 控制执行计划（需要安装扩展）
-- /*+ SeqScan(users) */ SELECT * FROM users WHERE id > 100;
```

## 10. 常见问题

**Q：pg_stat_statements 和 EXPLAIN 的区别？**

> `pg_stat_statements` 用于**发现问题**——找到最耗时、最频繁的 SQL；`EXPLAIN ANALYZE` 用于**分析问题**——查看具体 SQL 的执行计划。先用前者定位问题 SQL，再用后者分析原因。

**Q：random_page_cost 为什么 SSD 要设为 1.1？**

> 默认值 4.0 假设随机 IO 比顺序 IO 慢 4 倍（HDD 场景）。SSD 的随机 IO 和顺序 IO 速度接近，设为 1.1 能让优化器更倾向于使用索引扫描。
