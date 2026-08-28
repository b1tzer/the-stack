---
doc_id: pg-lock-troubleshooting
title: 锁等待排查与解决
---

# 锁等待排查与解决

> **核心问题**：PostgreSQL 中一个持锁事务可以阻塞成百上千个后续请求，导致连接池耗尽、应用超时甚至服务雪崩。快速定位和解决锁等待是 DBA 的核心技能。

## 1. 常见锁等待场景

### DDL 锁表

```sql
-- ALTER TABLE 会获取 ACCESS EXCLUSIVE 锁，阻塞所有其他操作
ALTER TABLE orders ADD COLUMN remark VARCHAR(500);
-- 在大表上执行可能需要数分钟，期间所有 SELECT/INSERT/UPDATE/DELETE 都被阻塞
```

### 长事务持有锁

```sql
-- 会话 1：开启事务并更新一行
BEGIN;
UPDATE orders SET status = 'processing' WHERE id = 12345;
-- 忘记提交，或者在等用户输入...

-- 会话 2：尝试更新同一行 → 被阻塞
UPDATE orders SET status = 'shipped' WHERE id = 12345;
-- 等待中...

-- 会话 3：尝试查询该行（默认不阻塞，但如果用了 SELECT FOR UPDATE 也会等）
SELECT * FROM orders WHERE id = 12345 FOR UPDATE;
-- 等待中...
```

### 死锁

```sql
-- 会话 1：先锁 A 再锁 B
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;  -- 锁 account 1
UPDATE accounts SET balance = balance + 100 WHERE id = 2;  -- 等待 account 2

-- 会话 2：先锁 B 再锁 A
BEGIN;
UPDATE accounts SET balance = balance - 50 WHERE id = 2;   -- 锁 account 2
UPDATE accounts SET balance = balance + 50 WHERE id = 1;   -- 等待 account 1 → 死锁！
```

## 2. 锁等待查询 SQL

### 核心查询：pg_locks + pg_stat_activity 联查

```sql
-- 查看当前所有锁等待关系
SELECT
    blocked_locks.pid     AS blocked_pid,
    blocked_activity.usename  AS blocked_user,
    blocked_activity.query    AS blocked_query,
    blocking_locks.pid    AS blocking_pid,
    blocking_activity.usename AS blocking_user,
    blocking_activity.query   AS blocking_query,
    blocked_activity.application_name AS blocked_app,
    now() - blocked_activity.xact_start AS blocked_duration,
    now() - blocking_activity.xact_start AS blocking_duration
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity
    ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks
    ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
    AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
    AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
    AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
    AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
    AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
    AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
    AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
    AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity
    ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

### 简化版：快速查看阻塞链

```sql
-- 快速查看谁阻塞了谁
SELECT
    blocked.pid AS blocked_pid,
    blocked.query AS blocked_query,
    blocking.pid AS blocking_pid,
    blocking.query AS blocking_query,
    now() - blocking.xact_start AS blocking_duration
FROM pg_stat_activity blocked
JOIN pg_locks bl ON bl.pid = blocked.pid AND NOT bl.granted
JOIN pg_locks gl ON gl.locktype = bl.locktype
    AND gl.database IS NOT DISTINCT FROM bl.database
    AND gl.relation IS NOT DISTINCT FROM bl.relation
    AND gl.page IS NOT DISTINCT FROM bl.page
    AND gl.tuple IS NOT DISTINCT FROM bl.tuple
    AND gl.transactionid IS NOT DISTINCT FROM bl.transactionid
    AND gl.pid != bl.pid
    AND gl.granted
JOIN pg_stat_activity blocking ON blocking.pid = gl.pid;
```

## 3. 阻塞进程分析

```sql
-- 查看持锁进程的详细信息
SELECT
    pid,
    usename,
    application_name,
    client_addr,
    state,
    wait_event_type,
    wait_event,
    now() - xact_start AS xact_duration,
    now() - query_start AS query_duration,
    now() - state_change AS state_duration,
    query,
    backend_type
FROM pg_stat_activity
WHERE pid IN (
    SELECT DISTINCT pid FROM pg_locks WHERE NOT granted
    UNION
    SELECT DISTINCT pid FROM pg_locks WHERE granted
      AND locktype = 'transactionid'
)
ORDER BY xact_duration DESC;
```

```sql
-- 查看特定表上的锁
SELECT
    l.pid,
    l.locktype,
    l.mode,
    l.granted,
    a.usename,
    a.query,
    a.state
