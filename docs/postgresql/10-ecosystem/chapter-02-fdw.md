---
doc_id: pg-fdw
title: 外部数据包装器（FDW）
---

# 外部数据包装器（FDW）

> **核心问题**：如何用 FDW 查询远程数据库？如何连接 MySQL？FDW 的性能如何？

## 1. postgres_fdw

```sql
-- 安装
CREATE EXTENSION postgres_fdw;

-- 创建外部服务器
CREATE SERVER remote_server 
    FOREIGN DATA WRAPPER postgres_fdw
    OPTIONS (host '192.168.1.100', port '5432', dbname 'remote_db');

-- 创建用户映射
CREATE USER MAPPING FOR local_user
    SERVER remote_server
    OPTIONS (user 'remote_user', password 'secret');

-- 导入远程表结构
IMPORT FOREIGN SCHEMA public
    LIMIT TO (users, orders)
    FROM SERVER remote_db
    INTO public;

-- 创建外部表
CREATE FOREIGN TABLE remote_users (
    id INT, name VARCHAR(50)
) SERVER remote_server OPTIONS (table_name 'users');
```

## 2. 跨库查询

```sql
-- 查询远程表（像本地表一样使用）
SELECT u.name, o.total
FROM remote_users u
JOIN remote_orders o ON u.id = o.user_id
WHERE o.created_at > '2024-01-01';

-- 联合本地和远程数据
SELECT l.local_data, r.remote_data
FROM local_table l
JOIN remote_users r ON l.user_id = r.id;
```

## 3. FDW 下推优化

```sql
-- FDW 会尽可能将 WHERE 条件下推到远程服务器执行
EXPLAIN VERBOSE
SELECT * FROM remote_users WHERE age > 25;
-- Remote SQL: SELECT id, name, age FROM users WHERE age > 25

-- 聚合函数也可以下推
EXPLAIN VERBOSE
SELECT count(*) FROM remote_users WHERE age > 25;
-- Remote SQL: SELECT count(*) FROM users WHERE age > 25
```

## 4. mysql_fdw（连接 MySQL）

```sql
CREATE EXTENSION mysql_fdw;

CREATE SERVER mysql_server
    FOREIGN DATA WRAPPER mysql_fdw
    OPTIONS (host '192.168.1.200', port '3306');

CREATE USER MAPPING FOR local_user
    SERVER mysql_server
    OPTIONS (username 'mysql_user', password 'mysql_pass');

CREATE FOREIGN TABLE mysql_users (
    id INT,
    name VARCHAR(100),
    email VARCHAR(200)
) SERVER mysql_server OPTIONS (dbname 'mysql_db', table_name 'users');
```

## 5. file_fdw（读取文件）

```sql
CREATE EXTENSION file_fdw;
CREATE SERVER csv_server FOREIGN DATA WRAPPER file_fdw;

CREATE FOREIGN TABLE csv_import (
    id INT,
    name TEXT,
    email TEXT
) SERVER csv_server OPTIONS (
    filename '/tmp/import.csv',
    format 'csv',
    header 'true'
);

-- 将 CSV 数据导入本地表
INSERT INTO users (name, email)
SELECT name, email FROM csv_import;
```

## 6. 性能优化

```sql
-- 设置获取行数
ALTER FOREIGN TABLE remote_users OPTIONS (SET fetch_size '1000');

-- 设置批量插入大小
ALTER FOREIGN TABLE remote_users OPTIONS (SET batch_size '500');
```

> **最佳实践**：FDW 适合跨库查询和数据迁移，不适合高频实时查询。远程查询会增加网络延迟，大量数据传输时考虑先将数据拉取到本地再处理。
