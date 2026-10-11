# 窗口函数

窗口函数在不折叠数据行的前提下，对一组相关行（称为「窗口」）做计算。它和 `GROUP BY` 正好相反：`GROUP BY` 把多行压成一行，窗口函数则给每一行附加一个跨行算出来的值。排名、移动平均、同比环比这类「既要保留明细、又要跨行计算」的需求，都靠它解决。

::: warning 版本要求
窗口函数是 MySQL 8.0 引入的特性（8.0.2 里程碑版本引入，8.0.11 正式 GA）。5.7 及更早版本没有原生窗口函数，只能用会话变量或自连接子查询模拟，写法繁琐且难以维护。本文所有示例都要求 MySQL 8.0 及以上版本。
:::

要理解窗口函数，只需抓住 `OVER` 子句里的三样东西：`PARTITION BY` 划定分组范围，`ORDER BY` 决定组内顺序，窗口帧规定「算到哪些行为止」。先看一个完整例子，再逐个拆解。

## 1. 窗口函数基础

### 1.1 基本语法

窗口函数的写法是「函数名 + `OVER (...)`」。`OVER` 括号里的内容定义窗口：`PARTITION BY department` 按部门分组，`ORDER BY salary DESC` 在组内按薪资降序排列。下面的查询对每个员工算三个排名，结果里每一行都保留，只是多出三列。

```sql
SELECT 
    name,
    department,
    salary,
    ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS rn,
    RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS rnk,
    DENSE_RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS dense_rnk
FROM employees;
```

### 1.2 常用窗口函数

最常用的窗口函数分两类：排序类和取值类。排序类里 `ROW_NUMBER`、`RANK`、`DENSE_RANK` 的区别只在「遇到并列值怎么办」，这是面试和实战里最容易被问到的点。

| 函数 | 说明 |
| :-- | :-- |
| ROW_NUMBER() | 行号，无重复 |
| RANK() | 排名，有重复会跳号 |
| DENSE_RANK() | 排名，有重复不跳号 |
| LAG(col, n) | 前 n 行的值 |
| LEAD(col, n) | 后 n 行的值 |
| FIRST_VALUE() | 窗口内第一行 |
| LAST_VALUE() | 窗口内最后一行 |

三个排序函数的差别，用一个并列值就能看清。假设组内最高薪资有两人（并列第一）：

```sql
-- 假设 salary 依次为 9000, 9000, 8000
-- ROW_NUMBER(): 1, 2, 3     每个行号唯一，并列也强行编号
-- RANK():       1, 1, 3     并列占同名次，下一名跳号
-- DENSE_RANK(): 1, 1, 2     并列占同名次，下一名不跳号
```

选谁取决于业务：要「每组取前 3 名」且并列也算满 3 个名额，用 `ROW_NUMBER`；要「只取排名前 3 档」用 `DENSE_RANK`；`RANK` 介于两者之间，用得相对少。

### 1.3 聚合窗口函数

聚合函数（`SUM`、`AVG`、`COUNT` 等）也能当窗口函数用。区别在于：加 `GROUP BY` 时聚合结果会把行折叠，加 `OVER` 时聚合结果作为新列贴回每一行。

```sql
SELECT 
    name,
    salary,
    department,
    SUM(salary) OVER (PARTITION BY department) AS dept_total,
    AVG(salary) OVER (PARTITION BY department) AS dept_avg
FROM employees;
-- 结果：每个员工行都带着「本部门总薪资」和「本部门平均薪资」
```

## 2. 窗口帧与进阶函数

### 2.1 窗口帧 (Window Frame)

窗口帧规定「当前这一行的计算结果，取窗口里哪些行」。它只在 `OVER` 里同时出现 `ORDER BY` 时才生效——没有 `ORDER BY`，整个分区就是完整的一帧。

最容易踩的坑是默认帧：只要写了 `ORDER BY` 而没显式指定帧，默认就是 `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`，也就是「从分区开头到当前行」。很多人以为 `SUM(x) OVER (ORDER BY date)` 会算出整组总和，实际得到的是累积和。

帧有两种边界单位：`ROWS` 按物理行数数，`RANGE` 按 `ORDER BY` 列的值范围算。移动平均这种「固定往前数几行」的需求用 `ROWS`，按时间窗滚动则用 `RANGE`。

```sql
-- ROWS: 物理行，按「行数」往前数
-- 当前行往前 2 行到当前行，共 3 行求平均（3 日移动平均）
SELECT
    date,
    revenue,
    AVG(revenue) OVER (
        ORDER BY date
        ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
    ) AS moving_avg_3d
FROM daily_sales;

-- 当前行到最后一行（累积剩余量）
SELECT
    date,
    revenue,
    SUM(revenue) OVER (
        ORDER BY date
        ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING
    ) AS remaining_total
FROM daily_sales;

-- RANGE 帧：按「值范围」往前数，与行数无关
-- 往前 6 天内的所有行求平均（滚动 7 日均值，含当天）
SELECT
    date,
    revenue,
    AVG(revenue) OVER (
        ORDER BY date
        RANGE BETWEEN INTERVAL 6 DAY PRECEDING AND CURRENT ROW
    ) AS rolling_7d_avg
FROM daily_sales;
```