FROM pg_locks l
JOIN pg_stat_activity a ON a.pid = l.pid
WHERE l.relation = 'orders'::regclass
ORDER BY l.granted, l.pid;
```

## 4. 终止阻塞进程

```sql
-- 温和方式：取消当前查询（事务继续持有锁）
SELECT pg_cancel_backend(blocking_pid);

-- 强制方式：终止整个会话（回滚事务，释放所有锁）
SELECT pg_terminate_backend(blocking_pid);

-- 终止所有持有 orders 表锁超过 5 分钟的进程
SELECT pg_terminate_backend(pid)
FROM pg_locks l
JOIN pg_stat_activity a ON a.pid = l.pid
WHERE l.relation = 'orders'::regclass
  AND l.granted
  AND l.mode = 'RowExclusiveLock'
  AND now() - a.xact_start > interval '5 minutes';
```

**pg_cancel_backend vs pg_terminate_backend**：
- `pg_cancel_backend`：取消当前 SQL，事务仍然活跃，锁仍然持有
- `pg_terminate_backend`：断开连接，回滚事务，释放所有锁

## 5. DDL 锁的坑

### ALTER TABLE 的锁行为

```sql
-- 以下是 ACCESS EXCLUSIVE 锁（最严格），会阻塞一切操作：
ALTER TABLE orders ADD COLUMN remark VARCHAR(500);
ALTER TABLE orders DROP COLUMN old_field;
ALTER TABLE orders ALTER COLUMN status TYPE VARCHAR(50);
ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id);

-- 这些操作只需较低级别的锁：
ALTER TABLE orders ADD COLUMN remark VARCHAR(500) DEFAULT NULL;  -- PG 11+ 优化，不重写表
CREATE INDEX CONCURRENTLY idx_orders_user ON orders(user_id);    -- 不阻塞 DML
```

### 安全执行 DDL 的最佳实践

```sql
-- 1. 使用 CONCURRENTLY 避免锁表
CREATE INDEX CONCURRENTLY idx_orders_user ON orders(user_id);
REINDEX INDEX CONCURRENTLY idx_orders_user;

-- 2. 先检查是否有长事务
SELECT pid, now() - xact_start AS duration, query
FROM pg_stat_activity
WHERE state != 'idle' AND xact_start IS NOT NULL
ORDER BY duration DESC;

-- 3. 设置 DDL 锁超时（避免无限等待）
SET lock_timeout = '5s';
ALTER TABLE orders ADD COLUMN remark VARCHAR(500);
-- 如果 5 秒内拿不到锁，会报错而不是无限等待

-- 4. PG 11+ 的 ADD COLUMN 不重写表（DEFAULT 为常量时）
ALTER TABLE orders ADD COLUMN remark VARCHAR(500) DEFAULT '';  -- 快速完成
ALTER TABLE orders ADD COLUMN remark VARCHAR(500);             -- 也是安全的
```

## 6. 死锁分析与预防

### PostgreSQL 自动死锁检测

PostgreSQL 会自动检测死锁并终止其中一个事务。死锁信息记录在日志中：

```
ERROR: deadlock detected
DETAIL: Process 12345 waits for ShareLock on transaction 67890; blocked by process 67890.
Process 67890 waits for ShareLock on transaction 12345; blocked by process 12345.
HINT: See server log for query details.
```

### 预防死锁

```java
// 1. 统一加锁顺序（最重要！）
// 错误：不同事务以不同顺序锁定资源
// 事务 1：锁 A → 锁 B
// 事务 2：锁 B → 锁 A → 死锁！

// 正确：所有事务按 ID 升序加锁
// 事务 1：锁 A → 锁 B
// 事务 2：锁 A → 锁 B → 等待，不死锁
List<Long> ids = Arrays.asList(id1, id2);
Collections.sort(ids);  // 排序后按顺序加锁
for (Long id : ids) {
    updateAccount(id, amount);
}
```

```sql
-- 2. 使用 SELECT ... FOR UPDATE NOWAIT（拿不到锁立即失败）
BEGIN;
SELECT * FROM orders WHERE id = 12345 FOR UPDATE NOWAIT;
-- 如果锁被占用，立即抛出异常，而不是无限等待

-- 3. 使用 SELECT ... FOR UPDATE SKIP LOCKED（跳过已锁行，适合队列场景）
SELECT * FROM task_queue WHERE status = 'pending'
ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
```

## 7. 锁监控告警设计

```sql
-- 创建锁监控视图
CREATE OR REPLACE VIEW v_lock_monitor AS
SELECT
    blocked.pid AS blocked_pid,
    blocked.usename AS blocked_user,
    blocked.query AS blocked_query,
    blocking.pid AS blocking_pid,
    blocking.usename AS blocking_user,
    blocking.query AS blocking_query,
    extract(epoch FROM now() - blocking.xact_start)::int AS blocking_seconds,
    blocked.application_name AS blocked_app
