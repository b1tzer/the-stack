---
doc_id: pg-mvcc
title: MVCC 多版本并发控制
---

# MVCC 多版本并发控制

> **核心问题**：PostgreSQL 的 MVCC 是如何实现的？与 MySQL 有什么区别？为什么会产生表膨胀？

## 1. 它解决了什么问题？

在没有并发控制的数据库里，读写操作会互相阻塞——有人在写数据，其他人必须等他写完才能读。这在高并发场景下是不可接受的。

**MVCC（Multi-Version Concurrency Control，多版本并发控制）** 的核心思想是：每次修改数据时不覆盖原值，而是**保留旧版本**，让读操作看到的是某个时间点的快照。这样读和写互不阻塞，大幅提升并发性能。

但代价是：旧版本行（PG 里叫 **Dead Tuple**）会堆积在表里。如果不清理，表文件会持续膨胀，查询越来越慢。PG 把清理工作交给了 **VACUUM** 机制（下一章讲）。

**生活类比**：图书馆（数据库）里的书（数据行）被更新后，新版本放在书架上，旧版本还占着位置（Dead Tuple）。如果不定期清理旧版本，书架越来越满，找书（查询）时需要跳过大量废弃书籍，效率越来越低。

## 2. PG 的 MVCC 实现原理

### 2.1 隐藏字段：xmin / xmax

PG 不会显式地给每行打上"版本号"，而是通过两个**隐藏字段**来追踪行的生命周期：

| 隐藏字段 | 含义 | 类比 |
|---------|------|------|
| `xmin` | 创建该行的事务 ID | "这本书是哪天上架的" |
| `xmax` | 删除/更新该行的事务 ID | "这本书是哪天下架的"（0 表示还在架上） |

你可以用 `SELECT xmin, xmax, * FROM table_name` 查看这两个隐藏字段。

### 2.2 写操作：不覆盖，只追加

PG 的 UPDATE 操作不是"原地修改"，而是**两步走**：

1. **插入新行**：新行的 `xmin` = 当前事务 ID
2. **标记旧行过期**：旧行的 `xmax` = 当前事务 ID

DELETE 操作类似，只是不插入新行，只标记旧行的 `xmax`。

```
UPDATE users SET name = '李四' WHERE id = 1;

执行前：| id=1, name='张三', xmin=100, xmax=0   |  ← 活跃行
执行后：| id=1, name='张三', xmin=100, xmax=500  |  ← Dead Tuple（旧版本）
        | id=1, name='李四', xmin=500, xmax=0   |  ← 新版本
```

### 2.3 读操作：快照隔离

每个事务开始时会获取一个**快照（Snapshot）**，记录当时所有活跃事务的 ID。读数据时，通过比较行的 `xmin`/`xmax` 和快照来判断该行是否"对我可见"：

- `xmin` 已提交 且 `xmax` 为 0 → 可见（最新版本）
- `xmin` 已提交 且 `xmax` 已提交 → 不可见（已被删除/更新）
- `xmin` 是活跃事务 → 不可见（还没提交）

这就是为什么读操作**不需要加锁**——它看到的是某个时间点的一致性快照，不受其他事务的写操作影响。

## 3. 与 MySQL 的关键差异

PG 和 MySQL 都实现了 MVCC，但实现方式完全不同：

| 对比点 | PostgreSQL | MySQL (InnoDB) |
|--------|-----------|----------------|
| 旧版本存储位置 | **堆表中**（与新版本共存） | **Undo Log**（独立的回滚段） |
| 旧版本清理方式 | VACUUM 主动清理 | 事务提交后自动回收 |
| 表膨胀风险 | **有**（需要 VACUUM） | 无（Undo Log 自动回收） |
| 读性能 | 无需回溯 Undo Log，稳定 | 长事务需要回溯 Undo Log 链 |
| 长事务影响 | 阻塞 VACUUM → 表膨胀 | Undo Log 膨胀 → 占用空间 |

