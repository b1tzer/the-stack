# 窗口函数

> 窗口函数在不减少结果行数的前提下，对"窗口"内的数据进行聚合计算。是 SQL 最强大的分析能力之一。

## 1. 窗口函数 vs 聚合函数

```sql
-- 聚合函数：减少行数
SELECT department, AVG(salary) FROM employees GROUP BY department;
-- 结果：每个部门一行

-- 窗口函数：不减少行数
SELECT name, department, salary, AVG(salary) OVER(PARTITION BY department) AS avg_salary
FROM employees;
-- 结果：每个员工一行，附带部门平均工资
```

## 2. 语法结构

```sql
函数名() OVER (
  [PARTITION BY 分区列]
  [ORDER BY 排序列 [ASC|DESC]]
  [ROWS/RANGE 窗口范围]
)
```

## 3. 常用窗口函数

### 排名函数

```sql
SELECT name, department, salary,
  ROW_NUMBER() OVER(PARTITION BY department ORDER BY salary DESC) AS rn,
  RANK()       OVER(PARTITION BY department ORDER BY salary DESC) AS rnk,
  DENSE_RANK() OVER(PARTITION BY department ORDER BY salary DESC) AS drnk
FROM employees;
```

| 函数 | 区别 |
|------|------|
| ROW_NUMBER() | 无重复，连续编号（1,2,3,4） |
| RANK() | 有并列跳号（1,2,2,4） |
| DENSE_RANK() | 有并列不跳号（1,2,2,3） |

### 偏移函数

```sql
SELECT date, revenue,
  LAG(revenue, 1)  OVER(ORDER BY date) AS prev_day,
  LEAD(revenue, 1) OVER(ORDER BY date) AS next_day
FROM daily_revenue;
```

### 累计函数

```sql
SELECT date, revenue,
  SUM(revenue)    OVER(ORDER BY date) AS cumulative,
  AVG(revenue)    OVER(ORDER BY date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS moving_avg_7d
FROM daily_revenue;
```

### NTILE（分桶）

```sql
SELECT name, salary,
  NTILE(4) OVER(ORDER BY salary DESC) AS quartile
FROM employees;
-- 按工资分为4组：前25%、25-50%、50-75%、后25%
```

## 4. 窗口范围（ROWS/RANGE）

| 范围 | 含义 |
|------|------|
| ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW | 从第一行到当前行 |
| ROWS BETWEEN 6 PRECEDING AND CURRENT ROW | 前6行到当前行（7日移动平均） |
| ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING | 当前行到最后一行 |
| ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING | 前3行到后3行 |

## 5. 性能注意事项

- 窗口函数在 GROUP BY 之后执行
- PARTITION BY 列上有索引可以加速
- 大量分区 + 大量数据 = 内存压力
- 避免在大表上使用无 PARTITION BY 的窗口函数