FROM pg_stat_activity blocked
JOIN pg_locks bl ON bl.pid = blocked.pid AND NOT bl.granted
JOIN pg_locks gl ON gl.locktype = bl.locktype
    AND gl.database IS NOT DISTINCT FROM bl.database
    AND gl.relation IS NOT DISTINCT FROM bl.relation
    AND gl.page IS NOT DISTINCT FROM bl.page
    AND gl.tuple IS NOT DISTINCT FROM bl.tuple
    AND gl.transactionid IS NOT DISTINCT FROM bl.transactionid
    AND gl.pid != bl.pid AND gl.granted
JOIN pg_stat_activity blocking ON blocking.pid = gl.pid;
```

```bash
#!/bin/bash
# 锁监控脚本（每 30 秒执行一次）
# 当阻塞超过 60 秒时告警

LOCK_COUNT=$(psql -t -c "
SELECT count(*) FROM v_lock_monitor WHERE blocking_seconds > 60;
")

if [ "$LOCK_COUNT" -gt 0 ]; then
    DETAILS=$(psql -c "SELECT * FROM v_lock_monitor WHERE blocking_seconds > 60;")
    # 发送告警（邮件/钉钉/企微）
    echo "检测到 $LOCK_COUNT 个锁等待超过 60 秒" | mail -s "PostgreSQL 锁告警" dba@company.com
fi
```

```ini
# 记录死锁信息到日志
# postgresql.conf
log_lock_waits = on
deadlock_timeout = '1s'
```

## 8. 真实案例

### 背景

某金融系统的转账接口在高峰期频繁超时。应用日志显示大量 `LockTimeoutException`。

### 排查过程

```sql
-- 1. 发现大量锁等待
SELECT count(*) FROM pg_locks WHERE NOT granted;
-- 结果：47 个会话在等待锁

-- 2. 找到阻塞源头
SELECT * FROM v_lock_monitor ORDER BY blocking_seconds DESC;
-- blocking_pid: 28451
-- blocking_query: SELECT * FROM accounts WHERE id = 1001 FOR UPDATE
-- blocking_seconds: 3600（已阻塞 1 小时！）

-- 3. 查看阻塞进程详情
SELECT pid, state, xact_start, query, application_name
FROM pg_stat_activity WHERE pid = 28451;
-- state: idle in transaction
-- 该进程持锁但处于空闲状态，说明应用代码获取锁后没有提交也没有回滚
```

### 根因

Java 应用中一个转账方法使用了 `SELECT FOR UPDATE`，但在获取锁之后、执行 UPDATE 之前调用了外部支付网关（HTTP 请求）。支付网关响应超时（30s），应用虽然 catch 了异常，但**忘记回滚事务**，导致数据库连接被归还到连接池时仍然持有锁。

```java
// 问题代码
@Transactional
public void transfer(Long fromId, Long toId, BigDecimal amount) {
    Account from = accountRepository.findByIdForUpdate(fromId);  // 持有行锁
    // 调用外部支付网关
    paymentGateway.charge(fromId, amount);  // 超时抛异常
    // @Transactional 只在方法正常返回时回滚
    // 但这里 catch 了异常后继续执行，事务没有回滚！
    accountRepository.debit(fromId, amount);
    accountRepository.credit(toId, amount);
}
```

### 修复

```java
// 修复：确保异常时回滚
@Transactional(rollbackFor = Exception.class)
public void transfer(Long fromId, Long toId, BigDecimal amount) {
    Account from = accountRepository.findByIdForUpdate(fromId);
    try {
        paymentGateway.charge(fromId, amount);
    } catch (Exception e) {
        throw new TransferException("支付失败", e);  // 抛出触发回滚
    }
    accountRepository.debit(fromId, amount);
    accountRepository.credit(toId, amount);
}
```

```ini
# 数据库层防护
idle_in_transaction_session_timeout = '30s'  -- 空闲事务 30 秒后自动终止
lock_timeout = '10s'                          -- 获取锁超时 10 秒
```

**核心教训**：
1. 使用 `@Transactional(rollbackFor = Exception.class)` 确保异常回滚
2. 不要在持有数据库锁时调用外部服务
3. 设置 `idle_in_transaction_session_timeout` 作为安全网
4. 定期监控 `v_lock_monitor`，及时发现持锁异常的会话
