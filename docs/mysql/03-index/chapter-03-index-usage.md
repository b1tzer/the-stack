# 索引使用与失效

## 1. 索引失效

### 1.1 失效的总原因：B+ 树只能做「区间定位」

索引失效的根因只有一条：**B+ 树通过「在有序的叶子节点上定位一个连续区间」来检索数据，凡无法翻译成区间的条件，就无法使用索引。**

回顾 [B+ 树索引 §1](./chapter-01-btree-index.md)：InnoDB 的索引是一棵 B+ 树，叶子节点按索引列的值有序排列，查找时先沿树定位到目标区间，再顺着双向链表顺序读取。因此索引只擅长两件事——等值定位（`=`）和范围定位（`>`、`BETWEEN`、`LIKE 'x%'`）。下面每个失效场景，本质都是破坏这两件事之一：要么条件无法翻译成有序区间，要么翻译出的区间太大、回表代价超过全表扫描。

### 1.2 函数操作：索引存的是原始值

二级索引的叶子节点存的是**列的原始值**，并按原始值排序。`WHERE YEAR(created_at) = 2024` 里，索引中只有 `created_at` 的原始时间戳，没有 `YEAR(created_at)` 这个值。B+ 树想定位「`YEAR(created_at) = 2024`」的区间，就必须对每一行现算 `YEAR()`，无法沿树定位，只能全表扫描。

```sql
-- ❌ 函数作用在索引列上，索引失效
SELECT * FROM users WHERE YEAR(created_at) = 2024;

-- ✅ 函数移到常量一侧，索引列保持原样
SELECT * FROM users WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';
```

判断要点：**函数在等号的哪一侧。** 函数作用在索引列上就失效，作用在常量上不影响。

### 1.3 隐式类型转换：本质是「对列做了函数」

这是函数操作的特殊形态——MySQL 替你往列上加了函数。

字符串列与数值比较时，MySQL 不是把数字转成字符串，而是**把列隐式转成 `DOUBLE`**。这等价于对列做 `CAST`，同样破坏索引。MySQL 官方文档对此的说明：

