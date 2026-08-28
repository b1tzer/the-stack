---
doc_id: pg-xid-wraparound
title: 事务 ID 回卷（XID Wraparound）
---

# 事务 ID 回卷（XID Wraparound）

> **核心问题**：PostgreSQL 使用 32 位事务 ID（约 21 亿），当事务 ID 耗尽后会从零开始循环（Wraparound），若不及时处理将导致**数据丢失**甚至**数据库自动关机保护**。

## 1. 什么是事务 ID 回卷

PostgreSQL 为每个事务分配一个 32 位无符号整数作为事务 ID（XID）。由于 32 位最大值约为 2^31 ≈ 21 亿，当事务 ID 计数器到达最大值后，会回绕到 3 开始重新分配（0、1、2 为保留值）。

这意味着两个相距甚远的事务可能拥有相同的 XID，数据库无法区分"新事务"和"旧事务"，从而导致数据可见性判断错误。

## 2. 回卷的后果

PostgreSQL 通过 **frozenxid** 机制来应对回卷问题——将旧事务标记为 "frozen"，表示它们对所有事务可见。

如果 frozenxid 跟不上事务 ID 的增长：

1. **数据不可见**：旧数据行的 XID 被误判为"未来事务"，导致数据莫名消失
2. **数据库关机保护**：当事务 ID 年龄接近 2^31 时，PostgreSQL 会**拒绝所有新连接**并强制关闭数据库，仅允许单用户模式执行 VACUUM FREEZE
3. **恢复耗时**：在紧急模式下对大表执行 VACUUM FREEZE 可能耗时数小时

## 3. 事务 ID 年龄监控

```sql
-- 查看所有数据库的事务 ID 年龄
SELECT
    datname,
    age(datfrozenxid) AS xid_age,
    2^31 - age(datfrozenxid) AS remaining_xids,
    pg_size_pretty(pg_database_size(datname)) AS db_size
FROM pg_database
WHERE datistemplate = false
ORDER BY xid_age DESC;

-- 输出示例：
--  datname  | xid_age   | remaining_xids | db_size
-- ---------+-----------+----------------+---------
--  mydb     |  1800000  |   1967498308   | 128 GB
--  testdb   |    50000  |   2147433648   | 2 GB
```

```sql
-- 查看单个表级别的事务 ID 年龄
SELECT
    relname,
    age(relfrozenxid) AS xid_age,
    n_live_tup,
    n_dead_tup
FROM pg_stat_user_tables
ORDER BY xid_age DESC
LIMIT 20;
```

**告警阈值建议**：
- 黄色告警：事务 ID 年龄 > 5 亿
- 红色告警：事务 ID 年龄 > 10 亿
- 紧急处理：事务 ID 年龄 > 15 亿

## 4. freeze 阈值配置

```ini
# 当表的事务 ID 年龄超过此值时，强制执行 VACUUM（即使 autovacuum 已关闭）
# 默认 2 亿，建议保持默认或设为 2 亿
autovacuum_freeze_max_age = 200000000

# VACUUM 时将小于此年龄的事务 ID 标记为 frozen
# 默认 5000 万，对于高事务量系统可适当降低
vacuum_freeze_min_age = 50000000

# 多事务年龄的上限（通常不需要修改）
vacuum_multixact_freeze_min_age = 5000000
vacuum_multixact_freeze_max_age = 200000000
```

**关键理解**：`autovacuum_freeze_max_age` 决定了"何时触发紧急 freeze"，`vacuum_freeze_min_age` 决定了"freeze 时清理多旧的事务"。降低 `vacuum_freeze_min_age` 可以让更多旧事务被标记为 frozen，但会增加 VACUUM 的工作量。

## 5. 紧急处理流程

当事务 ID 年龄接近危险值时：

```bash
# 1. 检查当前状态
psql -c "SELECT age(datfrozenxid) FROM pg_database WHERE datname='mydb';"

# 2. 确保没有长事务（长事务会阻止 freeze）
psql -c "SELECT pid, now()-xact_start AS duration, query
         FROM pg_stat_activity
         WHERE state != 'idle' AND xact_start IS NOT NULL
         ORDER BY duration DESC;"

# 3. 对问题数据库执行 VACUUM FREEZE
# 注意：这会消耗大量 I/O，建议在低峰期执行
psql -c "VACUUM FREEZE VERBOSE;" -d mydb

# 4. 或者针对特定大表执行
psql -c "VACUUM FREEZE VERBOSE large_table;" -d mydb
```

如果数据库已进入只读保护模式：
```bash
# 停止 PostgreSQL，以单用户模式启动进行修复
pg_ctl stop
postgres --single -D /var/lib/postgresql/data mydb
# 在单用户模式中执行 VACUUM FREEZE
```

## 6. 预防措施

```ini
# postgresql.conf 推荐配置

# 确保 autovacuum 开启（默认开启，切勿关闭！）
autovacuum = on

# 设置合理的 autovacuum 工作进程数
autovacuum_max_workers = 3

# 降低 freeze 阈值，让 freeze 更频繁
autovacuum_freeze_max_age = 200000000
vacuum_freeze_min_age = 50000000
```

```sql
-- 创建监控脚本，定期检查
-- 推荐每小时执行一次，通过 cron 或监控系统调用

-- 告警 SQL：当任何数据库事务 ID 年龄超过 1 亿时告警
SELECT datname, age(datfrozenxid) AS xid_age
FROM pg_database
WHERE datistemplate = false AND age(datfrozenxid) > 100000000;
```

## 7. 真实案例：某电商因未配置 autovacuum 导致回卷

### 背景

某电商平台使用 PostgreSQL 12 作为订单数据库，日均事务量约 500 万笔。运维团队在部署时为了"减少 I/O 开销"，将 `autovacuum` 设置为 `off`，并计划手动定期执行 VACUUM。

### 事故经过

1. **部署后 3 个月**：由于业务增长，事务量从 500 万/天增长到 800 万/天
2. **部署后约 10 个月**：事务 ID 年龄达到约 20 亿，数据库发出告警，但告警邮件被误判为垃圾邮件
3. **第 11 个月某天凌晨 2 点**：事务 ID 年龄超过 2^31，PostgreSQL 拒绝所有新连接，订单系统全面瘫痪
4. **紧急处理**：运维人员以单用户模式对 800GB 的订单表执行 VACUUM FREEZE，耗时 **7 小时**
5. **业务损失**：系统中断 9 小时，损失订单约 12 万笔，直接经济损失约 300 万元

### 教训

```ini
# 错误配置（事故现场）
autovacuum = off

# 正确配置
autovacuum = on
autovacuum_vacuum_scale_factor = 0.05
autovacuum_analyze_scale_factor = 0.02
autovacuum_vacuum_cost_delay = 2ms
autovacuum_freeze_max_age = 200000000
```

**核心教训**：`autovacuum` 是 PostgreSQL 的"生命线"，绝不能关闭。如果担心 I/O 开销，应该调低 `autovacuum_vacuum_cost_delay` 来降低优先级，而不是直接关闭。
