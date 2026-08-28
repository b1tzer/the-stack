---
doc_id: pg-user-security
title: 用户管理与安全
---

# 用户管理与安全

> **核心问题**：如何设计角色权限体系？如何配置 SSL？如何实现行级安全？

## 1. 角色层级设计

```sql
-- 创建角色层级
CREATE ROLE readonly;
CREATE ROLE readwrite;
CREATE ROLE admin;

-- 权限分配
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly;
GRANT readonly TO readwrite;  -- 继承 readonly 的权限
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO readwrite;
GRANT readwrite TO admin;
GRANT CREATE ON DATABASE mydb TO admin;

-- 将用户分配到角色
CREATE USER reader1 WITH PASSWORD 'secret';
GRANT readonly TO reader1;

CREATE USER writer1 WITH PASSWORD 'secret';
GRANT readwrite TO writer1;
```

## 2. Schema 权限

```sql
-- 创建独立的 schema
CREATE SCHEMA app;

-- 授权
GRANT USAGE ON SCHEMA app TO app_user;
GRANT CREATE ON SCHEMA app TO app_user;

-- 撤销 public schema 的默认权限
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
```

## 3. 列级权限

```sql
-- 只允许查看特定列
GRANT SELECT (name, department, salary) ON employees TO hr_user;

-- 只允许更新特定列
GRANT UPDATE (email, phone) ON employees TO self_service;
```

## 4. 默认权限

```sql
-- 设置新建表的默认权限
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO readwrite;

-- 设置新建序列的默认权限
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE ON SEQUENCES TO readwrite;
```

## 5. 行级安全策略（RLS）

```sql
-- 启用 RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 创建策略：用户只能看到自己的订单
CREATE POLICY user_orders ON orders
    FOR ALL
    USING (user_id = current_setting('app.current_user_id')::INT);

-- 设置当前用户（应用层设置）
SET app.current_user_id = '123';
SELECT * FROM orders;  -- 只返回 user_id = 123 的订单

-- 创建策略：管理员可以看到所有订单
CREATE POLICY admin_orders ON orders
    FOR ALL
    TO admin_role
    USING (true);
```

## 6. SSL 配置

```ini
# postgresql.conf
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file = 'server.key'
ssl_min_protocol_version = 'TLSv1.2'
ssl_ciphers = 'HIGH:!aNULL:!MD5'
```

```ini
# pg_hba.conf - 强制 SSL 连接
hostssl all all 0.0.0.0/0 scram-sha-256
```

## 7. 数据加密

```sql
-- 列级加密（使用 pgcrypto 扩展）
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 加密存储
INSERT INTO users (name, secret_data)
VALUES ('张三', pgp_sym_encrypt('敏感数据', 'encryption_key'));

-- 解密查询
SELECT name, pgp_sym_decrypt(secret_data, 'encryption_key') AS data
FROM users WHERE name = '张三';
```

## 8. 审计日志

```sql
-- 使用 pgaudit 扩展
CREATE EXTENSION IF NOT EXISTS pgaudit;

-- 配置审计（postgresql.conf）
-- pgaudit.log = 'write, ddl, role'
-- pgaudit.log_catalog = off
-- pgaudit.log_relation = on
```

## 9. SQL 注入防护

```sql
-- ❌ 动态拼接 SQL（有注入风险）
-- EXECUTE 'SELECT * FROM users WHERE name = ''' || user_input || '''';

-- ✅ 使用参数化查询
PREPARE user_query AS SELECT * FROM users WHERE name = $1;
EXECUTE user_query('张三');

-- ✅ 使用 format 函数（%I 自动加引号，%L 自动转义）
EXECUTE format('SELECT * FROM %I WHERE name = %L', table_name, user_input);
```

## 10. 最小权限原则

```sql
-- 创建只读用户
CREATE ROLE readonly_user WITH LOGIN PASSWORD 'secret';
GRANT CONNECT ON DATABASE mydb TO readonly_user;
GRANT USAGE ON SCHEMA public TO readonly_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly_user;

-- 创建应用用户
CREATE ROLE app_user WITH LOGIN PASSWORD 'secret';
GRANT CONNECT ON DATABASE mydb TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, orders TO app_user;

-- 禁止用户创建对象
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
```
