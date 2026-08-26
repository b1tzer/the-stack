# 在线 DDL

## 1. 原生 Online DDL

```sql
-- 8.0+ 支持
ALTER TABLE users ADD COLUMN age INT, ALGORITHM=INPLACE, LOCK=NONE;
```

## 2. pt-osc

```bash
# Percona Toolkit
pt-online-schema-change \
    --alter "ADD COLUMN age INT" \
    --execute \
    D=mydb,t=users
```

## 3. gh-ost

```bash
# GitHub
gh-ost \
    --database=mydb \
    --table=users \
    --alter="ADD COLUMN age INT" \
    --execute
```

## 4. 对比

| 工具 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| Online DDL | InnoDB 原生 | 无额外工具 | 大表仍慢 |
| pt-osc | 触发器复制 | 成熟稳定 | 触发器开销 |
| gh-ost | Binlog 流 | 无触发器 | 需要 Binlog |

## 5. 原生 Online DDL 详解

```sql
-- 支持 Online DDL 的操作
ALTER TABLE users ADD COLUMN age INT, ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE users DROP COLUMN age, ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE users MODIFY name VARCHAR(100), ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE users ADD INDEX idx_name (name), ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE users DROP INDEX idx_name, ALGORITHM=INPLACE, LOCK=NONE;

-- 不支持 Online DDL 的操作（需要 COPY）
ALTER TABLE users CHANGE id id BIGINT, ALGORITHM=COPY;  -- 修改主键
ALTER TABLE users CONVERT TO CHARACTER SET utf8mb4, ALGORITHM=COPY;  -- 修改字符集

-- ALGORITHM 选项
-- INPLACE: 在原表上修改，不需要复制数据
-- COPY: 创建新表，复制数据（锁表）
-- INSTANT: 瞬间完成（MySQL 8.0+，仅部分操作）

-- LOCK 选项
-- NONE: 不锁表，允许读写
-- SHARED: 共享锁，允许读，禁止写
-- EXCLUSIVE: 排他锁，禁止读写

-- MySQL 8.0 INSTANT DDL
ALTER TABLE users ADD COLUMN remark VARCHAR(200) DEFAULT '', ALGORITHM=INSTANT;  -- 瞬间完成
ALTER TABLE users DROP COLUMN remark, ALGORITHM=INSTANT;  -- 瞬间完成
```

## 6. pt-osc 详解

```bash
# 基本用法
pt-online-schema-change \
    --alter "ADD COLUMN age INT DEFAULT 0" \
    --user=root --password=secret \
    --host=192.168.1.100 \
    --execute \
    D=mydb,t=users

# 常用参数
pt-online-schema-change \
    --alter "ADD COLUMN age INT" \
    --chunk-size=1000          # 每批处理行数
\    --max-lag=1s               # 从库延迟超过 1s 暂停
\    --max-load="Threads_running=25"  # 负载过高暂停
\    --critical-load="Threads_running=50"  # 负载过高终止
\    --progress=time,30         # 每 30 秒打印进度
\    --statistics               # 打印统计信息
\    --dry-run                  # 只检查，不执行
\    --execute

# 工作原理：
# 1. 创建与原表结构相同的新表
# 2. 在新表上执行 ALTER TABLE
# 3. 创建触发器（INSERT/UPDATE/DELETE）
# 4. 分批复制数据到新表
# 5. 重命名表（原子操作）：原表 → old, new → 原表
# 6. 删除旧表和触发器
```

## 7. gh-ost 详解

```bash
# 基本用法
gh-ost \
    --host=192.168.1.100 \
    --database=mydb \
    --table=users \
    --alter="ADD COLUMN age INT" \
    --user=root --password=secret \
    --execute

# 常用参数
gh-ost \
    --chunk-size=1000 \
    --max-lag-millis=1500 \
    --serve-socket-file=/tmp/gh-ost.sock  # 交互式控制
\    --initially-drop-ghost-table \
    --initially-drop-old-table \
    --execute

# 交互式控制（通过 socket 文件）
echo "throttle" | nc -U /tmp/gh-ost.sock  # 暂停
echo "no-throttle" | nc -U /tmp/gh-ost.sock  # 恢复
echo "chunk-size=500" | nc -U /tmp/gh-ost.sock  # 修改参数

# 工作原理：
# 1. 创建 ghost 表
# 2. 在 ghost 表上执行 ALTER TABLE
# 3. 通过 Binlog 流捕获变更（无触发器）
# 4. 分批复制数据到 ghost 表
# 5. 应用 Binlog 中的变更
# 6. 原子切换表名
```

## 8. DDL 操作风险评估

| 操作 | 风险 | 建议方案 |
|------|------|----------|
| ADD COLUMN (nullable) | 低 | INSTANT DDL |
| ADD COLUMN (NOT NULL + DEFAULT) | 低 | INSTANT DDL (8.0+) |
| ADD INDEX | 中 | Online DDL / pt-osc |
| DROP INDEX | 低 | Online DDL |
| MODIFY COLUMN | 高 | pt-osc / gh-ost |
| CHANGE CHARSET | 高 | pt-osc / gh-ost |
| DROP COLUMN | 中 | Online DDL |
| ADD PRIMARY KEY | 极高 | pt-osc / gh-ost |

## 9. 最佳实践

1. **优先使用原生 Online DDL** — MySQL 8.0 INSTANT DDL 性能最好
2. **大表 DDL 使用 gh-ost** — 无触发器，可暂停恢复
3. **操作前评估影响** — 使用 `--dry-run` 检查
4. **设置负载阈值** — 负载过高自动暂停
5. **监控从库延迟** — 避免从库延迟过大
6. **在业务低峰期执行** — 减少对业务影响

