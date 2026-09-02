# 数据迁移

## 1. 迁移工具

### 1.1 mysqldump

```bash
# 从源库导出
mysqldump -h source -u root -p --single-transaction mydb > mydb.sql

# 导入目标库
mysql -h target -u root -p mydb < mydb.sql
```

### 1.2 mydumper

```bash
# 并行导出
mydumper -h source -u root -p secret -B mydb -t 8 -o /backup/

# 并行导入
myloader -h target -u root -p secret -B mydb -t 8 -d /backup/
```

### 1.3 DM (Data Migration)

TiDB 生态的迁移工具。

```yaml
# dm-task.yaml
name: mydb-migration
task-mode: all
target-database:
  host: target
  port: 3306
  user: root
  password: "secret"
mysql-instances:
  - source-id: source1
    black-white-list: mydb-list
```

### 1.4 MySQL Shell 并行导出导入

```bash
# MySQL Shell 8.0+ 并行导出
mysqlsh root@192.168.1.100 -- util dump-instance /backup/mydb \
    --threads=8 --bytesPerChunk=256M

# 并行导入
mysqlsh root@192.168.1.101 -- util load-dump /backup/mydb \
    --threads=8 --updateGtidSet=replace

# 优势：
# - 并行导出导入，速度快
# - 支持压缩
# - 支持进度显示
# - 支持 GTID
```

## 2. 迁移场景

### 2.1 逻辑复制迁移

```sql
-- 使用 MySQL Shell 的 copyInstance 复制整个实例
-- mysqlsh root@source -- util copy-instance root@target

-- 使用 Binlog 实时同步
-- 1. 在源库开启 Binlog
-- 2. 在目标库配置复制
CHANGE REPLICATION SOURCE TO
    SOURCE_HOST='192.168.1.100',
    SOURCE_USER='repl',
    SOURCE_PASSWORD='secret',
    SOURCE_AUTO_POSITION=1;
START REPLICA;

-- 3. 等待数据同步完成
-- 4. 切换应用到目标库
-- 5. 停止复制
```

### 2.2 跨版本迁移

```bash
# MySQL 5.7 → 8.0 迁移

# 方案 1：逻辑备份恢复
mysqldump --single-transaction --routines --triggers --all-databases > dump.sql
mysql -h target -u root -p < dump.sql

# 方案 2：MySQL Shell 并行迁移
mysqlsh root@source -- util dump-instance /backup --threads=8
mysqlsh root@target -- util load-dump /backup --threads=8

# 方案 3：复制升级
# 1. 搭建 8.0 从库
# 2. 配置 5.7 主库 → 8.0 从库复制
# 3. 等待同步
# 4. 切换主从

# 注意事项：
# - 8.0 移除了查询缓存
# - utf8mb4 字符集必须
# - 默认认证插件变更：mysql_native_password → caching_sha2_password
# - 需要检查 SQL 兼容性
```

### 2.3 上云迁移

```bash
# MySQL → 云 RDS 迁移

# 方案 1：DTS（数据传输服务）
# 阿里云 DTS / AWS DMS / 腾讯云 DTS
# - 支持全量 + 增量同步
# - 支持结构迁移
# - 支持数据校验

# 方案 2：mysqldump + Binlog
mysqldump --single-transaction --routines --triggers --all-databases > dump.sql
# 上传到云存储
# 导入到 RDS
# 配置 Binlog 同步
# 切换应用

# 方案 3：物理迁移
# 使用 xtrabackup 备份
# 上传到云存储
# 通过 RDS 控制台导入
```

## 3. 验证与最佳实践

### 3.1 迁移验证

```sql
-- 数据量验证
SELECT table_name, table_rows
FROM information_schema.tables
WHERE table_schema = 'mydb'
ORDER BY table_name;

-- 数据一致性校验（pt-table-checksum）
-- pt-table-checksum --host=source --databases=mydb --user=root --password=secret

-- 抽样验证
SELECT * FROM users ORDER BY RAND() LIMIT 100;
SELECT COUNT(*) FROM orders WHERE created_at > '2024-01-01';

-- 应用层验证
-- 运行核心业务查询，对比结果
-- 检查关键业务流程
```

### 3.2 最佳实践

1. **选择合适的迁移工具** — 小数据量用 mysqldump，大数据量用 mydumper/MySQL Shell
2. **迁移前充分测试** — 在测试环境验证迁移流程
3. **预留回滚方案** — 迁移失败时能快速回退
4. **数据一致性校验** — 迁移后必须校验
5. **业务低峰期迁移** — 减少对业务影响
6. **监控迁移进度** — 确保迁移正常完成
7. **切换前停止写入** — 避免数据不一致
