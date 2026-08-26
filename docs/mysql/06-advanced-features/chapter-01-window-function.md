# 窗口函数

## 1. 基本语法

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

## 2. 常用窗口函数

| 函数 | 说明 |
|------|------|
| ROW_NUMBER() | 行号，无重复 |
| RANK() | 排名，有重复会跳号 |
| DENSE_RANK() | 排名，有重复不跳号 |
| LAG(col, n) | 前 n 行的值 |
| LEAD(col, n) | 后 n 行的值 |
| FIRST_VALUE() | 窗口内第一行 |
| LAST_VALUE() | 窗口内最后一行 |

## 3. 聚合窗口函数

```sql
SELECT 
    name,
    salary,
    department,
    SUM(salary) OVER (PARTITION BY department) AS dept_total,
    AVG(salary) OVER (PARTITION BY department) AS dept_avg
FROM employees;
```

## 4. 窗口帧 (Window Frame)

```sql
-- ROWS: 物理行
-- RANGE: 逻辑范围

-- 当前行之前 2 行到当前行
SELECT
    date,
    revenue,
    AVG(revenue) OVER (
        ORDER BY date
        ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
    ) AS moving_avg_3d
FROM daily_sales;

-- 当前行到最后一行
SELECT
    date,
    revenue,
    SUM(revenue) OVER (
        ORDER BY date
        ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING
    ) AS remaining_total
FROM daily_sales;

-- RANGE 帧（按值范围）
SELECT
    date,
    revenue,
    AVG(revenue) OVER (
        ORDER BY date
        RANGE BETWEEN INTERVAL 6 DAY PRECEDING AND CURRENT ROW
    ) AS rolling_7d_avg
FROM daily_sales;
```

## 5. NTILE 分桶

```sql
-- 将数据分为 N 个桶
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

## 6. PERCENT_RANK 和 CUME_DIST

```sql
-- PERCENT_RANK: 百分比排名 (0 到 1)
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
-- 表示薪资 >= 当前行的人数比例
```

## 7. 实际业务场景

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

## 8. 最佳实践

1. **PARTITION BY 类似 GROUP BY 但不折叠行** — 保留每行明细
2. **ORDER BY 在 OVER 子句中定义窗口排序** — 与查询的 ORDER BY 无关
3. **窗口函数不能在 WHERE 中使用** — 需要包装为子查询
4. **多个窗口函数可共用一个 OVER** — 减少重复定义
5. **窗口帧默认行为** — ORDER BY 存在时默认 RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW

