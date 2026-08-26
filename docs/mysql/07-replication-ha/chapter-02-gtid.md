# GTID 复制

## 1. 什么是 GTID

Global Transaction Identifier，全局事务标识符。
格式：`server_uuid:transaction_id`

## 2. 配置

```ini
# 主库和从库
gtid_mode = ON
enforce_gtid_consistency = ON
```

## 3. 优势

- 自动定位复制位点
- 主从切换简单
- 避免遗漏事务

## 4. 故障切换

```sql
-- 从库提升为主库
STOP SLAVE;
RESET SLAVE ALL;
SET GLOBAL read_only = OFF;
```

## 5. GTID 工作原理

```
GTID 格式：server_uuid:transaction_id
示例：3e11fa47-71ca-11e1-9e33-c80aa9429562:23

事务执行流程：
1. 客户端提交事务
2. 主库生成 GTID，写入 Binlog
3. 从库接收 Binlog，记录 GTID
4. 从库检查 GTID 是否已执行
   - 已执行 → 跳过
   - 未执行 → 执行并记录到 gtid_executed 集合
```

```sql
-- 查看已执行的 GTID 集合
SELECT @@global.gtid_executed;
-- 输出：3e11fa47-71ca-11e1-9e33-c80aa9429562:1-1000

-- 查看接收到的 GTID 集合
SELECT @@global.gtid_received;

-- 查看 GTID 相关变量
SHOW VARIABLES LIKE '%gtid%';
```

## 6. GTID 故障切换实战

```sql
-- 场景：主库宕机，从库提升为主库

-- 步骤 1：确认从库数据最新
SELECT @@global.gtid_executed;
SHOW REPLICA STATUS\G  -- 检查 Seconds_Behind_Source

-- 步骤 2：停止从库复制
STOP REPLICA;
RESET REPLICA ALL;

-- 步骤 3：提升为可写
SET GLOBAL read_only = OFF;
SET GLOBAL super_read_only = OFF;

-- 步骤 4：其他从库指向新主库
CHANGE REPLICATION SOURCE TO
    SOURCE_HOST='new_master_ip',
    SOURCE_USER='repl',
    SOURCE_PASSWORD='secret',
    SOURCE_AUTO_POSITION=1;
START REPLICA;
```

## 7. GTID 与传统复制对比

| 特性 | 传统复制 | GTID 复制 |
|------|---------|----------|
| 位点指定 | file + position | 自动定位 |
| 故障切换 | 手动找位点，容易出错 | 自动，简单可靠 |
| 数据一致性 | 可能遗漏事务 | 自动跳过已执行事务 |
| 多源复制 | 支持 | 更方便 |
| 配置复杂度 | 简单 | 稍复杂 |
| 推荐 | 老版本 | ✅ MySQL 5.6+ 推荐 |

## 8. GTID 限制

```sql
-- 以下操作在 GTID 模式下不允许：
-- 1. CREATE TABLE ... SELECT（会被拆分为两个事务）
-- 2. 事务中同时更新事务表和非事务表
-- 3. CREATE TEMPORARY TABLE 在事务中

-- 解决方案：
-- CREATE TABLE ... SELECT 改为：
CREATE TABLE new_table LIKE old_table;
INSERT INTO new_table SELECT * FROM old_table;

-- 临时表问题：
SET SESSION sql_log_bin = OFF;  -- 临时关闭 Binlog（谨慎）
CREATE TEMPORARY TABLE tmp ...;
SET SESSION sql_log_bin = ON;
```

## 9. 最佳实践

1. **新项目统一使用 GTID 复制** — 简化运维
2. **配合 semi-sync 保证数据一致性** — 至少一个从库确认接收
3. **监控 GTID 延迟** — 对比主从 gtid_executed 集合
4. **定期备份 GTID 集合** — 便于故障恢复
5. **使用 Orchestrator/MHA 管理 GTID 故障切换**

