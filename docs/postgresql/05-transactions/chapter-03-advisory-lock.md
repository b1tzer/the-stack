---
doc_id: pg-advisory-lock
title: 咨询锁
---

# 咨询锁

> **核心问题**：什么是咨询锁？与普通锁有什么区别？适合什么场景？

## 1. 与普通锁的区别

| 对比项 | 普通锁（行锁/表锁） | 咨询锁（Advisory Lock） |
| :-- | :-- | :-- |
| 触发方式 | 自动（SELECT/UPDATE 等） | 手动（应用程序显式调用） |
| 锁定对象 | 表、行 | 一个整数 ID（由应用定义语义） |
| 释放时机 | 事务结束自动释放 | 会话级：手动释放或会话结束；事务级：事务结束 |
| 用途 | 保护数据一致性 | 应用层的分布式锁、防重复执行 |

## 2. 使用方式

```sql
-- 会话级咨询锁（需要手动释放）
SELECT pg_advisory_lock(12345);       -- 获取锁（阻塞等待）
SELECT pg_advisory_unlock(12345);     -- 释放锁

-- 非阻塞获取（获取不到返回 false）
SELECT pg_try_advisory_lock(12345);   -- 返回 true/false

-- 事务级咨询锁（事务结束自动释放）
BEGIN;
SELECT pg_advisory_xact_lock(12345);
-- ... 执行业务逻辑 ...
COMMIT;

-- 双参数版本（用两个整数组成锁标识）
SELECT pg_advisory_lock(100, 200);
SELECT pg_advisory_unlock(100, 200);
```

## 3. 实战场景

### 3.1 防止定时任务重复执行

```java
@Scheduled(cron = "0 0 2 * * ?")
public void dailyReport() {
    Boolean locked = jdbcTemplate.queryForObject(
        "SELECT pg_try_advisory_lock(1001)", Boolean.class);
    if (!locked) {
        log.info("其他实例正在执行，跳过");
        return;
    }
    try {
        generateReport();
    } finally {
        jdbcTemplate.execute("SELECT pg_advisory_unlock(1001)");
    }
}
```

### 3.2 用户级操作互斥

```java
public void createOrder(Long userId) {
    Boolean locked = jdbcTemplate.queryForObject(
        "SELECT pg_try_advisory_lock(?)", Boolean.class, userId);
    if (!locked) {
        throw new BusinessException("操作太频繁，请稍后重试");
    }
    try {
        orderMapper.insert(order);
    } finally {
        jdbcTemplate.execute("SELECT pg_advisory_unlock(" + userId + ")");
    }
}
```

### 3.3 防止重复处理

```sql
-- 获取任务并锁定
BEGIN;
SELECT * FROM tasks
WHERE status = 'pending'
  AND pg_try_advisory_xact_lock(id)  -- 用任务 ID 作为锁标识
ORDER BY created_at
LIMIT 1 FOR UPDATE SKIP LOCKED;
UPDATE tasks SET status = 'done' WHERE id = ?;
COMMIT;
```

### 3.4 数据库级全局锁

```sql
-- 防止同时执行数据库迁移
SELECT pg_try_advisory_lock(999999);
-- 返回 true 表示可以执行迁移
-- 迁移完成后释放
SELECT pg_advisory_unlock(999999);
```

## 4. 监控咨询锁

```sql
-- 查看当前持有的咨询锁
SELECT * FROM pg_locks WHERE locktype = 'advisory';

-- 查看咨询锁等待
SELECT
    blocked.pid,
    blocked.query,
    blocking.pid AS blocking_pid,
    blocking.query AS blocking_query
FROM pg_stat_activity blocked
JOIN pg_locks bl ON bl.pid = blocked.pid AND bl.locktype = 'advisory' AND NOT bl.granted
JOIN pg_locks kl ON kl.locktype = 'advisory' AND kl.classid = bl.classid AND kl.objid = bl.objid AND kl.granted
JOIN pg_stat_activity blocking ON blocking.pid = kl.pid;
```

## 5. 咨询锁 vs 行锁 vs Redis 分布式锁

| 对比项 | 咨询锁 | 行锁（SELECT FOR UPDATE） | Redis 分布式锁 |
| :-- | :-- | :-- | :-- |
| 锁定对象 | 整数 ID（应用定义语义） | 数据库行 | Redis key |
| 释放时机 | 手动/事务结束/连接断开 | 事务结束 | 设置过期时间 |
| 适用范围 | 单数据库 | 单数据库 | 跨数据库/跨服务 |
| 依赖组件 | 无 | 无 | 需要 Redis |
| 性能 | 极高（内存操作） | 高 | 高（网络往返） |

> **选择建议**：单数据库场景优先用咨询锁，简单高效；跨服务场景用 Redis 分布式锁；行锁用于保护数据行一致性。
