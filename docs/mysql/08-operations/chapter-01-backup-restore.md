# 备份恢复

## 1. 逻辑备份

```bash
# 全库备份
mysqldump -h localhost -u root -p --all-databases > all.sql

# 单库备份
mysqldump -h localhost -u root -p mydb > mydb.sql

# 单表备份
mysqldump -h localhost -u root -p mydb users > users.sql

# 一致性备份（推荐）
mysqldump --single-transaction --routines --triggers --all-databases > all.sql

# 恢复
mysql -h localhost -u root -p < all.sql
```

## 2. 物理备份

```bash
# xtrabackup
xtrabackup --backup --target-dir=/backup/full

# 恢复
xtrabackup --prepare --target-dir=/backup/full
xtrabackup --copy-back --target-dir=/backup/full
```

## 3. PITR

```bash
# 基于 Binlog 恢复
mysqlbinlog --start-datetime="2024-01-01 12:00:00" \
            --stop-datetime="2024-01-01 13:00:00" \
            binlog.000001 | mysql -u root -p
```

## 4. xtrabackup 增量备份

```bash
# 全量备份
xtrabackup --backup --target-dir=/backup/full -u root -psecret

# 增量备份（基于全量）
xtrabackup --backup --target-dir=/backup/inc1 \
    --incremental-basedir=/backup/full -u root -psecret

# 增量备份（基于上次增量）
xtrabackup --backup --target-dir=/backup/inc2 \
    --incremental-basedir=/backup/inc1 -u root -psecret

# 恢复增量备份
# 1. 准备全量备份
xtrabackup --prepare --apply-log-only --target-dir=/backup/full

# 2. 应用增量
xtrabackup --prepare --apply-log-only --target-dir=/backup/full \
    --incremental-dir=/backup/inc1
xtrabackup --prepare --target-dir=/backup/full \
    --incremental-dir=/backup/inc2

# 3. 恢复数据
xtrabackup --copy-back --target-dir=/backup/full
chown -R mysql:mysql /var/lib/mysql
```

## 5. 备份策略设计

```
推荐策略：全量 + 增量 + Binlog

周日：全量备份
周一-周六：增量备份
每天：Binlog 实时归档

恢复流程：
1. 恢复周日全量备份
2. 应用周一-周六增量备份
3. 应用 Binlog 恢复到故障点
```

```bash
#!/bin/bash
# 自动化备份脚本
BACKUP_DIR=/backup/mysql
DATE=$(date +%Y%m%d)
DAY_OF_WEEK=$(date +%u)

if [ $DAY_OF_WEEK -eq 7 ]; then
    # 周日全量备份
    xtrabackup --backup --target-dir=$BACKUP_DIR/full_$DATE -u root -psecret
else
    # 其他天增量备份
    LATEST_FULL=$(ls -d $BACKUP_DIR/full_* | sort | tail -1)
    LATEST_INC=$(ls -d $BACKUP_DIR/inc_* 2>/dev/null | sort | tail -1)
    BASE=${LATEST_INC:-$LATEST_FULL}
    xtrabackup --backup --target-dir=$BACKUP_DIR/inc_$DATE \
        --incremental-basedir=$BASE -u root -psecret
fi

# 清理 30 天前的备份
find $BACKUP_DIR -name "full_*" -mtime +30 -exec rm -rf {} \;
find $BACKUP_DIR -name "inc_*" -mtime +7 -exec rm -rf {} \;
```

## 6. Binlog 备份

```bash
# 实时归档 Binlog
mysqlbinlog --read-from-remote-server --host=192.168.1.100 \
    --user=repl --password=secret --raw \
    --stop-never --result-file=/backup/binlog/ mysql-bin.000001

# 定期备份 Binlog
cp /var/lib/mysql/mysql-bin.* /backup/binlog/
```

## 7. 备份验证

```bash
# 验证 mysqldump 备份
mysql -u root -p -e "CREATE DATABASE restore_test;"
mysql -u root -p restore_test < /backup/mydb.sql
mysql -u root -p -e "SELECT COUNT(*) FROM restore_test.users;"
mysql -u root -p -e "DROP DATABASE restore_test;"

# 验证 xtrabackup 备份
xtrabackup --prepare --target-dir=/backup/full
# 检查输出是否有 "completed OK!"
```

## 8. 最佳实践

1. **备份必须定期验证** — 备份不验证等于没备份
2. **使用 xtrabackup 物理备份** — 大数据量下比 mysqldump 快
3. **全量 + 增量 + Binlog** — 最完整的备份策略
4. **备份存储在异地** — 防止机房故障
5. **加密备份数据** — 保护敏感信息
6. **监控备份任务** — 确保备份成功完成
7. **保留至少 2 份备份** — 防止备份损坏

