---
doc_id: pg-backup-restore
title: 备份恢复
---

# 备份恢复

> **核心问题**：逻辑备份和物理备份有什么区别？如何做 PITR 时间点恢复？

## 1. 逻辑备份

```bash
# 单库备份
pg_dump -h localhost -U postgres -d mydb > mydb.sql

# 单表备份
pg_dump -h localhost -U postgres -d mydb -t users > users.sql

# 自定义格式（支持并行恢复）
pg_dump -h localhost -U postgres -d mydb -Fc > mydb.dump

# 并行备份
pg_dump -h localhost -U postgres -d mydb -Fc -j 4 -f mydb.dump

# 只备份表结构
pg_dump -h localhost -U postgres -d mydb --schema-only > schema.sql

# 只备份数据
pg_dump -h localhost -U postgres -d mydb --data-only > data.sql

# 备份全局对象（角色、表空间）
pg_dumpall -h localhost -U postgres --globals-only > globals.sql

# 恢复
psql -h localhost -U postgres -d mydb < mydb.sql
pg_restore -h localhost -U postgres -d mydb -j 4 mydb.dump
```

## 2. 物理备份

```bash
# 基础备份
pg_basebackup -h localhost -U replicator -D /backup/base -Fp -Xs -P -R

# -R 自动生成 standby.signal 和 primary_conninfo
# -Xs 使用流复制传输 WAL
# -P 显示进度

# 压缩备份（PG 13+）
pg_basebackup -h localhost -U replicator -D /backup/base -Ft -z -P
```

## 3. PITR 时间点恢复

```ini
# 启用归档
# postgresql.conf
archive_mode = on
archive_command = 'cp %p /archive/%f'
```

```bash
# 恢复步骤
# 1. 停止数据库
systemctl stop postgresql

# 2. 恢复基础备份
cp -r /backup/base/* /var/lib/postgresql/16/main/

# 3. 创建恢复配置
cat > /var/lib/postgresql/16/main/postgresql.auto.conf << EOF
restore_command = 'cp /archive/%f %p'
recovery_target_time = '2024-06-15 12:00:00'
recovery_target_action = 'promote'
EOF

# 4. 创建恢复信号文件
touch /var/lib/postgresql/16/main/recovery.signal

# 5. 启动数据库
systemctl start postgresql
```

## 4. 增量备份（PG 17+）

```bash
# PG 17 支持增量备份
pg_basebackup -h localhost -U replicator -D /backup/inc1 --incremental

# 合并增量备份
pg_combinebackup /backup/base /backup/inc1 -D /backup/merged
```

## 5. 备份验证

```bash
# 验证备份完整性
pg_restore -l mydb.dump

# 测试恢复到临时实例
docker run -d --name pg_test -e POSTGRES_PASSWORD=secret postgres:16
pg_restore -h localhost -p 5433 -U postgres -d testdb mydb.dump
```

## 6. pgBackRest — 生产级备份工具

> pgBackRest 是 PG 社区推荐的生产级备份工具，支持并行备份、增量备份、差异备份、加密、远程备份等。

### 6.1 安装与配置

```ini
# /etc/pgbackrest/pgbackrest.conf
[global]
repo1-path=/backup/pgbackrest
repo1-retention-full=2
repo1-retention-diff=7
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=your-encryption-key
process-max=4
log-level-console=info

[mydb]
pg1-path=/var/lib/postgresql/16/main
pg1-port=5432
```

```ini
# postgresql.conf 配置归档
archive_mode = on
archive_command = 'pgbackrest --stanza=mydb archive-push %p'
```

### 6.2 常用操作

```bash
# 初始化 stanza
pgbackrest --stanza=mydb stanza-create

# 全量备份
pgbackrest --stanza=mydb --type=full backup

# 差异备份（只备份自上次全量后的变化）
pgbackrest --stanza=mydb --type=diff backup

# 增量备份（只备份自上次任意备份后的变化）
pgbackrest --stanza=mydb --type=incr backup

# 查看备份信息
pgbackrest --stanza=mydb info

# 恢复到最新状态
pgbackrest --stanza=mydb restore

# PITR 恢复到指定时间
pgbackrest --stanza=mydb restore \
    --type=time \
    --target="2024-06-15 12:00:00" \
    --target-action=promote

# 验证备份
pgbackrest --stanza=mydb check
```

### 6.3 pgBackRest vs pg_dump vs pg_basebackup

| 对比项 | pg_dump | pg_basebackup | pgBackRest |
| :-- | :-- | :-- | :-- |
| 备份类型 | 逻辑备份 | 物理备份 | 物理备份 |
| 增量备份 | ❌ | PG 17+ | ✅ |
| 并行备份 | ✅ (-j) | ❌ | ✅ |
| 压缩 | ✅ (-Z) | ✅ (-z) | ✅ |
| 加密 | ❌ | ❌ | ✅ |
| 远程备份 | ❌ | ✅ | ✅ |
| PITR | ❌ | 需手动配置 | ✅ 内置 |
| 适用规模 | < 100GB | 中型 | 任意规模 |

## 7. 备份脚本示例

```bash
#!/bin/bash
BACKUP_DIR=/backup/postgresql
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=7

pg_dump -h localhost -U postgres -d mydb -Fc -f ${BACKUP_DIR}/mydb_${DATE}.dump
find ${BACKUP_DIR} -name '*.dump' -mtime +${RETENTION_DAYS} -delete
echo "$(date): Backup completed: mydb_${DATE}.dump" >> ${BACKUP_DIR}/backup.log
```

## 7. 备份策略选择

| 策略 | 适用场景 | RPO | RTO | 工具 |
| :-- | :-- | :-- | :-- | :-- |
| 每日逻辑备份 | 小型数据库（< 100GB） | 24小时 | 小时级 | pg_dump |
| 每周全量 + 每日增量 | 中型数据库 | 24小时 | 分钟级 | pg_basebackup |
| 流复制 + WAL 归档 | 大型数据库，高可用 | 秒级 | 秒级 | 流复制 |
| 连续归档 | 金融级，任意时间点恢复 | 秒级 | 分钟级 | WAL 归档 |
