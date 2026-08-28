---
doc_id: pg-first-production
title: PostgreSQL 首次生产部署清单
---

# PostgreSQL 首次生产部署清单

> 从开发环境到生产环境，必须检查的关键项。

## 1. 安装与基础配置

```bash
# 安装（Debian/Ubuntu）
sudo apt install postgresql-16 postgresql-contrib-16

# 启动
sudo systemctl enable postgresql-16
sudo systemctl start postgresql-16
```

## 2. 必须修改的配置

```ini
# postgresql.conf

# 内存（根据物理内存调整）
shared_buffers = '4GB'              # 物理内存的 25%
effective_cache_size = '12GB'       # 物理内存的 75%
work_mem = '64MB'                   # 根据并发调整
maintenance_work_mem = '512MB'

# 连接
max_connections = 200               # 配合连接池使用
listen_addresses = '*'              # 生产环境限制具体 IP

# WAL
wal_level = replica
max_wal_size = '4GB'
wal_compression = on                # PG 15+

# 检查点
checkpoint_timeout = 5min
checkpoint_completion_target = 0.9

# SSD 优化
random_page_cost = 1.1
effective_io_concurrency = 200

# 日志
logging_collector = on
log_directory = 'log'
log_filename = 'postgresql-%Y-%m-%d.log'
log_min_duration_statement = 1000   # 记录慢查询
log_statement = 'ddl'
```

## 3. 认证配置

```ini
# pg_hba.conf
# TYPE  DATABASE  USER      ADDRESS         METHOD
local   all       all                       peer
host    all       all       127.0.0.1/32    scram-sha-256
host    all       all       10.0.0.0/8      scram-sha-256
host    replication replicator 10.0.0.0/8   scram-sha-256
```

禁止使用 `trust` 认证。推荐 `scram-sha-256`。

## 4. 用户与权限

```sql
-- 创建应用用户（不要用超级用户运行应用）
CREATE ROLE app_user WITH LOGIN PASSWORD 'strong_password';
GRANT CONNECT ON DATABASE mydb TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
```

## 5. Autovacuum 配置

```ini
autovacuum = on
autovacuum_max_workers = 3
autovacuum_naptime = 1min
```

高频更新的大表需要单独调参：

```sql
ALTER TABLE hot_table SET (
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_vacuum_threshold = 100
);
```

## 6. 备份策略

```bash
# 每日逻辑备份
pg_dump -Fc -f /backup/mydb_$(date +%Y%m%d).dump mydb

# 启用 WAL 归档（用于 PITR）
# postgresql.conf
archive_mode = on
archive_command = 'cp %p /archive/%f'

# 推荐使用 pgBackRest
```

## 7. 监控

```sql
-- 安装 pg_stat_statements
CREATE EXTENSION pg_stat_statements;

-- 查看最慢的查询
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;

-- 查看连接数
SELECT count(*) FROM pg_stat_activity;

-- 查看表膨胀
SELECT relname, n_dead_tup,
    ROUND(n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) * 100, 2) AS dead_pct
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;
```

## 8. 连接池

```bash
# 推荐 PgBouncer
sudo apt install pgbouncer

# /etc/pgbouncer/pgbouncer.ini
[databases]
mydb = host=127.0.0.1 port=5432 dbname=mydb

[pgbouncer]
listen_port = 6432
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 50
```

## 9. 上线检查清单

- [ ] shared_buffers 已根据内存调整
- [ ] max_connections 已设置合理值
- [ ] pg_hba.conf 已禁止 trust
- [ ] 应用用户已创建，非超级用户
- [ ] autovacuum 已开启
- [ ] 备份策略已配置并测试恢复
- [ ] pg_stat_statements 已安装
- [ ] 慢查询日志已开启
- [ ] 连接池已配置（如 PgBouncer）
- [ ] 监控已接入（Prometheus + postgres_exporter 或类似方案）
- [ ] 已测试故障恢复流程
