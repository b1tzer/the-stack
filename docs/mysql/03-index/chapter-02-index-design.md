# 索引设计

> 好的索引设计可以让查询从"全表扫描"变成"索引定位"，性能差距可达百倍。

## 1. 索引设计原则

### 最左前缀原则

```sql
-- 联合索引 (a, b, c)
-- 可以用到索引的查询：
WHERE a = 1
WHERE a = 1 AND b = 2
WHERE a = 1 AND b = 2 AND c = 3
WHERE a = 1 AND c = 3          -- 只用到 a
WHERE a = 1 ORDER BY b         -- 用到 a 和 b 排序

-- 用不到索引的查询：
WHERE b = 2                    -- 跳过了 a
WHERE b = 2 AND c = 3          -- 跳过了 a
```

### 区分度高的列放前面

```sql
-- user_id 区分度高（几万个值），status 区分度低（几个值）
-- 好的索引：(user_id, status)
-- 差的索引：(status, user_id)
```

### 覆盖索引

```sql
-- 查询只需要索引中的列，不需要回表
SELECT user_id, status FROM orders WHERE user_id = 100;
-- 索引 (user_id, status) 包含所有需要的列
```

## 2. 索引失效场景

| 场景 | 示例 | 解决方案 |
|------|------|----------|
| 函数包裹 | `WHERE YEAR(date) = 2026` | 改为范围查询 |
| 隐式转换 | `WHERE varchar_col = 123` | 类型匹配 |
| LIKE 前缀 | `WHERE name LIKE '%张'` | 改为后缀匹配 |
| OR 条件 | `WHERE a = 1 OR b = 2` | 拆分为 UNION |
| NOT IN/NOT EXISTS | `WHERE id NOT IN (...)` | 改为 LEFT JOIN |
| IS NULL | `WHERE col IS NULL` | 看版本，8.0+ 通常可以 |

## 3. 索引维护

```sql
-- 查看索引使用情况
SELECT * FROM sys.schema_unused_indexes;      -- 未使用的索引
SELECT * FROM sys.schema_redundant_indexes;    -- 冗余索引

-- 删除无用索引
ALTER TABLE orders DROP INDEX idx_unused;
```

## 4. 索引数量控制

- 单表索引不超过 5-6 个
- 每个索引都有写入开销（INSERT/UPDATE/DELETE 要维护索引）
- 优先保留高频查询需要的索引
