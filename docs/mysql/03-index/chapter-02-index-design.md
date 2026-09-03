# 索引设计

## 1. 索引类型

### 1.1 前缀索引

```sql
-- 字符串字段只索引前 N 个字符
CREATE INDEX idx_email_prefix ON users(email(10));
```

### 1.2 联合索引与最左前缀

联合索引是把多个列组成一个索引键。它和单列索引一样是一棵 B+ 树，区别只在叶子节点按**多列的字典序**排序：先比第一列，第一列相同再比第二列，以此类推。

```txt
联合索引 idx_a_b_c (a, b, c) 的叶子节点，按 (a, b, c) 字典序排列
┌─────────────┐
│ (1, 1, 1)   │
│ (1, 1, 2)   │
│ (1, 2, 1)   │  ← a=1 的区间内，b 有序
│ (1, 2, 5)   │
│ (2, 1, 1)   │  ← a 变到 2，b 又重新从 1 开始
│ (2, 1, 3)   │
└─────────────┘
```

这张图解释了最左前缀的由来：**每一列都依赖它左边的列先确定，才有全局有序可言。**

- `a` 是整棵树的排序键，所有叶子按 `a` 有序，所以 `WHERE a = 1` 能定位到 `a=1` 的连续区间；
- `a` 固定后，`b` 在这个区间内有序，所以 `WHERE a = 1 AND b = 2` 能继续缩小区间；
- 反过来，`WHERE b = 2` 时 `a` 未确定，`b=2` 的记录散落在 `a=1`、`a=2`… 多个区间里，整棵树上 `b` 不是有序的，B+ 树无法定位，只能扫描全部叶子。

```sql
-- 最左前缀原则
CREATE INDEX idx_a_b_c ON users(a, b, c);
-- ✅ 能用：WHERE a=1
-- ✅ 能用：WHERE a=1 AND b=2
-- ✅ 能用：WHERE a=1 AND b=2 AND c=3
-- ❌ 不能用：WHERE b=2          （a 未确定，b 全局乱序）
-- ❌ 不能用：WHERE c=3          （a、b 都未确定，c 更无从定位）
-- ❌ 不能用：WHERE a=1 AND c=3  （跳过了 b，c 依赖 b 先确定）
```

关键结论：**联合索引里每一列的可用性，取决于它左边所有列是否都作为等值条件出现。** 中间跳过一列，后面的列就无法沿树定位。这就是「最左前缀」的字面意思——只能从最左边开始，连续命中。

## 2. 索引设计

### 2.1 索引选择与选择性

选哪些列建索引，看的是「这个条件能过滤掉多少行」，而非列的取值个数本身。衡量指标是选择性（区分度）：

```sql
-- 选择性 = 去重后的取值数 / 总行数，越接近 1 越好
SELECT COUNT(DISTINCT col) / COUNT(*) FROM t;
```

「低选择性列不适合建索引」只说对了一半，需要补上使用场景：

- **单独建索引时**：`status` 这类只有几个取值的列，单列索引区分度低，优化器可能算下来不如全表扫描，于是放弃索引。
- **放进联合索引时**：`status` 作为后续列仍有价值。例如 `(user_id, status)`，`user_id` 等值已经筛掉绝大部分行，`status` 再把结果切成几份，进一步缩小扫描区间。

判断标准不是「列有多少个不同值」，而是「在特定查询里，这个条件能把扫描范围缩小多少」。同一个 `status`，单独建索引可能被忽略，放在 `user_id` 后面却很有用——取决于左边的列先筛掉了多少。

| 场景 | 建议 |
| :-- | :-- |
| 高选择性列 | 适合单独建索引（如 `email`） |
| 低选择性列 | 单独建索引收益低，作为联合索引的后续列仍有价值 |
| 频繁出现在 `WHERE` | 值得索引 |
| 频繁 `UPDATE` | 谨慎索引，写入要同步维护 |

### 2.2 联合索引设计实战

联合索引的列怎么排，取决于查询里的三类条件怎么配合。先看一个真实场景：

```sql
-- 电商订单的两条高频查询
SELECT * FROM orders WHERE user_id = 100 AND status = 'paid' ORDER BY created_at DESC;
SELECT * FROM orders WHERE user_id = 100 AND status = 'paid' AND amount > 100;
```

