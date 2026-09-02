# CTE 与递归查询

CTE（Common Table Expression，公用表表达式）为一段子查询命名，使复杂查询能拆解为有名字的逻辑块。递归 CTE 则允许 CTE 引用自身，用来遍历组织树、物料清单、评论层级这类「行与行相互指向」的数据。本文先讲普通 CTE 的写法与执行方式，再讲递归 CTE 的锚点、递归成员、终止条件，最后对比 CTE、子查询、临时表三者的适用场景。

::: warning 版本要求
普通 CTE 与递归 CTE 都是 MySQL 8.0 引入的特性（8.0.1 里程碑版本引入，8.0.11 正式 GA）。5.7 及更早版本不支持 `WITH` 语法，只能用派生表（`FROM (SELECT ...)`）代替普通 CTE，递归查询则需要存储过程或应用层循环。本文所有示例都要求 MySQL 8.0 及以上版本。
:::

## 1. CTE 基础

### 1.1 普通 CTE

```sql
WITH active_users AS (
    SELECT id, name FROM users WHERE status = 'active'
)
SELECT * FROM active_users WHERE name LIKE '张%';
```

`WITH` 后面的 `active_users` 是一个有名字的子查询，作用范围只限紧随其后的这一条语句。它的价值不在功能——任何 CTE 都能展开回一个子查询——而在可读性：当一条 SQL 里嵌套了三四层子查询时，把每一层都提到前面并命名，读起来是从上到下、逐层递进，而不是从里到外、层层剥开。

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

递归 CTE 由两部分组成，用 `UNION ALL` 连接。第一部分是「锚点」，选出起始行（这里是 `parent_id IS NULL` 的顶级部门）；第二部分是「递归成员」，引用 CTE 自身，把上一轮结果作为下一轮的输入。执行时先跑锚点，再用锚点结果跑递归成员，反复迭代，直到某一轮不再产生新行。

两个容易出错的地方：

- 关键字必须是 `WITH RECURSIVE`，少了 `RECURSIVE` 会直接报错。
- 递归成员里 `JOIN org_tree t` 引用的是「上一轮的结果」，不是最终结果，所以每一轮只会新增一层子部门，不会重复取出已处理的行。

## 2. 递归 CTE 的限制与控制

递归一旦失控，代价是一条跑不完的查询。MySQL 用两个机制兜底：递归深度上限，以及写在递归成员里的终止条件。

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

`cte_max_recursion_depth` 是硬上限，默认 1000，迭代次数超过它就报错 `Recursive query aborted`，这是防止误写死循环的最后一道闸。但它只是兜底，真正的终止条件应该写在递归成员的 `WHERE` 里——像上面 `WHERE n < 100`，迭代到 n=100 时不再产生新行，递归自然结束。依赖深度上限而不写终止条件，等于让一条本应精确结束的查询靠撞墙停下。

## 3. 实际业务场景

### 3.1 生成日期序列

数据库里往往只有「有交易的那些天」的记录，而报表需要「每一天」——哪怕当天没数据也要出现一行零。缺失的日期需要凭空造出来，递归 CTE 是最直接的方式。

```sql
WITH RECURSIVE dates AS (
    SELECT '2024-01-01' AS dt
    UNION ALL
    SELECT DATE_ADD(dt, INTERVAL 1 DAY) FROM dates WHERE dt < '2024-12-31'
)
SELECT dt FROM dates;
```

锚点给出起始日期，递归成员每次加一天，直到 `dt` 追上终点。生成完这份连续日历，再和交易表做 `LEFT JOIN`，缺数据的天自然显示为 0，不必在应用层拼接。

### 3.2 BOM 物料清单展开

制造业里，一个产品由若干子组件构成，子组件又由更小的零件构成。查询「组装一台产品需要哪些零件、各多少」，就是从顶层沿着父子关系逐层展开。

```sql
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
```

这里多了两个变量：`level` 记录当前深度，`path` 用字符串拼接的方式记录从根到当前节点的路径。前者用于给递归加上层数上限（`WHERE be.level < 10`），避免 BOM 表意外形成的环导致递归爆炸；后者用于结果排序，让最终输出按「谁在谁下面」的树形顺序呈现。锚点里 `CAST(name AS CHAR(500))` 是必要的——递归 CTE 要求两次 `SELECT` 的每一列类型完全一致，锚点里 `name` 的类型会决定后续拼接的最大长度，不 `CAST` 就可能被截断。

### 3.3 从指定节点向下汇总

上一例是从根往下展开整棵树，实际业务更常见的是「从某个中间节点向下汇总」，比如统计「某个部门及其所有下属部门的员工总数」。

```sql
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
```

锚点只选中一个具体节点，递归成员照常向下扩展，得到「以该部门为根的子树」。这种「限定起点」的写法可以直接支撑权限系统里「查看我管辖范围内的所有数据」这类需求，不必先查一遍下属再拼 `IN`。

### 3.4 图路径查找

树是特例，一般图允许一个节点有多个入边、也可能存在环。递归 CTE 处理图时，除了深度上限，还必须显式**去环**，否则会顺着环无限走下去。

```sql
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

`path` 字段拼接的是「本条路径途经的所有节点」，`FIND_IN_SET(e.destination, ...) = 0` 在每一步扩展前检查目标节点是否已经走过，走过就跳过。最后 `ORDER BY hops LIMIT 1` 取跳数最少的一条，即从 A 到 Z 的最短路径。需要提醒的是，递归 CTE 是深度优先搜索，不是专门的图算法，对边数在百万级以上的图性能会明显下降，此时应换 Neo4j 之类的图数据库或图计算框架。

## 4. CTE、子查询与临时表的取舍

三者本质上都是「把中间结果拿出来复用」，但复用的方式和代价不同。

| 特性 | CTE | 子查询 | 临时表 |
| :-- | :-- | :-- | :-- |
| 可读性 | 有名字，从上到下阅读 | 嵌套多层后难读 | 中等 |
| 复用性 | 同一条语句内可多次引用 | 每次要重写一遍 | 跨语句、跨会话都能用 |
| 执行方式 | 默认合并进外层，多次引用或递归时才物化 | 通常合并进外层，特定结构会物化 | 落到磁盘或内存的真实表 |
| 递归支持 | 支持 | 不支持 | 不支持 |
| 索引支持 | 不支持 | 不支持 | 支持 |

关于「执行方式」一栏，MySQL 8.0 的优化器对非递归 CTE 有两种处理：**合并（merge）**——把 CTE 展开回外层 SQL 里，就像手写了子查询；**物化（materialize）**——把 CTE 的结果先写进一张内部临时表，外层从这张临时表读。默认走合并；只有当 CTE 被同一条语句多次引用、或者是递归 CTE 时，才会物化，且**只物化一次**。这一点是 CTE 相对派生表的关键优势——派生表被引用几次就要执行几次，CTE 复用同一份中间结果。

## 5. 使用建议

CTE 的第一价值是可读性，第二价值是「多次引用时只计算一次」。当你发现一段中间结果要在同一条 SQL 里被 `JOIN` 两次以上时，用 CTE 而不是重复写两遍子查询。

递归 CTE 一定要显式写终止条件，`cte_max_recursion_depth` 只是防炸的最后一道闸，不该被当作正常的停止机制。处理树时用层数上限，处理图时还要额外加去环判断。

CTE 不支持二级索引。当中间结果被后续查询以某个列做等值或范围过滤、且中间结果集较大时，物化 CTE 会退化为全表扫描。这种场景改用显式的临时表并加索引，通常比继续用 CTE 更划算。
