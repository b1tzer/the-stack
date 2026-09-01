# 索引使用与失效

## 1. 索引失效场景

```sql
-- 函数操作
WHERE YEAR(created_at) = 2024  -- ❌ 失效
WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01'  -- ✅

-- 隐式类型转换
WHERE phone = 13800138000  -- ❌ phone 是 VARCHAR
WHERE phone = '13800138000'  -- ✅

-- LIKE 左模糊
WHERE name LIKE '%张'  -- ❌ 失效
WHERE name LIKE '张%'  -- ✅

-- OR 条件
WHERE a = 1 OR b = 2  -- ❌ 如果 b 没索引
WHERE a = 1 UNION SELECT * FROM users WHERE b = 2  -- ✅
```

**不等于操作：**
```sql
-- NOT IN、NOT EXISTS、!=、<> 通常不走索引
WHERE status != 'deleted'  -- ❌ 如果 status 选择性低
WHERE status != 'deleted'  -- ✅ 如果 status 选择性高，优化器可能选择索引

-- 替代方案
WHERE status IN ('active', 'pending', 'completed')  -- ✅ 用 IN 替代 !=
```

**IS NULL / IS NOT NULL：**
```sql
-- MySQL 8.0 优化后，IS NULL 可以走索引
WHERE email IS NULL     -- ✅ 可以走索引
WHERE email IS NOT NULL -- ✅ 可以走索引（取决于选择性）
```

**范围查询后的列：**
```sql
-- 联合索引 (a, b, c)
WHERE a = 1 AND b > 10 AND c = 20  -- b 是范围查询，c 无法用索引
-- 只能用到 a 和 b 的索引

-- 解决方案：调整索引顺序
CREATE INDEX idx_a_c_b ON t(a, c, b);  -- c 等值放前面，b 范围放后面
```

**OR 条件：**
```sql
-- OR 两边的列都有索引才行
WHERE a = 1 OR b = 2  -- ❌ 如果 b 没有索引

-- 替代方案
SELECT * FROM t WHERE a = 1
UNION
SELECT * FROM t WHERE b = 2;  -- ✅ 分别走索引

-- 或者确保两边都有索引
CREATE INDEX idx_a ON t(a);
CREATE INDEX idx_b ON t(b);
-- 优化器会使用 Index Merge
```

**数据类型不匹配：**
```sql
-- 字符串列不加引号
WHERE username = 12345  -- ❌ 隐式转换
WHERE username = '12345'  -- ✅

-- 字符集不匹配
-- 表用 utf8mb4，连接用 latin1 → 隐式转换 → 索引失效
```

## 2. 索引失效判断方法

```sql
EXPLAIN SELECT * FROM users WHERE name = '张三';
```

| 字段 | 说明 |
|------|------|
| type | ALL(全表扫描) → index → range → ref → eq_ref → const |
| key | 实际使用的索引 |
| rows | 预估扫描行数 |
| Extra | Using index/Using where/Using temporary/Using filesort |

```sql
-- 观察 key 列：NULL 表示没走索引

-- 使用 EXPLAIN FORMAT=JSON 查看详细信息
EXPLAIN FORMAT=JSON SELECT * FROM users WHERE YEAR(created_at) = 2024;
-- 查看 "used_key_parts" 是否为空

-- 使用 EXPLAIN ANALYZE 查看实际执行情况（MySQL 8.0+）
EXPLAIN ANALYZE SELECT * FROM users WHERE name = '张三';
```

## 3. 强制使用/忽略索引

```sql
-- 强制使用指定索引
SELECT * FROM users FORCE INDEX(idx_name) WHERE name = '张三';

-- 忽略指定索引
SELECT * FROM users IGNORE INDEX(idx_age) WHERE age > 25;

-- 建议使用索引（优化器可能不采纳）
SELECT * FROM users USE INDEX(idx_name) WHERE name = '张三';
```

## 4. 最佳实践

1. **避免在索引列上使用函数** — 改用范围查询或函数索引
2. **保持数据类型一致** — 避免隐式类型转换
3. **LIKE 查询以通配符开头时考虑全文索引**
4. **OR 条件确保两边都有索引** — 或改用 UNION
5. **定期用 EXPLAIN 验证关键查询** — 确保索引被正确使用

