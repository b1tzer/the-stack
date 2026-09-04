---
doc_id: pg-ref-functions
title: 函数速查表
---

# 函数速查表

## 窗口函数

| 函数 | 说明 | 示例 |
| :-- | :-- | :-- |
| `ROW_NUMBER()` | 连续行号 | `ROW_NUMBER() OVER (ORDER BY id)` |
| `RANK()` | 跳跃排名 | `RANK() OVER (PARTITION BY dept ORDER BY salary DESC)` |
| `DENSE_RANK()` | 密集排名 | `DENSE_RANK() OVER (ORDER BY score DESC)` |
| `LAG(col, n)` | 前 n 行 | `LAG(salary, 1) OVER (ORDER BY id)` |
| `LEAD(col, n)` | 后 n 行 | `LEAD(salary, 1) OVER (ORDER BY id)` |
| `NTILE(n)` | 分桶 | `NTILE(4) OVER (ORDER BY salary)` |
| `FIRST_VALUE(col)` | 窗口首行 | `FIRST_VALUE(salary) OVER (ORDER BY id)` |
| `LAST_VALUE(col)` | 窗口末行 | `LAST_VALUE(salary) OVER (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)` |

## 聚合函数

| 函数 | 说明 |
| :-- | :-- |
| `COUNT(*)` / `COUNT(col)` | 计数 |
| `SUM(col)` | 求和 |
| `AVG(col)` | 平均值 |
| `MIN(col)` / `MAX(col)` | 最小/最大值 |
| `STRING_AGG(col, sep)` | 字符串拼接 |
| `ARRAY_AGG(col)` | 数组聚合 |
| `JSONB_AGG(col)` | JSONB 数组聚合 |
| `JSONB_OBJECT_AGG(key, val)` | JSONB 对象聚合 |

## JSONB 函数

| 函数/操作符 | 说明 |
| :-- | :-- |
| `->` | 提取 JSON 对象 |
| `->>` | 提取文本值 |
| `#>` | 按路径提取 JSON |
| `#>>` | 按路径提取文本 |
| `@>` | 包含 |
| `<@` | 被包含 |
| `?` | 键存在 |
| `\|\|` | 合并 |
| `-` | 删除键 |
| `jsonb_array_elements()` | 展开数组 |
| `jsonb_each()` | 展开键值对 |
| `jsonb_set()` | 设置嵌套值 |

## 日期函数

| 函数 | 说明 | 示例 |
| :-- | :-- | :-- |
| `NOW()` | 当前时间戳 | `SELECT NOW()` |
| `CURRENT_DATE` | 当前日期 | `SELECT CURRENT_DATE` |
| `DATE_TRUNC(p, ts)` | 截断 | `DATE_TRUNC('month', NOW())` |
| `EXTRACT(p FROM ts)` | 提取 | `EXTRACT(YEAR FROM NOW())` |
| `AGE(ts1, ts2)` | 时间差 | `AGE(NOW(), created_at)` |
| `INTERVAL '1 day'` | 时间间隔 | `NOW() - INTERVAL '7 days'` |

## 字符串函数

| 函数 | 说明 |
| :-- | :-- |
| `CONCAT(a, b)` | 拼接 |
| `SUBSTR(s, start, len)` | 截取 |
| `LENGTH(s)` | 长度 |
| `UPPER(s)` / `LOWER(s)` | 大小写 |
| `TRIM(s)` | 去空格 |
| `REPLACE(s, old, new)` | 替换 |
| `REGEXP_REPLACE(s, pattern, repl)` | 正则替换 |
| `SPLIT_PART(s, delim, n)` | 分割取值 |

## 系统函数

| 函数 | 说明 |
| :-- | :-- |
| `pg_size_pretty(bytes)` | 人类可读大小 |
| `pg_database_size(db)` | 数据库大小 |
| `pg_total_relation_size(rel)` | 表总大小 |
| `pg_terminate_backend(pid)` | 终止连接 |
| `pg_cancel_backend(pid)` | 取消查询 |
| `pg_reload_conf()` | 重载配置 |
| `pg_is_in_recovery()` | 是否从库 |
| `txid_current()` | 当前事务 ID |
