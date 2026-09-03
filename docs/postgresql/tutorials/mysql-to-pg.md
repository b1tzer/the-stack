---
doc_id: pg-mysql-to-pg
title: MySQL 用户迁移到 PostgreSQL 指南
---

# MySQL 用户迁移到 PostgreSQL 指南

> 从 MySQL 转到 PG，最需要知道的差异。

## 1. 语法差异速查

| MySQL | PostgreSQL | 说明 |
| :-- | :-- | :-- |
| `AUTO_INCREMENT` | `SERIAL` / `BIGSERIAL` / `GENERATED ALWAYS AS IDENTITY` | PG 推荐用 `IDENTITY` |
| `IFNULL(a, b)` | `COALESCE(a, b)` | PG 不支持 IFNULL |
| `GROUP_CONCAT(...)` | `STRING_AGG(...)` | 语法不同 |
| `LIMIT 10 OFFSET 20` | 相同 | 一致 |
| `SHOW DATABASES` | `\l` 或 `SELECT datname FROM pg_database` | CLI 不同 |
| `SHOW TABLES` | `\dt` 或 `SELECT relname FROM pg_class WHERE relkind='r'` | CLI 不同 |
| `DESCRIBE table` | `\d table` | CLI 不同 |
| `NOW()` | `NOW()` / `CURRENT_TIMESTAMP` | 一致 |
| `ENGINE=InnoDB` | 不需要 | PG 只有一种存储引擎 |
| `` `backtick` `` | `"doublequote"` | 标识符引用不同 |

## 2. 事务隔离级别

```sql
-- MySQL 默认：REPEATABLE READ
-- PostgreSQL 默认：READ COMMITTED

-- 查看当前隔离级别
SHOW transaction_isolation;

-- 设置隔离级别
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

PG 的 READ COMMITTED 行为与 MySQL 的 RR 不同：每次 SELECT 看到的是该语句开始时的最新已提交数据，而不是事务开始时的快照。

## 3. MVCC 差异

```sql
-- MySQL：旧版本在 Undo Log，自动回收
-- PostgreSQL：旧版本在堆表中，需要 VACUUM

-- 查看 Dead Tuple
SELECT relname, n_live_tup, n_dead_tup
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;
```

## 4. JSONB 是 PG 的杀手级特性

```sql
-- MySQL JSON：文本存储，索引能力有限
-- PG JSONB：二进制存储，支持 GIN 索引

-- 创建 JSONB 列
CREATE TABLE products (id SERIAL, attrs JSONB);

-- 建 GIN 索引
CREATE INDEX idx_attrs ON products USING GIN (attrs);

-- 查询（MySQL 做不到的高效查询）
SELECT * FROM products WHERE attrs @> '{"brand": "Apple"}';
```

## 5. 窗口函数

```sql
-- MySQL 8.0+ 才支持，PG 支持更完整
SELECT name, department, salary,
    ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS rn,
    LAG(salary) OVER (PARTITION BY department ORDER BY salary) AS prev_salary
FROM employees;
```

## 6. 连接与认证

```bash
# MySQL
mysql -u root -p -h localhost mydb

# PostgreSQL
psql -U postgres -h localhost -d mydb
# 或
PGPASSWORD=xxx psql -U postgres -h localhost -d mydb
```

## 7. 常见陷阱

| 陷阱 | 说明 |
| :-- | :-- |
| 字符串用单引号 | PG 的标识符用双引号，字符串用单引号，与 MySQL 相同但更严格 |
| BOOLEAN 值 | PG 用 `true`/`false`，不是 `1`/`0` |
| 日期格式 | PG 推荐 `ISO 8601`（`2024-01-15`），不支持 MySQL 的自由格式 |
| 隐式类型转换 | PG 不做隐式转换，`WHERE id = '123'` 会报错（id 是 INT 时） |
| GROUP BY | PG 严格要求 SELECT 中的非聚合列都在 GROUP BY 中 |
| TRUNCATE 重启序列 | PG 的 `TRUNCATE` 不会重置 `SERIAL` 序列，需要 `TRUNCATE ... RESTART IDENTITY` |

## 8. ORM 适配

```yaml
# Spring Boot JPA 配置
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/mydb
    driver-class-name: org.postgresql.Driver
  jpa:
    database-platform: org.hibernate.dialect.PostgreSQLDialect
```

```yaml
# MyBatis 无需特殊配置，方言自动识别
# 注意：MyBatis-Plus 的自增策略需要调整
# MySQL: @TableId(type = IdType.AUTO)
# PostgreSQL: @TableId(type = IdType.AUTO) 或使用序列
```