### 2.2 NTILE 分桶

`NTILE(n)` 把分区内的行尽量均分到 n 个桶，返回每行所在桶的编号。它适合把连续数据切成等份——比如按薪资分成四档做分层抽样，或按业绩分三档定等级。行数不能被 n 整除时，前面几个桶会多分一行。

```sql
SELECT
    name,
    salary,
    NTILE(4) OVER (ORDER BY salary DESC) AS quartile
FROM employees;
-- 1 = Top 25%, 2 = 25-50%, 3 = 50-75%, 4 = Bottom 25%

-- 按部门分桶
SELECT
    name,
    department,
    salary,
    NTILE(3) OVER (PARTITION BY department ORDER BY salary DESC) AS tier
FROM employees;
```

### 2.3 PERCENT_RANK 和 CUME_DIST

这两个函数返回 0 到 1 之间的相对位置，用在不同量纲的数据之间做横向比较。`PERCENT_RANK` 是「比当前行小的行数占比」，`CUME_DIST` 是「小于等于当前行的行数占比」，前者第一名是 0，后者最后一名是 1。

```sql
-- PERCENT_RANK: 百分比排名
SELECT
    name,
    salary,
    PERCENT_RANK() OVER (ORDER BY salary DESC) AS pct_rank
FROM employees;
-- 第一名 = 0, 最后一名 = 1

-- CUME_DIST: 累积分布
SELECT
    name,
    salary,
    CUME_DIST() OVER (ORDER BY salary DESC) AS cum_dist
FROM employees;
-- 表示薪资 >= 当前行的人数占比
```

## 3. 实际业务场景

下面三个场景覆盖了窗口函数最常见的用途：分组计数、跨行取值、分组内取 Top N。

**场景 1：连续 N 天登录** 是三者里最值得记的。它的核心是一个差值技巧：对同一用户的登录日期按时间排序后编号，再用「日期 - 行号」分组。如果两天是连续的，它们的「日期 - 行号」结果相同；一旦中断，结果就会跳变。于是连续的日期自动落进同一组，按组计数就是连续天数。

```sql
-- 场景 1：连续 N 天登录用户
WITH daily_login AS (
    SELECT
        user_id,
        DATE(login_time) AS login_date,
        DATE(login_time) - INTERVAL ROW_NUMBER() OVER (
            PARTITION BY user_id ORDER BY DATE(login_time)
        ) DAY AS group_id
    FROM user_logins
    GROUP BY user_id, DATE(login_time)
)
SELECT user_id, MIN(login_date) AS start_date, MAX(login_date) AS end_date,
    COUNT(*) AS consecutive_days
FROM daily_login
GROUP BY user_id, group_id
HAVING COUNT(*) >= 7;  -- 连续登录 7 天
```

**场景 2：同比/环比** 用 `LAG` 取上一行或去年同期行的值，本质是「跨行取值」，配合 `ORDER BY` 即可。

**场景 3：Top N per Group** 是 `ROW_NUMBER` 最经典的用法：先按组编号，再在子查询里筛出编号 ≤ N 的行。注意窗口函数不能直接写在 `WHERE` 里，必须先套一层子查询，这正是下面写法里 `SELECT * FROM (...) t WHERE rn <= 3` 的原因。

```sql
-- 场景 2：同比/环比计算
SELECT
    month,
    revenue,
    LAG(revenue, 1) OVER (ORDER BY month) AS prev_month,
    LAG(revenue, 12) OVER (ORDER BY month) AS same_month_last_year,
    ROUND((revenue - LAG(revenue, 1) OVER (ORDER BY month)) /
        LAG(revenue, 1) OVER (ORDER BY month) * 100, 2) AS mom_growth_pct
FROM monthly_sales;

-- 场景 3：Top N per Group
SELECT * FROM (
    SELECT
        department, name, salary,
        ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS rn
    FROM employees
) t WHERE rn <= 3;  -- 每个部门薪资 Top 3
```

## 4. 最佳实践

1. **PARTITION BY 类似 GROUP BY 但不折叠行** — 保留每行明细
2. **ORDER BY 在 OVER 子句中定义窗口排序** — 与查询的 ORDER BY 无关
3. **窗口函数不能在 WHERE 中使用** — 需要包装为子查询
4. **多个窗口函数可共用一个 OVER** — 减少重复定义
5. **窗口帧默认行为** — ORDER BY 存在时默认 RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
