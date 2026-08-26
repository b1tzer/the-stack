# 事务与 MVCC

## 1. ACID

| 特性 | 说明 |
|------|------|
| Atomicity | 原子性，Undo Log 保证 |
| Consistency | 一致性，应用层保证 |
| Isolation | 隔离性，MVCC + 锁保证 |
| Durability | 持久性，Redo Log 保证 |

## 2. 隔离级别

| 隔离级别 | 脏读 | 不可重复读 | 幻读 |
|---------|------|-----------|------|
| READ UNCOMMITTED | ✓ | ✓ | ✓ |
| READ COMMITTED | ✗ | ✓ | ✓ |
| REPEATABLE READ | ✗ | ✗ | ✗(InnoDB) |
| SERIALIZABLE | ✗ | ✗ | ✗ |

## 3. MVCC

```sql
-- 可重复读：事务第一次 SELECT 创建 Read View，后续复用
-- 读已提交：每次 SELECT 创建新的 Read View
```

## 4. 当前读 vs 快照读

```sql
-- 快照读（MVCC）
SELECT * FROM users WHERE id = 1;

-- 当前读（加锁）
SELECT * FROM users WHERE id = 1 FOR UPDATE;
SELECT * FROM users WHERE id = 1 LOCK IN SHARE MODE;
INSERT/UPDATE/DELETE
```

## 5. 隔离级别详解与配置

```sql
-- 查看当前隔离级别
SELECT @@transaction_isolation;  -- MySQL 8.0+
SELECT @@tx_isolation;           -- MySQL 5.7

-- 设置隔离级别
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET GLOBAL TRANSACTION ISOLATION LEVEL REPEATABLE READ;

-- 在 my.cnf 中配置
-- transaction_isolation = REPEATABLE-READ
```

**各隔离级别下的行为差异：**

```sql
-- READ UNCOMMITTED（读未提交）
-- 事务 A：UPDATE accounts SET balance = 1000 WHERE id = 1;（未提交）
-- 事务 B：SELECT balance FROM accounts WHERE id = 1; → 读到 1000（脏读）

-- READ COMMITTED（读已提交）
-- 事务 A：UPDATE accounts SET balance = 1000 WHERE id = 1;（未提交）
-- 事务 B：SELECT balance FROM accounts WHERE id = 1; → 读到旧值
-- 事务 A：COMMIT;
-- 事务 B：SELECT balance FROM accounts WHERE id = 1; → 读到 1000（不可重复读）

-- REPEATABLE READ（可重复读，InnoDB 默认）
-- 事务 A 开始：SELECT balance FROM accounts WHERE id = 1; → 读到 500
-- 事务 B：UPDATE accounts SET balance = 1000 WHERE id = 1; COMMIT;
-- 事务 A：SELECT balance FROM accounts WHERE id = 1; → 仍然读到 500（可重复读）
```

## 6. MVCC 实现原理

```
每行记录有 3 个隐藏列：
- DB_TRX_ID (6字节)：最后修改该行的事务 ID
- DB_ROLL_PTR (7字节)：指向 Undo Log 中旧版本的指针
- DB_ROW_ID (6字节)：隐含的自增行 ID（无主键时使用）

版本链：
当前记录 (trx_id=100) → Undo Log (trx_id=90) → Undo Log (trx_id=80)

Read View 判断：
1. 读取当前记录的 DB_TRX_ID
2. 与 Read View 中的 m_ids、min_trx_id、max_trx_id 比较
3. 判断该版本是否对当前事务可见
4. 不可见则沿版本链查找更早的版本
```

## 7. 长事务的危害

```sql
-- 查看长事务
SELECT
    trx_id,
    trx_state,
    trx_started,
    TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS duration_sec,
    trx_rows_modified,
    trx_query
FROM information_schema.innodb_trx
ORDER BY trx_started ASC;

-- 查看锁等待
SELECT
    r.trx_id AS waiting_trx,
    r.trx_query AS waiting_query,
    b.trx_id AS blocking_trx,
    b.trx_query AS blocking_query
FROM information_schema.innodb_lock_waits w
JOIN information_schema.innodb_trx r ON w.requesting_trx_id = r.trx_id
JOIN information_schema.innodb_trx b ON w.blocking_trx_id = b.trx_id;
```

**长事务的问题：**
- Undo Log 无法清理，占用大量空间
- 持有锁时间长，阻塞其他事务
- Read View 长期存在，阻止 Purge
- 回滚时间长（事务越大，回滚越慢）

## 8. 最佳实践

1. **默认使用 REPEATABLE READ** — InnoDB 默认且最安全
2. **高并发读场景可考虑 READ COMMITTED** — 减少锁冲突
3. **避免长事务** — 设置 `wait_timeout` 和 `innodb_lock_wait_timeout`
4. **事务尽量小** — 只包含必要的 DML 操作
5. **避免在事务中做 RPC/HTTP 调用** — 外部调用会延长事务时间
6. **使用 `SET MAX_EXECUTION_TIME` 限制查询时间**

