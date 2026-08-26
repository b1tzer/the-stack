# Undo Log

## 1. 作用

- 事务回滚
- MVCC 多版本并发控制

## 2. 类型

| 类型 | 说明 |
|------|------|
| insert undo | INSERT 产生，事务结束直接删除 |
| update undo | UPDATE/DELETE 产生，purge 线程清理 |

## 3. MVCC 实现

```
记录隐藏列：
- DB_TRX_ID: 最后修改的事务ID
- DB_ROLL_PTR: 指向 Undo Log 的指针

版本链：
当前记录 → Undo Log v3 → Undo Log v2 → Undo Log v1
```

## 4. Read View

```sql
-- 读已提交：每次 SELECT 创建新的 Read View
-- 可重复读：事务第一次 SELECT 创建 Read View，后续复用
```

Read View 包含：
- m_ids: 活跃事务ID列表
- min_trx_id: 最小活跃事务ID
- max_trx_id: 下一个分配的事务ID
- creator_trx_id: 创建者事务ID

## 5. MVCC 可见性判断算法

```
对于版本链中的每个版本（由 DB_TRX_ID 标识）：

1. 如果 DB_TRX_ID == creator_trx_id → 可见（自己修改的）
2. 如果 DB_TRX_ID < min_trx_id → 可见（事务已提交，在 Read View 创建前）
3. 如果 DB_TRX_ID >= max_trx_id → 不可见（事务在 Read View 创建后开始）
4. 如果 DB_TRX_ID 在 m_ids 列表中 → 不可见（事务还在进行中）
5. 否则 → 可见（事务已提交，在 Read View 创建后提交）
```

**示例演示：**
```sql
-- 假设当前活跃事务：[101, 102]
-- Read View: {m_ids: [101,102], min_trx_id: 101, max_trx_id: 103, creator_trx_id: 100}

-- 版本链：当前值(trx_id=101) → v2(trx_id=99) → v1(trx_id=98)

-- trx_id=101: 在 m_ids 中 → 不可见
-- trx_id=99: < min_trx_id(101) → 可见 ✓
-- 结果：读到 v2 版本
```

## 6. Undo Log 的存储结构

```sql
-- MySQL 8.0 Undo 表空间
-- 默认创建 2 个 Undo 表空间：undo_001, undo_002
SHOW VARIABLES LIKE 'innodb_undo_tablespaces';  -- 默认 2

-- 查看 Undo Log 大小
SHOW VARIABLES LIKE 'innodb_max_undo_log_size';  -- 默认 1GB

-- 自动截断 Undo Log（释放空间）
SHOW VARIABLES LIKE 'innodb_undo_log_truncate';  -- 默认 ON
```

**Undo Log 页结构：**
```
┌──────────────────┐
│ Undo Log Header  │  元信息
├──────────────────┤
│ Undo Log Record  │  回滚指针、修改前数据
├──────────────────┤
│ Undo Log Record  │  ...
├──────────────────┤
│ Free Space       │
└──────────────────┘
```

## 7. Purge 线程

Purge 线程负责清理不再需要的 Undo Log。

```sql
-- 查看 Purge 线程状态
SHOW VARIABLES LIKE 'innodb_purge_threads';  -- 默认 4
SHOW VARIABLES LIKE 'innodb_max_purge_lag';  -- Purge 延迟阈值

-- 当 Purge 落后时，DML 操作会被限流
-- 延迟超过 innodb_max_purge_lag 时，每次 DML 都会等待
```

**Purge 条件：**
- Undo Log 对应的事务已经提交
- 没有任何活跃的 Read View 需要访问该版本
- 对于 insert undo，事务结束后即可清理

## 8. 最佳实践

1. **避免长事务** — 长事务导致 Undo Log 无法清理，占用大量空间
2. **监控 Undo 空间** — `SHOW GLOBAL STATUS LIKE 'Innodb_undo%';`
3. **合理设置隔离级别** — READ COMMITTED 下 Read View 创建更频繁，但 Undo 清理更及时
4. **监控 Purge 延迟** — Purge 落后会导致 Undo 膨胀
5. **大批量删除分批执行** — 避免单事务产生过多 Undo Log

