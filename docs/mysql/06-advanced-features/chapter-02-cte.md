# CTE 与递归查询

## 1. CTE 基础

### 1.1 普通 CTE

```sql
WITH active_users AS (
    SELECT id, name FROM users WHERE status = 'active'
)
SELECT * FROM active_users WHERE name LIKE '张%';
```

### 1.2 递归 CTE

```sql
WITH RECURSIVE org_tree AS (
    -- 锚点：顶级部门
    SELECT id, name, parent_id, 1 AS level
    FROM departments WHERE parent_id IS NULL
    
    UNION ALL
    
    -- 递归：子部门
    SELECT d.id, d.name, d.parent_id, t.level + 1
    FROM departments d
    JOIN org_tree t ON d.parent_id = t.id
)
SELECT * FROM org_tree ORDER BY level, id;
```

## 2. 递归 CTE 进阶

### 2.1 应用场景

- 组织架构树
- 评论回复层级
- 分类目录
- 路径展开

### 2.2 递归 CTE 限制与控制

```sql
-- 递归深度限制
SHOW VARIABLES LIKE 'cte_max_recursion_depth';  -- 默认 1000

-- 设置更大的递归深度
SET SESSION cte_max_recursion_depth = 10000;

-- 递归终止条件
WITH RECURSIVE cnt AS (
    SELECT 1 AS n                -- 锚点
    UNION ALL
    SELECT n + 1 FROM cnt WHERE n < 100  -- 终止条件
)
SELECT * FROM cnt;
```

## 3. 实际业务场景

```sql
-- 场景 1：生成日期序列
WITH RECURSIVE dates AS (
    SELECT '2024-01-01' AS dt
    UNION ALL
    SELECT DATE_ADD(dt, INTERVAL 1 DAY) FROM dates WHERE dt < '2024-12-31'
)
SELECT dt FROM dates;

-- 场景 2：BOM 物料清单展开
WITH RECURSIVE bom_explosion AS (
    -- 锚点：顶级产品
    SELECT id, parent_id, name, quantity, 1 AS level, CAST(name AS CHAR(500)) AS path
    FROM bom WHERE parent_id IS NULL
    
    UNION ALL
    
    -- 递归：子组件
    SELECT b.id, b.parent_id, b.name, b.quantity, be.level + 1,
        CONCAT(be.path, ' > ', b.name)
    FROM bom b
    JOIN bom_explosion be ON b.parent_id = be.id
    WHERE be.level < 10  -- 最多展开 10 层
)
SELECT * FROM bom_explosion ORDER BY path;

-- 场景 3：获取所有子部门的员工数
WITH RECURSIVE dept_tree AS (
    SELECT id, name, parent_id
    FROM departments WHERE id = 1  -- 从指定部门开始
    UNION ALL
    SELECT d.id, d.name, d.parent_id
    FROM departments d
    JOIN dept_tree dt ON d.parent_id = dt.id
)
SELECT dt.name, COUNT(e.id) AS emp_count
FROM dept_tree dt
LEFT JOIN employees e ON e.department_id = dt.id
GROUP BY dt.id, dt.name;

-- 场景 4：图路径查找（最短路径）
WITH RECURSIVE paths AS (
    -- 锚点：起点
    SELECT source AS start_node, destination AS end_node,
        1 AS hops, CAST(source AS CHAR(500)) AS path
    FROM edges WHERE source = 'A'
    
    UNION ALL
    
    -- 递归：扩展路径
    SELECT p.start_node, e.destination, p.hops + 1,
        CONCAT(p.path, ' -> ', e.destination)
    FROM paths p
    JOIN edges e ON p.end_node = e.source
    WHERE p.hops < 5  -- 最多 5 跳
    AND FIND_IN_SET(e.destination, REPLACE(p.path, ' -> ', ',')) = 0  -- 避免环
)
SELECT * FROM paths WHERE end_node = 'Z' ORDER BY hops LIMIT 1;  -- 最短路径
```

## 4. CTE vs 子查询 vs 临时表

| 特性 | CTE | 子查询 | 临时表 |
|------|-----|--------|--------|
| 可读性 | 高（命名清晰） | 低（嵌套复杂） | 中 |
| 复用性 | 同一查询内可多次引用 | 每次需要重新写 | 可跨查询 |
| 性能 | 通常物化 | 可能重复执行 | 持久存储 |
| 递归支持 | ✅ | ❌ | ❌ |
| 索引支持 | ❌ | 取决于子查询 | ✅ |
| 适用场景 | 复杂查询拆解 | 简单过滤 | 需要索引的中间结果 |

## 5. 最佳实践

1. **CTE 提高可读性** — 将复杂查询拆分为逻辑块
2. **递归 CTE 必须有终止条件** — 防止无限递归
3. **大结果集的 CTE 考虑物化** — MySQL 8.0 自动物化
4. **需要索引时用临时表替代 CTE** — CTE 不支持索引
5. **同一 CTE 可多次引用** — 避免重复计算
