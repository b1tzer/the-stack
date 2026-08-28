---
doc_id: pg-ref-types
title: 类型速查表
---

# 类型速查表

## 数值类型

| 类型 | 存储 | 范围 |
|------|------|------|
| SMALLINT | 2字节 | -32768 ~ 32767 |
| INTEGER | 4字节 | -2147483648 ~ 2147483647 |
| BIGINT | 8字节 | 极大 |
| NUMERIC(p,s) | 可变 | 精确小数 |
| REAL | 4字节 | 6位精度 |
| DOUBLE PRECISION | 8字节 | 15位精度 |
| SERIAL | 4字节 | 自增整数 |
| BIGSERIAL | 8字节 | 自增大整数 |

## 字符串类型

| 类型 | 说明 |
|------|------|
| VARCHAR(n) | 可变长度，有上限 |
| CHAR(n) | 固定长度 |
| TEXT | 无限长度（推荐） |

## 日期时间类型

| 类型 | 说明 |
|------|------|
| TIMESTAMP | 日期时间（无时区） |
| TIMESTAMPTZ | 带时区（推荐） |
| DATE | 仅日期 |
| TIME | 仅时间 |
| INTERVAL | 时间间隔 |

## 布尔类型

| 类型 | 说明 |
|------|------|
| BOOLEAN | true/false/null |

## PG 独有类型

| 类型 | 说明 | 示例 |
|------|------|------|
| ARRAY | 数组 | `TEXT[]`、`INT[]` |
| JSONB | 二进制 JSON | `JSONB` |
| INET/CIDR | 网络地址 | `INET` |
| UUID | 全局唯一 ID | `UUID` |
| ENUM | 枚举 | `CREATE TYPE status AS ENUM (...)` |
| RANGE | 范围 | `INT4RANGE`、`TSRANGE` |
| HSTORE | 键值对 | `HSTORE` |
| COMPOSITE | 复合类型 | `CREATE TYPE address AS (...)` |

## 类型转换

```sql
-- 显式类型转换
SELECT '123'::INTEGER;
SELECT CAST('2024-01-01' AS DATE);

-- 常用转换函数
SELECT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS');
SELECT to_timestamp(1703275200);
SELECT to_date('20240101', 'YYYYMMDD');
```
