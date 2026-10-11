# 常用函数速查

> 本页只列常用函数，不覆盖完整函数库。参数、返回类型和适用版本以目标 MySQL 版本参考手册为准；表达式包索引列时可能无法直接使用普通索引，见[索引使用](../03-index/chapter-03-index-usage.md)。

## 字符串函数

| 函数 | 说明 | 示例 |
| :-- | :-- | :-- |
| `CONCAT(s1, s2, ...)` | 拼接字符串 | `CONCAT('Hello', ' ', 'World')` |
| `CONCAT_WS(sep, s1, s2)` | 用分隔符拼接 | `CONCAT_WS('-', '2026', '08', '31')` |
| `SUBSTRING(s, pos, len)` | 截取子串 | `SUBSTRING('Hello', 1, 3)` → `Hel` |
| `LENGTH(s)` | 字节长度 | `LENGTH('你好')` → 6（utf8mb4） |
| `CHAR_LENGTH(s)` | 字符长度 | `CHAR_LENGTH('你好')` → 2 |
| `TRIM(s)` | 去首尾空格 | `TRIM('  hi  ')` → `hi` |
| `REPLACE(s, from, to)` | 替换 | `REPLACE('abc', 'b', 'X')` → `aXc` |

## 条件与 NULL

| 函数 | 说明 | 示例 |
| :-- | :-- | :-- |
| `IFNULL(expr1, expr2)` | `expr1` 为 NULL 时返回 `expr2` | `IFNULL(col, 'unknown')` |
| `COALESCE(a, b, c)` | 返回第一个非 NULL 参数 | `COALESCE(a, b, c)` |
| `IF(condition, true_value, false_value)` | 简单条件表达式 | `IF(status = 1, 'on', 'off')` |
| `CASE ... WHEN ... THEN ... END` | 多分支条件表达式 | `CASE status WHEN 1 THEN 'on' ELSE 'off' END` |

`COALESCE` 和 `IFNULL` 不限于字符串；聚合函数 `SUM`、`AVG`、`MAX` 和 `MIN` 通常忽略 NULL，但 `COUNT(*)` 统计行数，包含被统计列值为 NULL 的行。

## 日期函数

| 函数 | 说明 | 示例 |
| :-- | :-- | :-- |
| `NOW()` | 当前日期时间 | `2026-08-31 12:00:00` |
| `CURDATE()` | 当前日期 | `2026-08-31` |
| `DATE_FORMAT(d, fmt)` | 格式化日期 | `DATE_FORMAT(NOW(), '%Y-%m-%d')` |
| `DATEDIFF(d1, d2)` | 日期差（天） | `DATEDIFF('2026-12-31', '2026-01-01')` → 364 |
| `DATE_ADD(d, INTERVAL n unit)` | 日期加减 | `DATE_ADD(NOW(), INTERVAL 7 DAY)` |
| `UNIX_TIMESTAMP(d)` | 转时间戳 | `UNIX_TIMESTAMP(NOW())` |
| `FROM_UNIXTIME(ts)` | 时间戳转日期 | `FROM_UNIXTIME(1693000000)` |

## 聚合函数

| 函数 | 说明 |
| :-- | :-- |
| `COUNT(*)` | 当前分组或结果集的行数，包括被统计列值为 NULL 的行 |
| `COUNT(col)` | `col` 非 NULL 的行数 |
| `COUNT(DISTINCT col)` | `col` 非 NULL 的不同值数量 |
| `SUM(col)` | 求和 |
| `AVG(col)` | `col` 非 NULL 值的平均值 |
| `MAX(col)` / `MIN(col)` | 最大 / 最小值 |
| `GROUP_CONCAT(col)` | 分组拼接；结果为 NULL 时默认返回 NULL，并受 `group_concat_max_len` 限制 |

## 数值函数

| 函数 | 说明 | 示例 |
| :-- | :-- | :-- |
| `ROUND(x, d)` | 四舍五入到 `d` 位小数 | `ROUND(123.456, 2)` → `123.46` |
| `TRUNCATE(x, d)` | 截断到 `d` 位小数 | `TRUNCATE(123.456, 2)` → `123.45` |
| `ABS(x)` | 绝对值 | `ABS(-8)` → `8` |
| `MOD(x, y)` | 取余 | `MOD(7, 3)` → `1` |

## 窗口函数（8.0+）

| 函数 | 说明 |
| :-- | :-- |
| `ROW_NUMBER()` | 行号，无重复 |
| `RANK()` | 排名，有并列会跳号 |
| `DENSE_RANK()` | 排名，有并列不跳号 |
| `LAG(col, n)` | 前 n 行的值 |
| `LEAD(col, n)` | 后 n 行的值 |
| `NTILE(n)` | 分成 n 组 |
| `SUM() OVER()` | 累计求和 |

所有窗口函数都必须带 `OVER(...)` 子句；MySQL 8.0 起支持本节函数。

## JSON 函数

| 函数 | 说明 | 示例 |
| :-- | :-- | :-- |
| `JSON_EXTRACT(json, path)` | 按路径提取 JSON 值 | `JSON_EXTRACT(doc, '$.name')` |
| `JSON_OBJECT(...)` | 创建 JSON 对象 | `JSON_OBJECT('id', 1)` |
| `JSON_ARRAY(...)` | 创建 JSON 数组 | `JSON_ARRAY(1, 2, 3)` |
| `JSON_VALID(expr)` | 判断字符串是否为有效 JSON | `JSON_VALID(payload)` |

JSON 查询、函数索引和生成列的完整用法见 [JSON 类型](../06-sql-and-schema/chapter-03-json.md)。
