---
doc_id: pg-locking
title: 锁机制
---

# 锁机制

> **核心问题**：PostgreSQL 有哪些锁类型？如何分析锁等待？如何避免死锁？

## 1. 表级锁

| 锁模式 | 典型触发语句 | 与自身冲突 | 说明 |
| :-- | :-- | :-- | :-- |
| `ACCESS SHARE` | SELECT | ❌ | 最弱的锁，只与 ACCESS EXCLUSIVE 冲突 |
| `ROW SHARE` | SELECT FOR UPDATE | ❌ | |
| `ROW EXCLUSIVE` | INSERT/UPDATE/DELETE | ❌ | |
| `SHARE` | CREATE INDEX | ✅ | 阻塞写操作 |
| `ACCESS EXCLUSIVE` | ALTER TABLE / DROP TABLE | ✅ | 最强的锁，阻塞一切操作 |

> **与 MySQL 的区别**：PG 的表级锁更细粒度，有 8 种模式；MySQL 的表锁只有读锁和写锁两种。

## 2. 行级锁

```sql
-- FOR UPDATE：排他行锁
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;

-- FOR SHARE：共享行锁
SELECT * FROM accounts WHERE id = 1 FOR SHARE;

-- FOR NO KEY UPDATE：弱排他锁（PG 独有）
SELECT * FROM accounts WHERE id = 1 FOR NO KEY UPDATE;

-- FOR KEY SHARE：最弱的行锁（PG 独有）
SELECT * FROM accounts WHERE id = 1 FOR KEY SHARE;
```

| 行锁模式 | 阻塞 FOR UPDATE | 阻塞 FOR NO KEY UPDATE | 阻塞 FOR SHARE | 阻塞 FOR KEY SHARE |
| :-- | :-- | :-- | :-- | :-- |
| FOR UPDATE | ✅ | ✅ | ✅ | ✅ |
| FOR NO KEY UPDATE | ✅ | ✅ | ✅ | ❌ |
| FOR SHARE | ✅ | ✅ | ❌ | ❌ |
| FOR KEY SHARE | ✅ | ❌ | ❌ | ❌ |

> **PG 独有的优势**：`FOR NO KEY UPDATE` 和 `FOR KEY SHARE` 是 PG 特有的细粒度行锁。外键检查使用 `FOR KEY SHARE`，不会阻塞 `FOR NO KEY UPDATE`，大幅减少了外键场景下的锁冲突。

## 3. NOWAIT 和 SKIP LOCKED

```sql
-- NOWAIT：获取不到锁时立即报错
SELECT * FROM tasks WHERE status = 'pending' FOR UPDATE NOWAIT;

-- SKIP LOCKED：跳过已被锁定的行（适合任务队列场景）
SELECT * FROM tasks WHERE status = 'pending' 
ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
```

> **实战场景**：`SKIP LOCKED` 非常适合用 PG 实现简单的任务队列——多个消费者并发获取任务时，自动跳过已被锁定的任务，无需额外的消息队列中间件。

## 4. 锁等待分析

```sql
-- 查看所有锁等待关系
SELECT
    blocked.pid AS blocked_pid,
    blocked.query AS blocked_query,
    blocking.pid AS blocking_pid,
    blocking.query AS blocking_query,
    now() - blocked.query_start AS wait_duration
FROM pg_stat_activity blocked
JOIN pg_locks bl ON bl.pid = blocked.pid AND NOT bl.granted
JOIN pg_locks kl ON kl.locktype = bl.locktype
    AND kl.database IS NOT DISTINCT FROM bl.database
    AND kl.relation IS NOT DISTINCT FROM bl.relation
    AND kl.pid != bl.pid AND kl.granted
JOIN pg_stat_activity blocking ON blocking.pid = kl.pid
ORDER BY wait_duration DESC;
```

## 5. 锁超时设置

```sql
-- 设置锁等待超时
SET lock_timeout = '5s';

-- 在事务中设置
BEGIN;
SET LOCAL lock_timeout = '10s';
ALTER TABLE users ADD COLUMN nickname VARCHAR(50);
COMMIT;
```

## 6. 死锁检测与处理

PG 内置死锁检测器，默认每秒检测一次（`deadlock_timeout = 1s`）。

### 6.1 避免死锁的实践

1. **固定加锁顺序**：多个事务操作相同的表/行时，按固定顺序加锁
2. **缩短事务时间**：减少锁持有时间
3. **使用 NOWAIT**：获取不到锁时立即失败，而非等待
4. **设置 lock_timeout**：`SET lock_timeout = '5s'`，超时自动放弃

## 7. DDL 锁策略

```sql
-- 使用 lock_timeout 控制 DDL 等待时间
SET lock_timeout = '3s';
ALTER TABLE users ADD COLUMN nickname VARCHAR(50);
-- 超过 3 秒获取不到锁就报错
```

哪些 DDL 操作会获取 ACCESS EXCLUSIVE 锁：ALTER TABLE（大多数操作）、DROP TABLE、TRUNCATE、VACUUM FULL、REINDEX。

## 8. 常见问题

**Q：SKIP LOCKED 有什么用？**

> `SKIP LOCKED` 跳过已被其他事务锁定的行，非常适合用 PG 实现简单的任务队列。多个消费者并发获取任务时，自动跳过已被锁定的任务，无需额外的消息队列中间件。
