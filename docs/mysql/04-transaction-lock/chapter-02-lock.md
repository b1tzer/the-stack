# 锁机制

## 1. 锁类型

| 锁 | 粒度 | 说明 |
|----|------|------|
| 全局锁 | 库 | FTWRL，全库只读 |
| 表锁 | 表 | LOCK TABLES t WRITE/READ |
| 元数据锁 | 表 | DML 自动加，DDL 冲突 |
| 行锁 | 行 | InnoDB 特有 |

## 2. 行锁类型

| 锁 | 说明 |
|----|------|
| Record Lock | 锁定索引记录 |
| Gap Lock | 锁定索引记录之间的间隙 |
| Next-Key Lock | Record Lock + Gap Lock（默认） |
| Insert Intention Lock | 插入意向锁 |

## 3. 加锁规则

```sql
-- 等值查询唯一索引，命中 → Record Lock
-- 等值查询唯一索引，未命中 → Gap Lock
-- 等值查询非唯一索引 → Next-Key Lock + Gap Lock
-- 范围查询 → Next-Key Lock
```

## 4. 查看锁

```sql
-- 查看锁等待
SELECT * FROM performance_schema.data_lock_waits;

-- 查看锁信息
SELECT * FROM performance_schema.data_locks;

-- 杀死阻塞
KILL <thread_id>;
```

## 5. 加锁规则详解（RR 隔离级别）

```
规则 1：等值查询唯一索引，命中 → Record Lock
规则 2：等值查询唯一索引，未命中 → Gap Lock
规则 3：等值查询非唯一索引 → Next-Key Lock + Gap Lock
规则 4：范围查询 → Next-Key Lock
规则 5：普通查询（无索引）→ 锁全表所有记录
```

**示例：**
```sql
-- 假设表 t 有主键 id 和索引 idx_age，数据：id=(1,5,10,15), age=(10,20,30,40)

-- 规则 1：等值查询唯一索引命中
BEGIN;
SELECT * FROM t WHERE id = 5 FOR UPDATE;  -- Record Lock on id=5

-- 规则 2：等值查询唯一索引未命中
BEGIN;
SELECT * FROM t WHERE id = 7 FOR UPDATE;  -- Gap Lock on (5,10)

-- 规则 3：等值查询非唯一索引
BEGIN;
SELECT * FROM t WHERE age = 20 FOR UPDATE;  -- Next-Key Lock on (10,20] + Gap Lock on (20,30)

-- 规则 4：范围查询
BEGIN;
SELECT * FROM t WHERE age >= 20 AND age < 35 FOR UPDATE;
-- Next-Key Lock on (10,20], (20,30], (30,40]
```

## 6. 元数据锁 (MDL)

MDL 在访问表时自动加锁，防止 DDL 和 DML 冲突。

```sql
-- DML 操作自动加 MDL 读锁
SELECT * FROM users;  -- 自动加 MDL_SHARED_READ

-- DDL 操作需要 MDL 写锁
ALTER TABLE users ADD COLUMN age INT;  -- 需要 MDL_EXCLUSIVE

-- 查看 MDL 锁
SELECT * FROM performance_schema.metadata_locks;

-- MDL 锁等待导致的阻塞
-- 场景：长查询阻塞 DDL，DDL 阻塞后续所有查询
-- 解决：kill 长查询或使用 pt-online-schema-change
```

## 7. 意向锁

意向锁是表级锁，用于表明事务即将在表中的某些行上加行锁。

```
意向共享锁 (IS)：事务打算在行上加 S 锁
意向排他锁 (IX)：事务打算在行上加 X 锁

兼容矩阵：
        IS    IX    S     X
IS      ✅    ✅    ✅    ❌
IX      ✅    ✅    ❌    ❌
S       ✅    ❌    ✅    ❌
X       ❌    ❌    ❌    ❌

作用：快速判断表级锁与行级锁是否冲突
```

## 8. 锁监控实战

```sql
-- 查看当前所有锁
SELECT
    r.trx_id AS waiting_trx_id,
    r.trx_mysql_thread_id AS waiting_thread,
    r.trx_query AS waiting_query,
    b.trx_id AS blocking_trx_id,
    b.trx_mysql_thread_id AS blocking_thread,
    b.trx_query AS blocking_query
FROM performance_schema.data_lock_waits w
JOIN information_schema.innodb_trx r ON w.REQUESTING_ENGINE_TRANSACTION_ID = r.trx_id
JOIN information_schema.innodb_trx b ON w.BLOCKING_ENGINE_TRANSACTION_ID = b.trx_id;

-- 查看详细的锁信息
SELECT
    ENGINE_TRANSACTION_ID,
    OBJECT_NAME,
    INDEX_NAME,
    LOCK_TYPE,
    LOCK_MODE,
    LOCK_STATUS,
    LOCK_DATA
FROM performance_schema.data_locks
WHERE OBJECT_SCHEMA = 'mydb';

-- 杀死阻塞线程
KILL <blocking_thread_id>;
```

## 9. 最佳实践

1. **尽量使用索引查询** — 避免锁升级为表锁
2. **缩短事务持有锁的时间** — 快进快出
3. **固定加锁顺序** — 避免死锁
4. **监控锁等待** — 使用 `performance_schema.data_lock_waits`
5. **避免大事务** — 分批处理减少锁范围
6. **合理选择隔离级别** — RC 下只有 Record Lock，无 Gap Lock

