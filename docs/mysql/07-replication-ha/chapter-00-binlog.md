# Binlog

## 1. 作用

- 主从复制
- 数据恢复（Point-in-Time Recovery）

## 2. 格式

```ini
binlog_format = ROW
-- STATEMENT: 记录 SQL 语句（不推荐）
-- ROW: 记录行变更（推荐）
-- MIXED: 混合模式
```

## 3. 两阶段提交

```
1. InnoDB prepare（写 Redo Log）
2. Binlog write（写 Binlog）
3. InnoDB commit（标记提交）
```

## 4. 查看 Binlog

```sql
-- 查看 Binlog 列表
SHOW BINARY LOGS;

-- 查看 Binlog 内容
SHOW BINLOG EVENTS IN 'binlog.000001';

-- mysqlbinlog 工具
mysqlbinlog --base64-output=DECODE-ROWS -v binlog.000001
```

## 5. Binlog 格式详解

**STATEMENT 格式：**
```sql
-- 记录原始 SQL 语句
-- 优点：日志量小
-- 缺点：某些函数（NOW()、RAND()）结果不确定
SET binlog_format = 'STATEMENT';
```

**ROW 格式（推荐）：**
```sql
-- 记录每行数据的变更
-- 优点：数据一致性最好
-- 缺点：日志量大（批量更新时）
SET binlog_format = 'ROW';

-- ROW 格式的 Binlog 内容
-- @1=1, @2='张三', @3='zhangsan@example.com' (BEFORE)
-- @1=1, @2='张三三', @3='zhangsan@example.com' (AFTER)
```

**MIXED 格式：**
```sql
-- 默认使用 STATEMENT，遇到不确定函数自动切换为 ROW
-- 介于两者之间
SET binlog_format = 'MIXED';
```

## 6. Binlog 管理

```sql
-- 查看 Binlog 文件列表
SHOW BINARY LOGS;

-- 查看当前写入的 Binlog
SHOW MASTER STATUS;

-- 查看 Binlog 事件
SHOW BINLOG EVENTS IN 'binlog.000001' LIMIT 20;

-- 手动切换 Binlog 文件
FLUSH BLOGS;

-- 清理指定日期之前的 Binlog
PURGE BINARY LOGS BEFORE '2024-01-01 00:00:00';

-- 清理指定文件之前的 Binlog
PURGE BINARY LOGS TO 'binlog.000010';

-- 自动过期清理
SET GLOBAL binlog_expire_logs_seconds = 604800;  -- 7 天
```

## 7. Binlog 与数据恢复

```bash
# 基于 Binlog 的时间点恢复 (PITR)
# 场景：误删数据后恢复到删除前的状态

# 1. 先恢复全量备份
mysql -u root -p < full_backup.sql

# 2. 找到误操作的时间点
mysqlbinlog --base64-output=DECODE-ROWS -v binlog.000005 | grep -B5 'DELETE FROM users'

# 3. 恢复到误操作前
mysqlbinlog --stop-datetime='2024-01-01 12:30:00' \
    binlog.000001 binlog.000002 binlog.000003 | mysql -u root -p

# 4. 跳过误操作，继续恢复
mysqlbinlog --start-datetime='2024-01-01 12:31:00' \
    binlog.000003 binlog.000004 binlog.000005 | mysql -u root -p
```

## 8. Binlog 事件类型

| 事件类型 | 说明 |
|---------|------|
| FORMAT_DESCRIPTION | Binlog 文件头，描述版本信息 |
| QUERY | SQL 语句事件（STATEMENT 格式） |
| WRITE_ROWS | 写入行数据（ROW 格式） |
| UPDATE_ROWS | 更新行数据（ROW 格式） |
| DELETE_ROWS | 删除行数据（ROW 格式） |
| XID | 事务提交标记 |
| ROTATE | Binlog 文件轮转 |
| TABLE_MAP | 表定义映射 |

## 9. 最佳实践

1. **生产环境使用 ROW 格式** — 数据一致性最好，便于数据恢复
2. **开启 sync_binlog=1** — 与 `innodb_flush_log_at_trx_commit=1` 配合实现双1
3. **合理设置 Binlog 过期时间** — 一般 7-14 天，备份确认后可缩短
4. **监控 Binlog 磁盘空间** — 避免磁盘被 Binlog 写满
5. **不要在线禁用 Binlog** — 影响复制和数据恢复能力

---
