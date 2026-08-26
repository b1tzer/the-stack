# EXPLAIN 详解

## 1. 基本用法

```sql
EXPLAIN SELECT * FROM users WHERE age > 25;
EXPLAIN ANALYZE SELECT * FROM users WHERE age > 25;  -- 8.0+
```

## 2. 核心字段

| 字段 | 说明 |
|------|------|
| type | 访问类型 |
| possible_keys | 可能使用的索引 |
| key | 实际使用的索引 |
| key_len | 索引使用长度 |
| rows | 预估扫描行数 |
| filtered | 过滤比例 |
| Extra | 额外信息 |

## 3. type 访问类型（从差到好）

| type | 说明 |
|------|------|
| ALL | 全表扫描 |
| index | 全索引扫描 |
| range | 范围扫描 |
| ref | 非唯一索引等值查询 |
| eq_ref | 唯一索引等值查询 |
| const | 主键/唯一索引等值查询 |
| system | 系统表 |

## 4. Extra 常见值

| Extra | 说明 |
|------|------|
| Using index | 覆盖索引 |
| Using where | 存储引擎返回后再过滤 |
| Using temporary | 使用临时表 |
| Using filesort | 文件排序 |
| Using index condition | 索引下推 |

## 5. EXPLAIN FORMAT=JSON

```sql
EXPLAIN FORMAT=JSON SELECT * FROM users WHERE name = '张三' AND age > 25;
```

输出包含更多细节：
```json
{
  "query_block": {
    "select_id": 1,
    "cost_info": {
      "query_cost": "2.40"  // 查询总成本
    },
    "table": {
      "table_name": "users",
      "access_type": "ref",
      "possible_keys": ["idx_name", "idx_name_age"],
      "key": "idx_name_age",
      "used_key_parts": ["name"],
      "key_length": "202",
      "rows_examined_per_scan": 3,
      "filtered": "33.33",
      "cost_info": {
        "read_cost": "1.80",
        "eval_cost": "0.60"
      }
    }
  }
}
```

## 6. EXPLAIN ANALYZE（MySQL 8.0.18+）

```sql
-- 显示实际执行时间，而不仅是估算
EXPLAIN ANALYZE SELECT * FROM users u
JOIN orders o ON u.id = o.user_id
WHERE u.age > 25;
```

输出示例：
```
-> Nested loop inner join  (cost=4.95 rows=15) (actual time=0.045..0.102 rows=15 loops=1)
    -> Index lookup on u using idx_age (age > 25)  (cost=1.10 rows=5) (actual time=0.028..0.038 rows=5 loops=1)
    -> Index lookup on o using idx_user_id (user_id = u.id)  (cost=0.68 rows=3) (actual time=0.010..0.012 rows=3 loops=5)
```

**关键信息：**
- `cost`: 估算成本
- `rows`: 估算行数
- `actual time`: 实际执行时间（毫秒）
- `loops`: 执行次数

## 7. EXPLAIN FORMAT=TREE（MySQL 8.0.16+）

```sql
-- 树形格式，更容易理解
EXPLAIN FORMAT=TREE SELECT * FROM users u
JOIN orders o ON u.id = o.user_id
WHERE u.age > 25;
```

输出：
```
-> Nested loop inner join  (cost=4.95 rows=15)
    -> Index lookup on u using idx_age (age > 25)  (cost=1.10 rows=5)
    -> Index lookup on o using idx_user_id (user_id = u.id)  (cost=0.68 rows=3)
```

## 8. 常见 EXPLAIN 结果解读

| 场景 | type | Extra | 说明 | 优化建议 |
|------|------|-------|------|----------|
| 全表扫描 | ALL | Using where | 最差 | 添加合适索引 |
| 全索引扫描 | index | Using index | 索引全扫描 | 检查 WHERE 条件 |
| 范围扫描 | range | Using index condition | 范围查询 | 可接受 |
| 非唯一索引 | ref | Using index | 等值查询 | 良好 |
| 唯一索引 | eq_ref | - | 连接查询最优 | 最佳 |
| 主键查询 | const | - | 最快 | 最佳 |
| 使用临时表 | ALL | Using temporary | 需要优化 | GROUP BY/ORDER BY 优化 |
| 文件排序 | ALL | Using filesort | 需要优化 | ORDER BY 列加索引 |

## 9. 最佳实践

1. **开发环境用 EXPLAIN ANALYZE** — 获取实际执行时间
2. **关注 rows 和 filtered** — 估算扫描行数越少越好
3. **关注 Extra 列** — 出现 Using temporary/Using filesort 需要优化
4. **type 至少达到 range 级别** — ALL 表示全表扫描，必须优化
5. **key_len 越短越好** — 说明索引使用效率高
6. **使用 FORMAT=JSON 获取成本信息** — 帮助理解优化器决策

