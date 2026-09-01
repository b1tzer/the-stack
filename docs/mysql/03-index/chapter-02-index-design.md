# 索引设计

## 1. 前缀索引

```sql
-- 字符串字段只索引前 N 个字符
CREATE INDEX idx_email_prefix ON users(email(10));
```

## 2. 联合索引

```sql
-- 最左前缀原则
CREATE INDEX idx_a_b_c ON users(a, b, c);
-- 能用：WHERE a=1
-- 能用：WHERE a=1 AND b=2
-- 能用：WHERE a=1 AND b=2 AND c=3
-- 不能用：WHERE b=2
-- 不能用：WHERE c=3
```

## 3. 索引选择

| 场景 | 建议 |
|------|------|
| 高选择性列 | 适合索引（如 email） |
| 低选择性列 | 不适合索引（如 status） |
| 频繁查询 | 必须索引 |
| 频繁更新 | 谨慎索引 |

## 4. 联合索引设计实战

**场景：电商订单查询**
```sql
-- 典型查询模式
SELECT * FROM orders WHERE user_id = 100 AND status = 'paid' ORDER BY created_at DESC;
SELECT * FROM orders WHERE user_id = 100 AND status = 'paid' AND amount > 100;

-- 最佳索引设计
CREATE INDEX idx_user_status_time ON orders(user_id, status, created_at);
-- user_id: 等值查询，放在最前
-- status: 等值查询，放在第二
-- created_at: 排序/范围查询，放在最后
```

**联合索引列顺序原则：**
1. 等值查询的列放前面
2. 范围查询的列放后面
3. 排序需求的列放在范围查询列之前
4. 选择性（区分度）高的列优先考虑

```sql
-- 查看列的选择性
SELECT
    COUNT(DISTINCT user_id) / COUNT(*) AS user_selectivity,
    COUNT(DISTINCT status) / COUNT(*) AS status_selectivity,
    COUNT(DISTINCT created_at) / COUNT(*) AS time_selectivity
FROM orders;
```

## 5. 索引设计反模式

**反模式 1：过多索引**
```sql
-- ❌ 每个查询都建索引
CREATE INDEX idx_a ON t(a);
CREATE INDEX idx_b ON t(b);
CREATE INDEX idx_c ON t(c);
CREATE INDEX idx_a_b ON t(a, b);
CREATE INDEX idx_a_c ON t(a, c);
-- 索引过多影响写入性能

-- ✅ 合并索引
CREATE INDEX idx_a_b_c ON t(a, b, c);  -- 覆盖多个查询
```

**反模式 2：索引列顺序不当**
```sql
-- ❌ 范围查询列放前面
CREATE INDEX idx_age_name ON users(age, name);
-- WHERE age > 20 AND name = '张三' → age 范围后 name 无法用索引

-- ✅ 等值查询列放前面
CREATE INDEX idx_name_age ON users(name, age);
-- WHERE name = '张三' AND age > 20 → 两个条件都能用索引
```

**反模式 3：重复索引**
```sql
-- ❌ 重复索引
CREATE INDEX idx_name ON users(name);
CREATE INDEX idx_name_email ON users(name, email);
-- idx_name 是 idx_name_email 的前缀，完全多余

-- 检查重复索引
SELECT * FROM sys.schema_redundant_indexes;
```

## 6. 索引设计 Checklist

| 检查项 | 说明 |
|--------|------|
| WHERE 条件列 | 频繁出现在 WHERE 中的列需要索引 |
| JOIN 关联列 | 被驱动表的关联列需要索引 |
| ORDER BY 列 | 排序列可以纳入联合索引 |
| GROUP BY 列 | 分组列可以纳入联合索引 |
| 覆盖索引 | 查询列都在索引中避免回表 |
| 无冗余索引 | 检查是否有重复或被包含的索引 |
| 无过多索引 | 一般不超过 5-6 个索引 |

## 7. 最佳实践

1. **先分析查询模式再设计索引** — 根据实际 SQL 建索引
2. **联合索引优先于多个单列索引** — 一个联合索引可以覆盖多个查询
3. **覆盖索引是最优解** — 查询列都在索引中，无需回表
4. **前缀索引用于长字符串** — 减少索引空间，但不能用于 ORDER BY
5. **定期审查索引使用情况** — 删除未使用和重复的索引
6. **使用 EXPLAIN 验证索引效果** — 确认索引被正确使用

