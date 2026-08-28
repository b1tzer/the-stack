---
doc_id: pg-streaming-replication
title: 流复制
---

# 流复制

> **核心问题**：如何搭建流复制？同步复制和异步复制有什么区别？如何做故障切换？

## 1. 主库配置

```ini
# postgresql.conf
wal_level = replica
max_wal_senders = 10
wal_keep_size = '1GB'
```

```ini
# pg_hba.conf
host replication replicator 0.0.0.0/0 scram-sha-256
```

## 2. 从库搭建

```bash
# 基础备份
pg_basebackup -h master_host -U replicator -D /var/lib/postgresql/16/main -Xs -P

# 配置 standby
cat > standby.signal << EOF
primary_conninfo = 'host=master_host user=replicator password=secret'
EOF
```

## 3. 同步复制

```ini
# 主库配置
synchronous_standby_names = 'FIRST 1 (standby1, standby2)'
# FIRST 1：至少 1 个从库确认写入后才返回成功
# ANY 2：任意 2 个从库确认即可
```

同步复制模式：
- `remote_write`：从库写入 OS 缓存即确认（默认）
- `remote_apply`：从库应用 WAL 后才确认（最安全，延迟最大）
- `off`：异步复制

## 4. 级联复制

```
主库 → 从库1 → 从库2（级联从库）
```

```ini
# 从库1 配置（作为级联复制源）
wal_level = replica
max_wal_senders = 10
hot_standby = on
```

## 5. 故障切换

```sql
-- 手动提升从库为主库
SELECT pg_promote();

-- 检查从库是否已提升
SELECT pg_is_in_recovery();  -- false 表示已提升为主库

-- 旧主库恢复后作为从库
pg_rewind --target-pgdata=/var/lib/postgresql/16/main \
          --source-server='host=new_master user=replicator password=secret'
touch /var/lib/postgresql/16/main/standby.signal
systemctl start postgresql
```

## 6. 复制槽管理

```sql
-- 创建复制槽（防止 WAL 被过早清理）
SELECT pg_create_physical_replication_slot('standby1_slot');

-- 查看复制槽
SELECT slot_name, slot_type, active,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS lag
FROM pg_replication_slots;

-- 删除不活跃的复制槽（防止 WAL 堆积）
SELECT pg_drop_replication_slot('standby1_slot');
```

## 7. 流复制监控

```sql
-- 主库：查看复制状态
SELECT
    pid, usename, client_addr, state,
    sent_lsn, write_lsn, flush_lsn, replay_lsn,
    pg_wal_lsn_diff(sent_lsn, replay_lsn) AS replay_lag_bytes,
    write_lag, flush_lag, replay_lag
FROM pg_stat_replication;

-- 从库：查看 WAL 接收状态
SELECT
    status, received_lsn, latest_end_lsn,
    last_msg_send_time, last_msg_receipt_time
FROM pg_stat_wal_receiver;

-- 从库：查看恢复状态
SELECT pg_is_in_recovery();
SELECT pg_last_wal_receive_lsn();
SELECT pg_last_wal_replay_lsn();
SELECT pg_last_xact_replay_timestamp();
```
