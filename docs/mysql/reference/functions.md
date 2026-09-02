# MySQL 函数速查

## 字符串函数

| 函数 | 说明 | 示例 |
|------|------|------|
| `CONCAT(s1, s2, ...)` | 拼接字符串 | `CONCAT('Hello', ' ', 'World')` |
| `CONCAT_WS(sep, s1, s2)` | 用分隔符拼接 | `CONCAT_WS('-', '2026', '08', '31')` |
| `SUBSTRING(s, pos, len)` | 截取子串 | `SUBSTRING('Hello', 1, 3)` → `Hel` |
| `LENGTH(s)` | 字节长度 | `LENGTH('你好')` → 6（utf8mb4） |
| `CHAR_LENGTH(s)` | 字符长度 | `CHAR_LENGTH('你好')` → 2 |
| `TRIM(s)` | 去首尾空格 | `TRIM('  hi  ')` → `hi` |
| `REPLACE(s, from, to)` | 替换 | `REPLACE('abc', 'b', 'X')` → `aXc` |
| `IFNULL(expr1, expr2)` | NULL 替换 | `IFNULL(col, 'default')` |
| `COALESCE(a, b, c)` | 返回第一个非 NULL | `COALESCE(a, b, c)` |

## 日期函数

| 函数 | 说明 | 示例 |
|------|------|------|
| `NOW()` | 当前日期时间 | `2026-08-31 12:00:00` |
| `CURDATE()` | 当前日期 | `2026-08-31` |
| `DATE_FORMAT(d, fmt)` | 格式化日期 | `DATE_FORMAT(NOW(), '%Y-%m-%d')` |
| `DATEDIFF(d1, d2)` | 日期差（天） | `DATEDIFF('2026-12-31', '2026-01-01')` → 364 |
| `DATE_ADD(d, INTERVAL n unit)` | 日期加减 | `DATE_ADD(NOW(), INTERVAL 7 DAY)` |
| `UNIX_TIMESTAMP(d)` | 转时间戳 | `UNIX_TIMESTAMP(NOW())` |
| `FROM_UNIXTIME(ts)` | 时间戳转日期 | `FROM_UNIXTIME(1693000000)` |

## 聚合函数

| 函数 | 说明 |
|------|------|
| `COUNT(*)` | 行数（含 NULL） |
| `COUNT(col)` | col 非 NULL 的行数 |
| `SUM(col)` | 求和 |
| `AVG(col)` | 平均值 |
| `MAX(col)` / `MIN(col)` | 最大 / 最小值 |
| `GROUP_CONCAT(col)` | 分组拼接 |

## 窗口函数（8.0+）

| 函数 | 说明 |
|------|------|
| `ROW_NUMBER()` | 行号，无重复 |
| `RANK()` | 排名，有并列会跳号 |
| `DENSE_RANK()` | 排名，有并列不跳号 |
| `LAG(col, n)` | 前 n 行的值 |
| `LEAD(col, n)` | 后 n 行的值 |
| `NTILE(n)` | 分成 n 组 |
| `SUM() OVER()` | 累计求和 |
