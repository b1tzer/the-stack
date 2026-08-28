---
doc_id: pg-isolation-levels
title: 事务隔离级别与 SSI
---

# 事务隔离级别与 SSI

> **核心问题**：PostgreSQL 的事务隔离级别有哪些？与 MySQL 有什么区别？SSI 是什么？

## 1. PG 支持的隔离级别

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 序列化异常 | PG 实现方式 |
|---------|------|-----------|------|-----------|------------|
| Read Uncommitted | ❌ 不会 | ✅ 会 | ✅ 会 | ✅ 会 | 实际等同于 Read Committed |
| **Read Committed（默认）** | ❌ 不会 | ✅ 会 | ✅ 会 | ✅ 会 | 每条语句获取新快照 |
| Repeatable Read | ❌ 不会 | ❌ 不会 | ❌ 不会 | ✅ 会 | 事务开始时获取快照 |
| Serializable | ❌ 不会 | ❌ 不会 | ❌ 不会 | ❌ 不会 | SSI（可序列化快照隔离） |

> **与 MySQL 的关键区别**：
> - PG 默认是 **Read Committed**，MySQL 默认是 **Repeatable Read**
> - PG 的 Read Uncommitted 实际等同于 Read Committed（PG 不允许脏读）
> - PG 的 Repeatable Read **真正防止幻读**（通过快照隔离），MySQL 的 RR 只能部分防止
> - PG 的 Serializable 基于 SSI 算法，性能远优于 MySQL 的串行化（加锁实现）

## 2. 设置隔离级别

```sql
-- 设置当前事务的隔离级别
BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
-- ... 执行操作 ...
COMMIT;

-- 设置会话级别的默认隔离级别
SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- 查看当前隔离级别
SHOW transaction_isolation;
```

## 3. SSI（Serializable Snapshot Isolation）

PG 的 Serializable 隔离级别使用 SSI 算法，而非简单的加锁：

![SSI 冲突检测](/pg/ssi-conflict.svg)

- **乐观并发控制**：不提前加锁，而是在提交时检测冲突
- **性能优势**：大多数事务不冲突时，性能接近 Read Committed
- **使用建议**：需要严格一致性的场景（如金融系统），配合重试机制处理 `serialization_failure`

```java
// 使用 Serializable 时需要重试机制
@Retryable(value = SerializationFailureException.class, maxAttempts = 3)
@Transactional(isolation = Isolation.SERIALIZABLE)
public void transferMoney(Long fromId, Long toId, BigDecimal amount) {
    accountMapper.deduct(fromId, amount);
    accountMapper.add(toId, amount);
}
```

## 4. 常见问题

**Q：PG 和 MySQL 的默认隔离级别有什么区别？**

> PG 默认 Read Committed，MySQL 默认 Repeatable Read。PG 的 RC 下每条语句获取新快照，能看到其他事务已提交的最新数据；MySQL 的 RR 下整个事务使用同一快照。

**Q：PG 的 Serializable 和 MySQL 的 Serializable 有什么区别？**

> PG 使用 SSI 算法，是乐观并发控制，不提前加锁，在提交时检测冲突，性能远优于 MySQL 的串行化（通过加锁实现）。但需要应用层处理 `serialization_failure` 异常并重试。
