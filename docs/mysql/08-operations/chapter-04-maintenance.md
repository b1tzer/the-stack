# 日常维护

## 1. 表维护命令

### 1.1 OPTIMIZE TABLE

```sql
-- 整理碎片
OPTIMIZE TABLE users;
```

### 1.2 ANALYZE TABLE

```sql
-- 更新统计信息
ANALYZE TABLE users;
```

### 1.3 CHECK TABLE

```sql
-- 检查表完整性
CHECK TABLE users;
```

## 2. 空间与数据清理

### 2.1 表空间管理

```sql
-- 查看表大小
SELECT 
    table_name,
    ROUND(data_length / 1024 / 1024, 2) AS data_mb,
    ROUND(index_length / 1024 / 1024, 2) AS index_mb,
    ROUND((data_length + index_length) / 1024 / 1024, 2) AS total_mb
FROM information_schema.tables
WHERE table_schema = 'mydb'
ORDER BY total_mb DESC;
```

### 2.2 清理历史数据

```sql
-- 删除 30 天前的数据
DELETE FROM logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);

-- 分批删除
DELETE FROM logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY) LIMIT 10000;
```

### 2.3 碎片整理

```sql
-- 查看碎片率
SELECT
    table_name,
    ROUND(data_length / 1024 / 1024, 2) AS data_mb,
    ROUND(data_free / 1024 / 1024, 2) AS free_mb,
    ROUND(data_free / data_length * 100, 2) AS frag_pct
FROM information_schema.tables
WHERE table_schema = 'mydb'
    AND data_length > 0
    AND data_free / data_length > 0.1  -- 碎片率超过 10%
ORDER BY frag_pct DESC;

-- 整理碎片（大表建议使用 pt-online-schema-change）
-- 方法 1：OPTIMIZE TABLE（会锁表）
OPTIMIZE TABLE users;

-- 方法 2：ALTER TABLE（MySQL 5.6+ 在线 DDL）
ALTER TABLE users ENGINE=InnoDB;

-- 方法 3：pt-online-schema-change（推荐）
-- pt-online-schema-change --alter "ENGINE=InnoDB" D=mydb,t=users --execute
```

### 2.4 历史数据归档

```sql
-- 创建归档表（结构相同）
CREATE TABLE orders_archive LIKE orders;

-- 归档 1 年前的数据
INSERT INTO orders_archive
SELECT * FROM orders WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 YEAR);

-- 验证归档数据
SELECT COUNT(*) FROM orders_archive;

-- 分批删除原表数据
DELIMITER //
CREATE PROCEDURE archive_orders()
BEGIN
    DECLARE affected INT DEFAULT 1;
    WHILE affected > 0 DO
        DELETE FROM orders
        WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 YEAR)
        LIMIT 5000;
        SET affected = ROW_COUNT();
        DO SLEEP(0.1);
    END WHILE;
END //
DELIMITER ;

-- 使用分区表快速归档
-- 如果表已按时间分区，直接 DROP PARTITION
ALTER TABLE orders DROP PARTITION p2023;
```

## 3. 数据库升级

```bash
# 升级前检查
mysqlcheck --all-databases --check --user=root -p
mysqlcheck --all-databases --analyze --user=root -p

# 备份
mysqldump --all-databases --single-transaction --routines --triggers > pre_upgrade.sql

# 升级步骤（MySQL 5.7 → 8.0）
# 1. 停止应用
# 2. 停止 MySQL
systemctl stop mysqld

# 3. 安装新版本
yum install mysql-community-server-8.0

# 4. 启动 MySQL（自动执行升级）
systemctl start mysqld

# 5. 检查错误日志
tail -f /var/log/mysql/error.log

# 6. 运行升级检查
mysql_upgrade -u root -p  # MySQL 8.0.16+ 自动执行
```

## 4. 维护清单

### 4.1 日常维护 Checklist

| 项目 | 频率 | 命令 |
| :-- | :-- | :-- |
| 检查磁盘空间 | 每天 | `df -h` |
| 检查错误日志 | 每天 | `tail /var/log/mysql/error.log` |
| 检查慢查询 | 每天 | `mysqldumpslow` |
| 检查复制状态 | 每天 | `SHOW REPLICA STATUS` |
| 更新统计信息 | 每周 | `ANALYZE TABLE` |
| 检查碎片率 | 每周 | `information_schema.tables` |
| 清理历史数据 | 每月 | 分批 DELETE / DROP PARTITION |
| 全量备份验证 | 每月 | 恢复测试 |
| 权限审计 | 每月 | `SHOW GRANTS` |
| 性能基线对比 | 每月 | Grafana 趋势图 |

### 4.2 最佳实践

1. **维护窗口选择业务低峰期** — 减少对业务影响
2. **大表操作使用 pt-osc/gh-ost** — 避免锁表
3. **分批处理大数据量操作** — 避免长事务
4. **维护前必须备份** — 防止误操作
5. **自动化维护任务** — 使用 cron 或调度系统
6. **监控维护任务执行情况** — 确保任务成功完成
