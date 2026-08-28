---
doc_id: pg-mvcc
title: MVCC 多版本并发控制
---

# MVCC 多版本并发控制

> **核心问题**：PostgreSQL 的 MVCC 是如何实现的？与 MySQL 有什么区别？为什么会产生表膨胀？

## 1. 它解决了什么问题？

MVCC（多版本并发控制）让**读操作不加锁**，通过保存数据的多个历史版本，让读写操作互不阻塞，大幅提升并发性能。

但 PG 的 MVCC 实现会在堆表中留下旧版本行（Dead Tuple），如果不清理，表空间会持续增长——这就是**表膨胀**。

**生活类比**：图书馆（数据库）里的书（数据行）被借走（删除/更新）后，书架上留下空位（Dead Tuple）。如果不定期整理（VACUUM），空位越来越多，找书（查询）时需要跳过大量空位，效率越来越低。

## 2. MySQL vs PostgreSQL 的 MVCC 对比

![MySQL vs PostgreSQL MVCC](/pg/mvcc-compare.svg)

## 3. 隐藏字段：xmin / xmax

每一行数据都有两个隐藏字段：

| 字段 | 含义 | 作用 |
|------|------|------|
| `xmin` | 插入该行的事务 ID | 该行从哪个事务开始可见 |
| `xmax` | 删除/更新该行的事务 ID | 该行从哪个事务开始不可见 |

**更新时**：不修改原行，而是**插入新行**（新 xmin）并将旧行的 xmax 设为当前事务 ID。

**读取时**：通过当前事务的快照（Snapshot）与行的 xmin/xmax 比较，判断该版本是否对当前事务可见。

## 4. 与 MySQL 的关键差异

| 对比点 | PostgreSQL | MySQL (InnoDB) | 影响 |
|--------|-----------|----------------|------|
| 旧版本存储位置 | 堆表中（与新版本共存） | Undo Log 回滚段（独立存储） | PG 需要 VACUUM 清理，MySQL 自动回收 |
| 旧版本清理方式 | VACUUM 主动清理 | 事务提交后自动回收 | PG 有表膨胀风险，MySQL 没有 |
| 表膨胀风险 | **有**（需要 VACUUM） | 无（Undo Log 自动回收） | PG 需要监控和维护 |
| 读性能 | 无需回溯 Undo Log | 需要回溯 Undo Log 链 | 长事务下 PG 读性能更稳定 |

> **为什么 PG 选择把旧版本存在堆表中**：读操作不需要去 Undo Log 中回溯旧版本，读性能更稳定。代价是需要 VACUUM 定期清理 Dead Tuple，否则表空间持续增长。

## 5. 表膨胀

![VACUUM 流程](/pg/vacuum-flow.svg)

### 5.1 监控表膨胀

```sql
-- 查看表的 Dead Tuple 数量（监控表膨胀）
SELECT 
    schemaname,
    tablename,
    n_live_tup AS 活跃行数,
    n_dead_tup AS 死亡行数,
    ROUND(n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) * 100, 2) AS 死亡比例,
    last_vacuum,
    last_autovacuum
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;
```

## 6. 长事务阻塞 VACUUM

> **重要**：长事务是表膨胀的主要原因之一。VACUUM 不能清理比最老活跃事务更新的 Dead Tuple，因为这些旧版本可能还需要被长事务读取。

![长事务阻塞 VACUUM](/pg/long-transaction.svg)

### 6.1 排查长事务

```sql
-- 查看是否有长事务阻塞 VACUUM
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active' 
  AND now() - pg_stat_activity.query_start > interval '5 minutes'
ORDER BY duration DESC;
```

### 6.2 解决方案

1. 监控 `pg_stat_activity`，及时发现并终止长事务
2. 业务层设置合理的事务超时：`SET statement_timeout = '30s'`
3. 避免在事务中做耗时操作（如调用外部接口）

## 7. 事务 ID 回卷（XID Wraparound）

> **致命问题**：这是 PG 最严重的生产事故之一，处理不当会导致数据库自动关机保护，极端情况下可能丢数据。

### 7.1 原理

PG 的事务 ID 是 32 位无符号整数，范围约 42 亿。当事务 ID 达到最大值后会**回卷**到 0，导致新事务的 ID 比旧事务还小，MVCC 的可见性判断彻底失效。

PG 的防护机制：当事务 ID 年龄接近 2^31 时，**强制关闭数据库**，阻止一切写操作。

```
事务 ID 图示：
... → 2147483646 → 2147483647 → ⚠️ 触发强制 VACUUM FREEZE
```

### 7.2 监控事务 ID 年龄

```sql
-- 查看数据库的事务 ID 年龄（正常 < 2 亿，告警阈值 5 亿）
SELECT
    datname,
    age(datfrozenxid) AS xid_age,
    2^31 - age(datfrozenxid) AS remaining_before_wraparound
FROM pg_database
ORDER BY xid_age DESC;

-- 查看表的事务 ID 年龄（找出年龄最大的表）
SELECT
    relname,
    age(relfrozenxid) AS xid_age,
    pg_size_pretty(pg_total_relation_size(oid)) AS size
FROM pg_class
WHERE relkind = 'r'
ORDER BY xid_age DESC
LIMIT 20;
```

### 7.3 关键参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `autovacuum_freeze_max_age` | 2 亿 | 事务 ID 年龄达到此值时强制 VACUUM FREEZE |
| `vacuum_freeze_min_age` | 5000 万 | VACUUM 时，小于此年龄的事务 ID 才会被冻结 |
| `vacuum_freeze_table_age` | 1.5 亿 | 超过此值时 VACUUM 会扫描全表而非仅扫描有 Dead Tuple 的页面 |
| `vacuum_failsafe_age` | 16 亿 | PG 14+，超过此值时 VACUUM 跳过 IO 节流，全力冻结 |

### 7.4 紧急处理

```sql
-- 当事务 ID 年龄 > 5 亿时，立即执行
VACUUM FREEZE your_table;

-- 如果是整个数据库的问题
vacuumdb --freeze --all

-- 如果数据库已强制关闭，只能用单用户模式修复
postgres --single -D /var/lib/postgresql/16/main your_db
> VACUUM;
```

### 7.5 预防措施

1. **确保 autovacuum 正常运行**（不要关闭！）
2. **监控事务 ID 年龄**（Prometheus 告警阈值：5 亿）
3. **避免长事务**（设置 `idle_in_transaction_session_timeout`）
4. **定期手动 VACUUM FREEZE**（对大表，不要等 autovacuum）

> **真实案例**：某电商关闭了 autovacuum 以“提升性能”，半年后事务 ID 回卷，数据库强制关闭，业务停摆 4 小时。

## 8. 常见问题

**Q：PG 的 MVCC 和 MySQL 的 MVCC 有什么区别？**

> PG 将旧版本行存储在堆表中，读操作无需回溯 Undo Log，读性能更稳定，但需要 VACUUM 定期清理，有表膨胀风险；MySQL 使用 Undo Log 存储旧版本，事务提交后自动回收，无表膨胀问题，但长事务下需要回溯较长的 Undo Log 链。

**Q：什么是表膨胀？如何避免？**

> PG 的 MVCC 机制在 UPDATE/DELETE 时不删除旧版本行，而是标记为 Dead Tuple。如果不及时清理，Dead Tuple 持续堆积，表文件持续增大，这就是表膨胀。避免方法：确保 autovacuum 开启；对高频更新的表降低 `autovacuum_vacuum_scale_factor`；避免长事务；定期监控 `n_dead_tup`。
