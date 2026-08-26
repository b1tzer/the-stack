# 索引优化实践

## 1. 索引下推 (ICP)

```sql
-- MySQL 5.6+ 自动启用
SELECT * FROM users WHERE name LIKE '张%' AND age = 25;
-- 在 idx_name_age 索引层直接过滤 age，减少回表
```

## 2. MRR (Multi-Range Read)

```sql
-- 优化随机 IO
SELECT * FROM users WHERE age BETWEEN 20 AND 30;
-- 先收集主键，排序后顺序回表
```

## 3. 索引合并

```sql
-- 多个索引条件交集
SELECT * FROM users WHERE name = '张三' AND age = 25;
-- 可能同时使用 idx_name 和 idx_age
```

## 4. 优化建议

1. 优先使用覆盖索引
2. 联合索引把选择性高的列放前面
3. 避免过多索引（影响写入性能）
4. 定期分析索引使用情况

```sql
-- 查看未使用的索引
SELECT * FROM sys.schema_unused_indexes;
```

## 5. 索引跳跃扫描 (Index Skip Scan)

MySQL 8.0.13+ 引入，当联合索引的前缀列选择性低时，优化器可以跳过前缀列。

```sql
-- 联合索引 idx_gender_age(gender, age)
-- gender 只有 'M'/'F' 两个值
SELECT * FROM users WHERE age = 25;
-- MySQL 8.0.13+ 可以使用索引跳过扫描
-- 等价于：SELECT * FROM users WHERE gender = 'M' AND age = 25
--          UNION ALL
--          SELECT * FROM users WHERE gender = 'F' AND age = 25

-- 查看是否使用了 Skip Scan
EXPLAIN SELECT * FROM users WHERE age = 25;
-- Extra 列会显示 Using index for skip scan
```

## 6. 降序索引 (Descending Index)

MySQL 8.0+ 支持真正的降序索引。

```sql
-- 创建降序索引
CREATE INDEX idx_time_desc ON orders(created_at DESC);

-- 查询可以利用降序索引，避免 filesort
SELECT * FROM orders ORDER BY created_at DESC LIMIT 10;

-- 联合索引混合排序
CREATE INDEX idx_a_asc_b_desc ON t(a ASC, b DESC);
-- SELECT * FROM t ORDER BY a ASC, b DESC; -- 完美匹配
```

## 7. 不可见索引 (Invisible Index)

```sql
-- 将索引设为不可见（优化器不再使用，但仍然维护）
ALTER TABLE users ALTER INDEX idx_email INVISIBLE;

-- 查看索引可见性
SELECT index_name, is_visible FROM information_schema.statistics
WHERE table_name = 'users';

-- 恢复可见
ALTER TABLE users ALTER INDEX idx_email VISIBLE;

-- 用途：
-- 1. 测试删除索引的影响，无需真正删除
-- 2. 临时禁用索引排查性能问题
```

## 8. 索引监控与分析

```sql
-- 查看索引使用情况（MySQL 8.0+）
SELECT
    object_schema,
    object_name,
    index_name,
    count_read,
    count_write,
    count_fetch
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE object_schema = 'mydb'
ORDER BY count_read DESC;

-- 查看未使用的索引
SELECT * FROM sys.schema_unused_indexes
WHERE object_schema = 'mydb';

-- 查看冗余索引
SELECT * FROM sys.schema_redundant_indexes
WHERE table_schema = 'mydb';

-- 索引大小统计
SELECT
    database_name,
    table_name,
    index_name,
    stat_value AS pages,
    ROUND(stat_value * @@innodb_page_size / 1024 / 1024, 2) AS size_mb
FROM mysql.innodb_index_stats
WHERE stat_name = 'size' AND database_name = 'mydb'
ORDER BY stat_value DESC;
```

## 9. 最佳实践总结

| 优化手段 | 场景 | 效果 |
|---------|------|------|
| 覆盖索引 | SELECT 列都在索引中 | 避免回表，性能提升 10-100 倍 |
| ICP | 索引包含过滤条件 | 减少回表次数 |
| MRR | 范围查询回表 | 减少随机 IO |
| Index Skip Scan | 联合索引前缀选择性低 | 避免全表扫描 |
| 降序索引 | ORDER BY DESC | 避免 filesort |
| 不可见索引 | 测试索引影响 | 安全验证 |

