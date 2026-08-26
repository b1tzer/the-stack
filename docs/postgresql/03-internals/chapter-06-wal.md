# WAL 预写日志

## 1. WAL 原理

Write-Ahead Logging：数据修改前先写 WAL 日志，保证崩溃恢复。

## 2. WAL 配置

```ini
wal_level = replica              # replica | logical
max_wal_size = 1GB
min_wal_size = 80MB
wal_compression = on
```

## 3. 检查点

```ini
checkpoint_timeout = 5min
checkpoint_completion_target = 0.9
```

## 4. WAL 文件管理

```sql
-- 查看 WAL 位置
SELECT pg_current_wal_lsn();

-- 切换 WAL
SELECT pg_switch_wal();
```

## 5. WAL 详解

### 5.1 WAL 的作用

WAL 是 PG 崩溃恢复和复制的基础。所有数据修改先写 WAL，再写数据文件。崩溃恢复时重放 WAL 即可恢复到崩溃前的状态。

```sql
-- 查看当前 WAL 位置
SELECT pg_current_wal_lsn();

-- 查看 WAL 文件列表
SELECT * FROM pg_ls_waldir() ORDER BY modification DESC LIMIT 10;

-- 查看 WAL 文件大小
SELECT name, size, modification
FROM pg_ls_waldir()
ORDER BY modification DESC LIMIT 5;

-- 手动切换 WAL 文件
SELECT pg_switch_wal();

-- 查看 WAL 写入统计
SELECT * FROM pg_stat_bgwriter;
```

### 5.2 WAL 级别

| wal_level | 用途 | 说明 |
|-----------|------|------|
| `replica` | 流复制、PITR | 默认值，支持归档和流复制 |
| `logical` | 逻辑复制 | 支持发布/订阅，WAL 体积更大 |

```sql
-- 查看当前 WAL 级别
SHOW wal_level;

-- 修改需要重启
ALTER SYSTEM SET wal_level = 'logical';
-- systemctl restart postgresql
```

### 5.3 检查点详解

检查点将所有脏页刷入磁盘，创建一个恢复点。检查点完成后，之前的 WAL 文件可以被回收。

```sql
-- 查看检查点配置
SHOW checkpoint_timeout;        -- 检查点间隔
SHOW checkpoint_completion_target; -- 完成目标
SHOW max_wal_size;              -- WAL 最大尺寸（超过此值触发检查点）

-- 手动触发检查点
CHECKPOINT;

-- 查看检查点统计
SELECT * FROM pg_stat_bgwriter;
```

### 5.4 WAL 归档

```ini
# 启用 WAL 归档（用于 PITR）
archive_mode = on
archive_command = 'cp %p /archive/%f'
# 或使用 pg_archivecleanup 管理
archive_command = 'test ! -f /archive/%f && cp %p /archive/%f'
```

```sql
-- 查看归档状态
SELECT * FROM pg_stat_archiver;

-- 查看未归档的 WAL 数量
SELECT count(*) FROM pg_ls_waldir();
```

### 5.5 WAL 压缩

```sql
-- PG 15+ 支持 WAL 压缩
SHOW wal_compression;

-- 启用 WAL 厂缩
ALTER SYSTEM SET wal_compression = on;
SELECT pg_reload_conf();
```

> **最佳实践**：生产环境启用 `wal_compression`，可减少 WAL 体积 30-50%，降低 IO 和网络带宽消耗。对流复制场景尤其有益。

### 5.6 LSN 与复制延迟

```sql
-- 查看当前 LSN
SELECT pg_current_wal_lsn();

-- 主库：查看复制延迟
SELECT
    client_addr,
    state,
    sent_lsn,
    write_lsn,
    flush_lsn,
    replay_lsn,
    pg_wal_lsn_diff(sent_lsn, replay_lsn) AS replay_lag_bytes
FROM pg_stat_replication;

-- 从库：查看 WAL 接收状态
SELECT status, received_lsn, latest_end_lsn
FROM pg_stat_wal_receiver;
```