两条 SQL 的共同点是：`user_id`、`status` 是等值条件，`created_at` 负责排序，`amount` 是范围条件。要把这些条件塞进一个联合索引，先搞清两件事。

**第一，等值条件缩小范围，让后面的列保持有序。**

`(user_id, status, created_at)` 这棵树的叶子按 `user_id` → `status` → `created_at` 三级排序。`user_id = 100` 把扫描范围缩到 `user_id=100` 的连续区间，`status = 'paid'` 再缩到更小的连续区间。在这个区间里，`created_at` 是有序的——`ORDER BY created_at DESC` 直接顺着索引顺序读，不用再排序。

**第二，范围条件会打断后面列的有序性。**

范围条件（`>`、`<`、`BETWEEN`、`LIKE 'x%'`）命中多个值，这之后列的顺序不再全局有序。所以范围列要放在等值列之后：等值列先把范围缩得足够小，范围列再做最后一段筛选。

按这两条规则排出候选方案，逐一对照两条 SQL：

| 方案 | 索引 | 第一条 SQL（`ORDER BY created_at DESC`） | 第二条 SQL（`amount > 100`） |
| :-- | :-- | :-- | :-- |
| A | `(user_id, status, created_at)` | `user_id`、`status` 定位，`created_at` 有序，无排序 | `user_id`、`status` 定位，`amount` 回表过滤 |
| B | `(user_id, created_at, status)` | 只用到 `user_id`；`status` 依赖 `created_at` 先确定而用不上，排序也借不到索引 | `user_id` 定位，`status`、`amount` 回表过滤 |
| C | `(user_id, status)` + 单独 `(created_at)` | `user_id`、`status` 定位，但 `ORDER BY` 仍需排序 | 同方案 A，但多维护一个索引 |

- **方案 A**：一个索引同时满足两条 SQL，第一条还省掉了排序，最优。
- **方案 B**：`status` 是等值条件却被排到了排序键 `created_at` 之后。第一条 SQL 里 `status='paid'` 夹在 `user_id` 和 `ORDER BY created_at` 之间，既无法用索引定位，又破坏了索引的排序连续性，实际只落得 `user_id` 一列能用。
- **方案 C**：多建一个索引也没解决排序问题，`(created_at)` 是冗余的。

最终结论：

```sql
-- ✅ 一个联合索引覆盖两条高频查询
CREATE INDEX idx_user_status_time ON orders(user_id, status, created_at);
```

由此得到联合索引的列顺序原则：

1. 等值查询的列放前面，范围查询的列放后面；
2. 排序（`ORDER BY`）的列放在范围列之前，紧跟在等值列之后；
3. 选择性高的列优先放前面——但低选择性列作为后续列仍有价值，见 §2.1。

```sql
-- 查看各列的选择性
SELECT
    COUNT(DISTINCT user_id) / COUNT(*)    AS user_selectivity,
    COUNT(DISTINCT status) / COUNT(*)     AS status_selectivity,
    COUNT(DISTINCT created_at) / COUNT(*) AS time_selectivity
FROM orders;
```

### 2.3 索引设计反模式

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

## 3. Checklist 与最佳实践

### 3.1 索引设计 Checklist

| 检查项 | 说明 |
| :-- | :-- |
| WHERE 条件列 | 频繁出现在 WHERE 中的列需要索引 |
| JOIN 关联列 | 被驱动表的关联列需要索引 |
| ORDER BY 列 | 排序列可以纳入联合索引 |
| GROUP BY 列 | 分组列可以纳入联合索引 |
| 覆盖索引 | 查询列都在索引中避免回表 |
| 无冗余索引 | 检查是否有重复或被包含的索引 |
| 无过多索引 | 一般不超过 5-6 个索引 |

### 3.2 最佳实践

1. **先分析查询模式再设计索引** — 根据实际 SQL 建索引
2. **联合索引优先于多个单列索引** — 一个联合索引可以覆盖多个查询
3. **覆盖索引是最优解** — 查询列都在索引中，无需回表
4. **前缀索引用于长字符串** — 减少索引空间，但不能用于 ORDER BY
5. **定期审查索引使用情况** — 删除未使用和重复的索引
6. **使用 EXPLAIN 验证索引效果** — 确认索引被正确使用