> 字符串类型（`CHAR`、`VARCHAR`、`BINARY`、`VARBINARY`、`BLOB`、`TEXT`、`ENUM`、`SET`）与数值类型比较时，字符串值被 cast 为 `DOUBLE`。（[What Is New in MySQL 8.0](https://dev.mysql.com/doc/refman/8.0/en/mysql-nutshell.html)，8.0.21+）

```sql
-- phone 是 VARCHAR
-- ❌ 等价于 CAST(phone AS DOUBLE) = 13800138000，列被函数包裹，索引失效
SELECT * FROM users WHERE phone = 13800138000;

-- ✅ 常量一侧是字符串，列保持原样，走索引
SELECT * FROM users WHERE phone = '13800138000';
```

用 `EXPLAIN FORMAT=TREE` 能看到 MySQL 注入的 cast：

```sql
EXPLAIN FORMAT=TREE SELECT * FROM users WHERE phone = 13800138000;
-- 输出里出现 cast(users.phone as double)，证明列被转换
```

### 1.4 LIKE 左模糊：无法确定前缀区间

字符串索引按字典序排序，`LIKE` 走索引的前提是**能确定一个前缀**。`LIKE '张%'` 能定位到以「张」开头的连续区间；`LIKE '%张'` 开头是通配符，MySQL 不知道从哪个字符开始，区间无法确定，只能全表扫描。

```sql
-- ❌ 通配符在开头，无法确定前缀区间
SELECT * FROM users WHERE name LIKE '%张';

-- ✅ 通配符在末尾，可定位前缀区间
SELECT * FROM users WHERE name LIKE '张%';
```

### 1.5 范围查询之后的列：最左前缀的延续

这是 [索引设计 §1.2](./chapter-02-index-design.md) 最左前缀原则的具体表现，此处不重复推导，只给结论：

```sql
-- 联合索引 (a, b, c)
SELECT * FROM t WHERE a = 1 AND b > 10 AND c = 20;
-- b 用了范围，b 之后 c 的顺序不再全局有序，c 无法沿树定位，只能用到 a、b

-- ✅ 把范围列放最后，等值列靠前
CREATE INDEX idx_a_c_b ON t(a, c, b);
```

### 1.6 否定条件（!= / NOT IN）：命中太多行，优化器主动放弃

`!=`、`<>`、`NOT IN` 不走索引，不是 B+ 树不支持，而是**语义决定的成本问题**。

`status != 'deleted'` 排除一个值，留下的是其余几乎所有值。B+ 树擅长定位一小段连续区间，否定条件圈定的却是「整棵树挖掉一个点」，范围接近全表。优化器算出回表代价高于一次顺序全表扫描，于是主动放弃索引。

关键结论：**这不是语法禁止，是优化器基于成本的主动选择。** 当排除后剩余的行很少时，优化器会重新选择索引：

```sql
-- ❌ status 取值均匀分布时，排除一个值仍命中绝大部分行，优化器选择全表扫描
SELECT * FROM users WHERE status != 'deleted';

-- ✅ 排除后剩余很少时，索引可能生效，取决于数据分布
SELECT * FROM users WHERE status IN ('active', 'pending', 'completed');
-- 用 EXPLAIN 验证，数据分布决定执行计划，不要凭经验猜测
```

### 1.7 IS NULL / IS NOT NULL：NULL 也是有序区间里的一段

`NULL` 值被 B+ 树排在最前或最后（取决于 `ASC`/`DESC`），因此 `IS NULL` 本质是「定位 NULL 值区间」，等价于一次等值查找，能走索引。MySQL 官方文档明确：

> `col_name IS NULL` 可以获得与 `col_name = constant_value` 相同的优化。（[IS NULL Optimization](https://dev.mysql.com/doc/refman/8.0/en/is-null-optimization.html)）

`IS NOT NULL` 是「NULL 区间之外的整段」，能否走索引取决于 NULL 的占比：NULL 少、非 NULL 多时，`IS NOT NULL` 命中太多行，优化器倾向全表扫描。

```sql
-- ✅ IS NULL 通常走索引（定位 NULL 区间）
SELECT * FROM users WHERE email IS NULL;

-- ⚠ IS NOT NULL 是否走索引取决于 NULL 占比，用 EXPLAIN 验证
SELECT * FROM users WHERE email IS NOT NULL;

-- 若 email 声明为 NOT NULL，IS NULL 恒为假，优化器直接跳过该条件
```

### 1.8 OR 条件：多个区间无法合并定位

索引一次定位只能确定**一个**区间，`OR` 要求「多个区间取并集」。当 `OR` 两侧只有一侧有索引时，另一侧仍需全表扫描，优化器索性整体全表扫描。两侧都有索引时，MySQL 可能用 `index_merge` 分别扫两个索引再合并。

```sql
-- ❌ b 无索引，OR 的另一侧需全表扫描，整体放弃索引
SELECT * FROM t WHERE a = 1 OR b = 2;

-- ✅ 拆成两条，分别走各自的索引
SELECT * FROM t WHERE a = 1
UNION
SELECT * FROM t WHERE b = 2;
```

### 1.9 失效场景小结

| 场景 | 失效的根因 |
| :-- | :-- |
| 函数操作 | 索引存原始值，函数结果对不上 |
| 隐式转换 | 等价于对列做 `CAST` |
| `LIKE '%x'` | 无法确定前缀区间 |
| 范围后的列 | 最左前缀中断，后续列乱序 |
| `!=` / `NOT IN` | 命中太多行，优化器成本判断 |
| `IS NOT NULL` | 同上，取决于 NULL 占比 |
| `OR` | 多个区间无法合并定位 |

## 2. 索引失效判断方法

```sql
EXPLAIN SELECT * FROM users WHERE name = '张三';
```

| 字段 | 说明 |
| :-- | :-- |
| type | 访问类型，从优到劣：`const` → `eq_ref` → `ref` → `range` → `index` → `ALL` |
| key | 实际使用的索引 |
| rows | 预估扫描行数 |
| Extra | `Using index` / `Using where` / `Using temporary` / `Using filesort` |

```sql
-- 观察 key 列：NULL 表示没走索引

-- 使用 EXPLAIN FORMAT=JSON 查看详细信息
EXPLAIN FORMAT=JSON SELECT * FROM users WHERE YEAR(created_at) = 2024;
-- 查看 "used_key_parts" 是否为空

-- 使用 EXPLAIN ANALYZE 查看实际执行情况（MySQL 8.0+）
EXPLAIN ANALYZE SELECT * FROM users WHERE name = '张三';
```

## 3. 索引控制与最佳实践

### 3.1 强制使用/忽略索引

```sql
-- 强制使用指定索引
SELECT * FROM users FORCE INDEX(idx_name) WHERE name = '张三';

-- 忽略指定索引
SELECT * FROM users IGNORE INDEX(idx_age) WHERE age > 25;

-- 建议使用索引（优化器可能不采纳）
SELECT * FROM users USE INDEX(idx_name) WHERE name = '张三';
```

### 3.2 最佳实践

1. **避免在索引列上使用函数** — 改用范围查询或函数索引
2. **保持数据类型一致** — 避免隐式类型转换
3. **LIKE 查询以通配符开头时考虑全文索引**
4. **OR 条件确保两边都有索引** — 或改用 UNION
5. **定期用 EXPLAIN 验证关键查询** — 确保索引被正确使用
