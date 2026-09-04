---
doc_id: pg-window-function
title: 窗口函数
---

# 窗口函数

> **核心问题**：窗口函数解决了什么问题？ROW_NUMBER、RANK、DENSE_RANK 有什么区别？

## 1. 它解决了什么问题？

在不改变结果行数的情况下，对每行数据进行**跨行计算**（如排名、累计、前后行对比）。没有窗口函数时，求每个部门薪资排名需要写复杂的自连接或子查询，性能差且难以维护。

## 2. 基本语法

```sql
函数名() OVER (
    PARTITION BY 分组列    -- 按哪个字段分组（类似 GROUP BY，但不合并行）
    ORDER BY 排序列        -- 窗口内的排序方式
    ROWS/RANGE BETWEEN ... -- 窗口帧范围（可选）
)
```

## 3. 常用窗口函数

```sql
-- 场景：查询每个部门的员工薪资排名
SELECT 
    name,
    department,
    salary,
    ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS row_num,
    RANK()       OVER (PARTITION BY department ORDER BY salary DESC) AS rank,
    DENSE_RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS dense_rank,
    LAG(salary)  OVER (PARTITION BY department ORDER BY salary DESC) AS prev_salary,
    LEAD(salary) OVER (PARTITION BY department ORDER BY salary DESC) AS next_salary,
    SUM(salary)  OVER (PARTITION BY department) AS dept_total,
    AVG(salary)  OVER (PARTITION BY department) AS dept_avg
FROM employees;
```

## 4. ROW_NUMBER vs RANK vs DENSE_RANK

| 窗口函数 | 作用 | 示例结果（薪资相同时） | 特点 |
| :-- | :-- | :-- | :-- |
| `ROW_NUMBER()` | 连续排名（无并列） | 1, 2, 3, 4 | 相同值也给不同排名，结果唯一 |
| `RANK()` | 跳跃排名（有并列） | 1, 2, 2, 4 | 相同值同排名，下一名跳过 |
| `DENSE_RANK()` | 密集排名（有并列） | 1, 2, 2, 3 | 相同值同排名，下一名不跳过 |

![排名函数对比](/pg/rank-compare.svg)

**选择原则**：

- 需要**唯一行号**（如分页）→ `ROW_NUMBER()`
- 需要**体现并列**且下一名跳过（如竞赛排名）→ `RANK()`
- 需要**体现并列**且连续编号（如等级划分）→ `DENSE_RANK()`

## 5. LAG / LEAD：前后行对比

```sql
-- 计算每月销售额环比增长
SELECT 
    month,
    sales,
    LAG(sales) OVER (ORDER BY month) AS prev_month_sales,
    sales - LAG(sales) OVER (ORDER BY month) AS growth,
    ROUND(
        (sales - LAG(sales) OVER (ORDER BY month)) / 
        LAG(sales) OVER (ORDER BY month) * 100, 2
    ) AS growth_rate
FROM monthly_sales;
```

| 函数 | 作用 | 常见用途 |
| :-- | :-- | :-- |
| `LAG(col, n, default)` | 取当前行**前** n 行的值 | 计算环比、同比 |
| `LEAD(col, n, default)` | 取当前行**后** n 行的值 | 预测下一期、计算差值 |

## 6. 累计聚合

```sql
-- 计算累计销售额（Running Total）
SELECT 
    order_date,
    amount,
    SUM(amount) OVER (ORDER BY order_date) AS running_total,
    AVG(amount) OVER (ORDER BY order_date 
                      ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS moving_avg_7d
FROM orders;
```
