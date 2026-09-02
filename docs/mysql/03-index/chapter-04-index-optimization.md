# 索引优化实践

本文回答一个问题：索引建好之后，MySQL 会在哪些场景自动优化查询，这些优化各自对应你建索引时的哪个决策。全文分三部分——优化器自动做的三件事、索引自身的三个能力边界、以及用数据判断索引去留。

## 1. 优化器自动做的三件事

ICP、MRR、索引合并都由优化器在查询时自动触发，你不需要手动开启。读懂它们的意义有两个：一是看懂 `EXPLAIN` 的 `Extra` 字段，二是理解「为什么这样建索引更好」。

### 1.1 索引下推（ICP）

MySQL 5.6+ 引入。索引下推解决的是「回表带回一堆无用行」的问题。

以 `WHERE name LIKE '张%' AND age = 25` 为例，联合索引是 `(name, age)`：

- 不用 ICP：索引只用 `name` 定位，找到所有姓「张」的行后**全部回表**，回到 Server 层再用 `age = 25` 过滤。`age` 不满足的行白回了一次表。
- 用 ICP：`age` 也在索引里，遍历索引时就能判断 `age = 25`，不满足的行**根本不用回表**。

ICP 的价值前提是过滤列在联合索引里。它说明一条规则：联合索引里多放一个用于过滤的列，过滤就能发生在索引层，回表次数随之减少。

```sql
SELECT * FROM users WHERE name LIKE '张%' AND age = 25;
-- 联合索引 (name, age)：EXPLAIN 的 Extra 显示 Using index condition
```

### 1.2 多范围读取（MRR）

MySQL 5.6+ 引入。MRR 解决的是「回表时的随机磁盘 IO」。

范围查询（如 `age BETWEEN 20 AND 30`）在二级索引里找到的主键是按 `age` 排序的，主键值是乱的。传统做法是「找到一个主键就回一次表」，磁盘读取顺序跳来跳去，产生大量随机 IO。

MRR 改的是回表顺序：先把所有主键收集进缓冲区，**按主键排序后再回表**。因为 InnoDB 表数据按主键物理存放，按主键顺序读就变成了顺序扫描，把多次随机寻道换成一次连续读取。

```sql
SELECT * FROM users WHERE age BETWEEN 20 AND 30;
-- EXPLAIN 的 Extra 显示 Using MRR
```

MRR 默认开启（`optimizer_switch` 中 `mrr=on, mrr_cost_based=on`），优化器按成本判断是否使用。它不减少回表次数，只降低每次回表的寻道成本；真正治本的是下文覆盖索引——直接不回表。

### 1.3 索引合并（Index Merge）

索引合并是在「没有合适联合索引」时，优化器同时使用多个单列索引，再把结果合并（交集或并集）。

```sql
SELECT * FROM users WHERE name = '张三' AND age = 25;
-- 只有 idx_name 和 idx_age 两个单列索引时，
-- 优化器可能分别扫两个索引，再对主键取交集
```

索引合并是补救，不是首选。一个 `(name, age)` 联合索引通常比两个单列索引合并更快，且索引合并是否触发受成本估算影响、并不稳定。它的意义在于：看到执行计划里出现 `Using union / Using intersect`，说明该考虑补一个联合索引了。

## 2. 索引自身的三个能力边界

这一节的三个特性改变的是「索引在什么条件下能用」，前两个扩展索引的使用边界，最后一个是你管理索引的工具。

### 2.1 索引跳跃扫描（Index Skip Scan）

联合索引要求查询条件带上前缀列才能命中，但当前缀列基数极低时，MySQL 8.0.13+ 可以跳过它。

联合索引 `(gender, age)`，`gender` 只有 `'M'` / `'F'` 两个值，查询只写 `WHERE age = 25` 时，优化器把 `gender` 的两个取值各枚举一遍，等价于：

```sql
SELECT * FROM users WHERE gender = 'M' AND age = 25
UNION ALL
SELECT * FROM users WHERE gender = 'F' AND age = 25;
```

效果是：即使查询没带头列，也能用上索引，避免全表扫描。`EXPLAIN` 的 `Extra` 显示 `Using index for skip scan`。

### 2.2 降序索引（Descending Index）

MySQL 8.0 之前，索引只能按升序存储，`ORDER BY col DESC` 需要额外排序（filesort）。8.0 起索引可以真正按降序存储：

```sql
CREATE INDEX idx_time_desc ON orders(created_at DESC);
SELECT * FROM orders ORDER BY created_at DESC LIMIT 10;
-- 直接用索引，Extra 不再出现 Using filesort
```

它还支持混合排序，让 `ORDER BY a ASC, b DESC` 这类查询也能完全走索引：

```sql
CREATE INDEX idx_a_asc_b_desc ON t(a ASC, b DESC);
SELECT * FROM t ORDER BY a ASC, b DESC;
```

### 2.3 不可见索引（Invisible Index）

MySQL 8.0+ 引入。不可见索引保留在表中、正常维护，但优化器默认不考虑它。用途是安全地验证「删掉这个索引会怎样」，而不必真的删除：

```sql
ALTER TABLE users ALTER INDEX idx_email INVISIBLE;   -- 设为不可见
ALTER TABLE users ALTER INDEX idx_email VISIBLE;     -- 恢复可见
```

观察一段时间查询表现，若没有退化，再真正删除；若有影响，直接恢复可见即可。

## 3. 用数据决定索引去留

索引不是免费资产：每多建一个索引，插入、更新、删除时就要多维护一棵 B+ 树（写放大），同时额外占用磁盘与缓冲池内存。用不上的索引是纯成本。本节的目标是用数据找出「占着维护成本、却没换来查询收益」的索引，安全下线它们，最终换来更低的写入开销和更小的存储占用。

### 3.1 监控什么、怎么判断

下面四组查询各回答一个去留判断问题。前三个看「有没有被用」，最后一个看「删了能省多少」。

```sql
-- ① 读写次数：count_read 长期为 0 或远小于 count_write，说明几乎没人用它读，是重点怀疑对象（MySQL 5.6+）
SELECT object_schema, object_name, index_name, count_read, count_write, count_fetch
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE object_schema = 'mydb'
ORDER BY count_read DESC;

-- ② 从未使用的索引：直接给出删除候选（MySQL 5.7+，依赖 sys 库）
SELECT * FROM sys.schema_unused_indexes WHERE object_schema = 'mydb';

-- ③ 冗余索引：某索引已被另一个更宽的索引覆盖为最左前缀，删掉它只省成本、不损查询（MySQL 5.7+，依赖 sys 库）
SELECT * FROM sys.schema_redundant_indexes WHERE table_schema = 'mydb';

-- ④ 索引占用空间：size_mb 越大，删掉后释放的磁盘与缓冲池越多
SELECT database_name, table_name, index_name,
       ROUND(stat_value * @@innodb_page_size / 1024 / 1024, 2) AS size_mb
FROM mysql.innodb_index_stats
WHERE stat_name = 'size' AND database_name = 'mydb'
ORDER BY stat_value DESC;
```

用这份数据下判断时，守住三条线：

- **看趋势，不看单点**：`schema_unused_indexes` 统计的是「自性能模式启用以来的累计从未读」，要让服务器跑完一个代表性周期（覆盖周任务、月报这类低频但真实的查询）再看，否则会误删低频索引。
- **三类索引不删**：主键、唯一约束、外键引用对应的索引，即使读数为 0 也不能删，它们承担的是数据完整性，不是查询加速。
- **先不可见、后删除**：对可疑索引先用 §2.3 的不可见索引观察一段时间，确认无退化再真正删除。

### 3.2 决策清单

| 优先级 | 手段 | 什么时候用 | 收益 |
| :-- | :-- | :-- | :-- |
| 首选 | 覆盖索引 | 查询列都能放进索引 | 不回表，收益最大 |
| 常规 | 联合索引（选择性高的列在前） | 多列过滤 / 排序 | 减少回表、避免排序 |
| 补漏 | 索引合并 | 已有多个单列索引、暂无法改 | 免去全表扫描，但弱于联合索引 |
| 扩展 | 降序索引 / Skip Scan | 排序方向或前缀基数特殊 | 让索引在特定场景仍可用 |
| 管理 | 不可见索引 + 监控 | 验证索引是否可删 | 安全下线冗余索引 |
