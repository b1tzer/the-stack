---
doc_id: pg-migration
title: 数据迁移
---

# 数据迁移

> **核心问题**：如何从 MySQL/Oracle 迁移到 PostgreSQL？如何做版本升级？

## 1. 版本升级（pg_upgrade）

```bash
# 检查兼容性（--check 模式）
/usr/pgsql-16/bin/pg_upgrade \
    -d /var/lib/postgresql/15/main \
    -D /var/lib/postgresql/16/main \
    -b /usr/pgsql-15/bin \
    -B /usr/pgsql-16/bin \
    --check

# 执行升级
/usr/pgsql-16/bin/pg_upgrade \
    -d /var/lib/postgresql/15/main \
    -D /var/lib/postgresql/16/main \
    -b /usr/pgsql-15/bin \
    -B /usr/pgsql-16/bin \
    --link  # 使用硬链接加速

# 更新统计信息
/usr/pgsql-16/bin/vacuumdb --all --analyze-in-stages
```

## 2. MySQL 迁移到 PostgreSQL

```bash
# 使用 pgloader
pgloader mysql://user:pass@mysql-host/mydb postgresql://user:pass@pg-host/mydb

# pgloader 配置文件
LOAD DATABASE
    FROM mysql://user:pass@mysql-host/mydb
    INTO postgresql://user:pass@pg-host/mydb
WITH include drop, create tables, create indexes,
     reset sequences, downcase identifiers
SET maintenance_work_mem to '512MB'
CAST type datetime to timestamptz drop default drop not null,
     type year to integer;
```

## 3. Oracle 迁移到 PostgreSQL

```bash
# 使用 ora2pg
ora2pg --project_base /opt/ora2pg --init_project mydb_migration

# 配置 ora2pg.conf
ORACLE_DSN  dbi:Oracle:host=oracle-host;sid=orcl
ORACLE_USER system
ORACLE_PWD  secret
PG_DSN      dbi:Pg:dbname=mydb;host=pg-host
PG_USER     postgres
PG_PWD      secret

# 导出表结构
ora2pg -t TABLE -o table.sql -b /opt/ora2pg/mydb_migration

# 导出数据
ora2pg -t COPY -o data.sql -b /opt/ora2pg/mydb_migration
```

## 4. 数据迁移工具对比

| 工具 | 说明 | 适用场景 |
| :-- | :-- | :-- |
| pgLoader | 从 MySQL/SQL Server/CSV 迁移 | 自动化迁移，支持多种源 |
| ora2pg | 从 Oracle 迁移 | Oracle 到 PG 的专业工具 |
| pg_dump/pg_restore | PG 之间迁移 | 版本升级、实例迁移 |
| COPY | CSV 数据导入 | 大批量数据导入 |

## 5. 迁移检查清单

| 检查项 | 说明 | 命令/方法 |
| :-- | :-- | :-- |
| 数据完整性 | 比较源和目标的行数 | `SELECT count(*) FROM table` |
| 索引完整性 | 检查索引是否都创建了 | `\d+ table` |
| 外键约束 | 检查外键是否正确 | `information_schema.table_constraints` |
| 序列值 | 检查序列当前值 | `SELECT last_value FROM seq` |
| 存储过程 | 测试函数和触发器 | 执行测试用例 |
| 性能基准 | 对比迁移前后的查询性能 | `EXPLAIN ANALYZE` |
| 应用兼容 | 测试应用连接和查询 | 运行应用测试 |

## 6. 迁移最佳实践

| 实践 | 说明 |
| :-- | :-- |
| 先迁移结构再迁移数据 | 表结构、索引、约束先创建好 |
| 分批迁移大数据表 | 使用 COPY + 分批导入 |
| 迁移后重建索引 | `REINDEX TABLE CONCURRENTLY` |
| 迁移后更新统计信息 | `ANALYZE` 所有表 |
| 保留回退方案 | 迁移前备份，确认无问题后再清理 |
| 应用适配 | SQL 语法差异、驱动适配、ORM 配置 |
