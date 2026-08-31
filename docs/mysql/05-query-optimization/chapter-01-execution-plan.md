# 执行计划

> 理解 MySQL 如何执行一条 SQL，是优化查询的前提。

## 1. 查询执行流程

```text
SQL → 解析器 → 优化器 → 执行器 → 结果
         │         │
         ▼         ▼
      语法树    执行计划
              (选择索引、连接顺序)
```

## 2. EXPLAIN 输出解读

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 100 AND status = 'paid';
```

| 字段 | 含义 | 关注点 |
|------|------|--------|
| type | 访问类型 | const > eq_ref > ref > range > index > ALL |
| key | 使用的索引 | NULL=全表扫描 |
| rows | 预估扫描行数 | 越小越好 |
| Extra | 额外信息 | Using index=好，Using filesort=差 |

### type 访问类型

| type | 含义 | 性能 |
|------|------|------|
| const | 主键/唯一索引等值查询 | 最好 |
| eq_ref | 连接时使用主键/唯一索引 | 很好 |
| ref | 非唯一索引等值查询 | 好 |
| range | 索引范围查询 | 好 |
| index | 全索引扫描 | 一般 |
| ALL | 全表扫描 | 差 |

### Extra 信息

| Extra | 含义 | 好/坏 |
|-------|------|-------|
| Using index | 覆盖索引，不回表 | ✅ 好 |
| Using where | Server 层过滤 | ⚠️ 一般 |
| Using index condition | 索引条件下推（ICP） | ✅ 好 |
| Using temporary | 使用临时表 | ❌ 差 |
| Using filesort | 额外排序 | ❌ 差 |

## 3. 慢查询优化思路

```text
1. EXPLAIN 看执行计划
2. type=ALL → 全表扫描 → 加索引
3. key=NULL → 没用索引 → 检查 WHERE 条件
4. rows 很大 → 扫描行数多 → 优化索引或条件
5. Extra 有 filesort/temporary → 优化 ORDER BY/GROUP BY
```

## 4. 常见优化场景

### 全表扫描 → 索引扫描

```sql
-- 慢：status 不是索引
SELECT * FROM orders WHERE status = 'paid';

-- 快：添加索引
ALTER TABLE orders ADD INDEX idx_status (status);
```

### 索引失效

```sql
-- 索引失效：函数包裹
SELECT * FROM orders WHERE YEAR(created_at) = 2026;

-- 索引生效：范围查询
SELECT * FROM orders WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01';
```

### 覆盖索引

```sql
-- 索引包含所有需要的列，不需要回表
SELECT user_id, status FROM orders WHERE user_id = 100;
-- 索引：(user_id, status)
```