![MySQL vs PostgreSQL MVCC](/pg/mvcc-compare.svg)

> **为什么 PG 选择把旧版本存在堆表中？** 读操作不需要去 Undo Log 中回溯旧版本，读性能更稳定。代价是需要 VACUUM 定期清理 Dead Tuple，否则表空间持续增长。这是一个**读性能 vs 维护成本**的取舍。

## 4. 表膨胀

当 Dead Tuple 不断堆积、没有被及时清理时，表文件会持续增大，这就是**表膨胀（Table Bloat）**。

表膨胀的直接影响：
- **查询变慢**：扫描同样多的有效数据，需要读取更多的数据页
- **索引效率下降**：索引指向的页面包含大量 Dead Tuple
- **磁盘浪费**：空间被 Dead Tuple 占用，无法复用

![VACUUM 流程](/pg/vacuum-flow.svg)

### 4.1 监控表膨胀

通过 `pg_stat_user_tables` 视图可以看到每个表的 Dead Tuple 数量：

```sql
SELECT 
    schemaname,
    tablename,
    n_live_tup        AS 活跃行数,
    n_dead_tup        AS 死亡行数,
    ROUND(n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) * 100, 2) AS 死亡比例,
    last_vacuum,
    last_autovacuum
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;
```

**判断标准**：
- 死亡比例 < 5%：健康
- 死亡比例 5%~20%：需要关注
- 死亡比例 > 20%：需要立即处理

> 表膨胀的详细检测与治理方法见 [生产避坑 - 表膨胀检测与治理](/postgresql/12-production-pitfalls/chapter-02-table-bloat)。

## 5. 长事务：表膨胀的元凶

VACUUM 不能清理**所有** Dead Tuple。它必须保留比最老活跃事务更"新"的旧版本，因为长事务可能还需要读取这些数据（MVCC 的快照隔离保证）。

![长事务阻塞 VACUUM](/pg/long-transaction.svg)

```
时间线：
事务 A 开始（读取快照）────────────────────────────────────── 还在运行！
事务 B: UPDATE → 产生 Dead Tuple 1
事务 C: UPDATE → 产生 Dead Tuple 2
VACUUM: 想清理 Dead Tuple 1 和 2，但事务 A 可能还需要它们 → 只能等！
```

这就是为什么**长事务是表膨胀的主要原因**。一个开了几天没提交的事务，会阻止整个数据库的 VACUUM 清理工作。

### 5.1 排查长事务

```sql
-- 查看是否有长时间运行的事务
SELECT 
    pid,
    usename,
    now() - pg_stat_activity.query_start AS duration,
    state,
    LEFT(query, 80) AS query
FROM pg_stat_activity
WHERE state != 'idle'
  AND now() - pg_stat_activity.query_start > interval '5 minutes'
ORDER BY duration DESC;

-- 查看最老的活跃事务（这个事务决定了 VACUUM 能清理多远）
SELECT 
    pid,
    usename,
    now() - xact_start AS xact_age,
    state,
    LEFT(query, 80) AS query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start
LIMIT 5;
```

### 5.2 解决方案

1. **设置事务超时**：`SET idle_in_transaction_session_timeout = '5min'`（自动终止空闲事务）
2. **应用层控制**：事务中不要调用外部接口、不要等用户输入
3. **及时终止**：发现长事务立即 `pg_terminate_backend(pid)`
4. **监控告警**：对超过 10 分钟的活跃事务告警

## 6. 事务 ID 回卷（XID Wraparound）

> **致命问题**：这是 PG 最严重的生产事故之一。处理不当会导致数据库自动关机保护，极端情况下可能丢数据。

### 6.1 原理

PG 的事务 ID 是 32 位无符号整数，范围约 42 亿。正常情况下事务 ID 会递增，但到达最大值后会**回卷到 0**。

