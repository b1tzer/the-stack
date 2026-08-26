# 安装部署与配置

## 1. 安装方式

### 1.1 Debian/Ubuntu
```bash
sudo apt install postgresql-16 postgresql-contrib-16
```

### 1.2 RHEL/CentOS
```bash
sudo yum install postgresql16-server postgresql16-contrib
sudo /usr/pgsql-16/bin/postgresql-16-setup initdb
sudo systemctl enable postgresql-16
sudo systemctl start postgresql-16
```

### 1.3 Docker
```bash
docker run -d --name pg16 \
  -e POSTGRES_PASSWORD=secret \
  -p 5432:5432 \
  postgres:16
```

## 2. 核心配置

```ini
# postgresql.conf
listen_addresses = '*'
max_connections = 200
shared_buffers = '4GB'              # 建议物理内存的 25%
effective_cache_size = '12GB'       # 建议物理内存的 75%
work_mem = '64MB'
maintenance_work_mem = '512MB'
wal_buffers = '64MB'
checkpoint_completion_target = 0.9
```

## 3. 目录结构

```
PGDATA/
├── base/          # 数据库文件
├── global/        # 集群共享数据
├── pg_wal/        # WAL 日志
├── pg_xact/       # 事务提交状态
├── pg_stat_tmp/   # 统计信息
└── postgresql.conf
```
## 4. 连接与认证配置

```ini
# 监听地址（生产环境建议指定具体 IP）
listen_addresses = '0.0.0.0'
port = 5432

# 最大连接数（建议配合连接池使用，不宜过大）
max_connections = 200

# 认证超时
authentication_timeout = 60s
```

```ini
# pg_hba.conf 认证规则
# TYPE  DATABASE  USER      ADDRESS         METHOD
local   all       all                       peer
host    all       all       127.0.0.1/32    scram-sha-256
host    all       all       10.0.0.0/8      scram-sha-256
host    replication replicator 10.0.0.0/8   scram-sha-256
```

> **最佳实践**：生产环境禁止使用 `trust` 认证，推荐 `scram-sha-256`（比 `md5` 更安全）。`pg_hba.conf` 的规则按顺序匹配，将严格的规则放在前面。

## 5. 内存配置详解

```ini
# 共享缓冲区：数据页缓存，建议物理内存的 25%
shared_buffers = '4GB'

# 告诉优化器可用的 OS 缓存大小（不实际分配内存）
effective_cache_size = '12GB'

# 排序和哈希操作的内存（每个操作独立分配）
# 注意：并发连接数 × work_mem 不能超过可用内存
work_mem = '64MB'

# VACUUM、CREATE INDEX 等维护操作的内存
maintenance_work_mem = '512MB'

# WAL 缓冲区（-1 表示自动计算）
wal_buffers = '64MB'
```

> **work_mem 调优要点**：`work_mem` 是每个排序/哈希操作独立分配的，并发高时总内存消耗 = 连接数 × 操作数 × work_mem。建议先设默认值较小（如 4MB），对特定查询通过 `SET LOCAL work_mem = '256MB'` 在事务内临时调大。

## 6. WAL 与检查点配置

```ini
# WAL 级别：replica 支持流复制，logical 支持逻辑复制
wal_level = replica

# 检查点间隔
checkpoint_timeout = 5min
checkpoint_completion_target = 0.9
max_wal_size = '4GB'
min_wal_size = '80MB'

# WAL 压缩（PG 15+）
wal_compression = on
```

## 7. 查询优化器配置

```ini
# 随机 IO 代价（SSD 设为 1.1，默认 4.0 适合 HDD）
random_page_cost = 1.1

# SSD 并发 IO 能力
effective_io_concurrency = 200

# 并行查询
max_parallel_workers_per_gather = 4
max_parallel_workers = 8
max_worker_processes = 16
```

## 8. 日志配置

```ini
logging_collector = on
log_directory = 'log'
log_filename = 'postgresql-%Y-%m-%d.log'
log_rotation_age = 1d
log_rotation_size = 100MB

# 记录慢查询（超过 1 秒）
log_min_duration_statement = 1000

# 记录检查点和自动清理
log_checkpoints = on
log_autovacuum_min_duration = 0

# 日志格式
log_line_prefix = '%m [%p] %u@%d '
log_statement = 'ddl'
```

> **最佳实践**：生产环境 `log_statement` 设为 `ddl`，避免日志过大。开启 `log_min_duration_statement` 记录慢查询，配合 `pgBadger` 分析日志。

## 9. 推荐配置模板

### 9.1 8GB 内存服务器

```ini
shared_buffers = 2GB
effective_cache_size = 6GB
work_mem = 32MB
maintenance_work_mem = 512MB
max_connections = 200
wal_buffers = 64MB
max_wal_size = 2GB
random_page_cost = 1.1
effective_io_concurrency = 200
```

### 9.2 32GB 内存服务器

```ini
shared_buffers = 8GB
effective_cache_size = 24GB
work_mem = 128MB
maintenance_work_mem = 2GB
max_connections = 500
wal_buffers = 64MB
max_wal_size = 8GB
random_page_cost = 1.1
effective_io_concurrency = 200
max_parallel_workers_per_gather = 4
```

## 10. 配置生效方式

```sql
-- 查看当前配置
SHOW shared_buffers;
SHOW ALL;

-- 修改配置（需要重启）
ALTER SYSTEM SET shared_buffers = '8GB';

-- 修改配置（无需重启，仅部分参数）
ALTER SYSTEM SET work_mem = '128MB';
SELECT pg_reload_conf();

-- 恢复默认值
ALTER SYSTEM RESET shared_buffers;
```

| 生效方式 | 适用参数 | 操作 |
|---------|---------|------|
| 重启生效 | shared_buffers、max_connections 等 | `systemctl restart postgresql` |
| reload 生效 | work_mem、log_min_duration_statement 等 | `SELECT pg_reload_conf()` |
| 会话级生效 | 所有参数 | `SET work_mem = '256MB'` |