问题在于：MVCC 通过比较事务 ID 大小来判断行的可见性。如果新事务的 ID（比如 100）比旧事务的 ID（比如 42 亿）还小，可见性判断就会彻底错乱——旧数据可能被错误地当作"未来数据"而不可见。

PG 的防护机制：当事务 ID 年龄接近 2^31 时，**强制关闭数据库**，阻止一切写操作，要求先执行 VACUUM FREEZE 冻结旧事务 ID。

### 6.2 监控事务 ID 年龄

```sql
-- 查看数据库的事务 ID 年龄
SELECT
    datname,
    age(datfrozenxid) AS xid_age,
    2^31 - age(datfrozenxid) AS remaining
FROM pg_database
ORDER BY xid_age DESC;
```

**健康标准**：
- `xid_age` < 2 亿：正常
- `xid_age` 2~5 亿：需要关注
- `xid_age` > 5 亿：**告警，立即处理**
- `xid_age` > 10 亿：**紧急，数据库可能随时强制关闭**

### 6.3 关键参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `autovacuum_freeze_max_age` | 2 亿 | 达到此值时强制触发 VACUUM FREEZE |
| `vacuum_freeze_min_age` | 5000 万 | VACUUM 时，小于此年龄的事务 ID 才会被冻结 |
| `vacuum_freeze_table_age` | 1.5 亿 | 超过此值时 VACUUM 扫描全表 |
| `vacuum_failsafe_age` | 16 亿 | PG 14+，超过此值时跳过 IO 节流，全力冻结 |

### 6.4 紧急处理

```sql
-- 当事务 ID 年龄 > 5 亿时，立即执行
VACUUM FREEZE your_table;

-- 如果是整个数据库的问题
vacuumdb --freeze --all

-- 如果数据库已强制关闭，只能用单用户模式修复
postgres --single -D /var/lib/postgresql/16/main your_db
> VACUUM;
```

### 6.5 预防措施

1. **确保 autovacuum 正常运行**——不要关闭！
2. **监控事务 ID 年龄**——Prometheus 告警阈值设为 5 亿
3. **避免长事务**——设置 `idle_in_transaction_session_timeout`
4. **定期手动 VACUUM FREEZE**——对大表，不要等 autovacuum

> **真实案例**：某电商关闭了 autovacuum 以"提升性能"，半年后事务 ID 回卷，数据库强制关闭，业务停摆 4 小时。

## 7. 常见问题

**Q：PG 的 MVCC 和 MySQL 的 MVCC 有什么区别？**

> PG 将旧版本行存储在堆表中，读操作无需回溯 Undo Log，读性能更稳定，但需要 VACUUM 定期清理，有表膨胀风险；MySQL 使用 Undo Log 存储旧版本，事务提交后自动回收，无表膨胀问题，但长事务下需要回溯较长的 Undo Log 链。

**Q：什么是表膨胀？如何避免？**

> PG 的 MVCC 机制在 UPDATE/DELETE 时不删除旧版本行，而是标记为 Dead Tuple。如果不及时清理，Dead Tuple 持续堆积，表文件持续增大，这就是表膨胀。避免方法：确保 autovacuum 开启；对高频更新的表降低 `autovacuum_vacuum_scale_factor`；避免长事务；定期监控 `n_dead_tup`。

**Q：MVCC 和锁有什么关系？**

> MVCC 让读操作不需要加锁，但写操作之间仍然需要锁（行级排他锁）。两个事务同时更新同一行时，后到的事务会等待先到的事务提交。MVCC 解决的是**读写冲突**，锁解决的是**写写冲突**。

**Q：为什么不把旧版本也存到 Undo Log 里（像 MySQL 那样）？**

> 这是设计取舍。PG 选择把旧版本留在堆表中，好处是读操作不需要"回溯"到 Undo Log 找旧版本，读性能更稳定。坏处是需要 VACUUM 清理。MySQL 的做法反过来：读操作需要回溯 Undo Log 链，但不需要手动清理。两种方案各有优劣，没有绝对的好坏。
