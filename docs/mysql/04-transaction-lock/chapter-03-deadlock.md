# 死锁

## 1. 什么是死锁

两个或多个事务相互等待对方释放锁。

## 2. 死锁案例

```sql
-- 事务 A
BEGIN;
UPDATE users SET name = 'A' WHERE id = 1;  -- 锁 id=1
UPDATE users SET name = 'A' WHERE id = 2;  -- 等待 id=2

-- 事务 B
BEGIN;
UPDATE users SET name = 'B' WHERE id = 2;  -- 锁 id=2
UPDATE users SET name = 'B' WHERE id = 1;  -- 等待 id=1 → 死锁！
```

## 3. 死锁检测

```ini
innodb_deadlock_detect = ON           # 开启死锁检测
innodb_lock_wait_timeout = 50         # 锁等待超时(秒)
```

## 4. 避免策略

1. 固定加锁顺序（如按主键顺序）
2. 缩小事务范围
3. 使用低隔离级别
4. 合理设计索引，减少锁范围

```sql
-- 查看最近的死锁
SHOW ENGINE INNODB STATUS;
```

## 5. 死锁案例分析

**案例 1：批量更新顺序不一致**
```sql
-- 事务 A
BEGIN;
UPDATE orders SET status = 'paid' WHERE id IN (3, 1, 5);  -- 加锁顺序 3→1→5

-- 事务 B
BEGIN;
UPDATE orders SET status = 'shipped' WHERE id IN (5, 2, 3);  -- 加锁顺序 5→2→3
-- 如果 A 锁了 id=3，B 锁了 id=5，然后 A 等 id=5，B 等 id=3 → 死锁

-- 解决方案：按主键排序
UPDATE orders SET status = 'paid' WHERE id IN (1, 3, 5);  -- 顺序 1→3→5
UPDATE orders SET status = 'shipped' WHERE id IN (2, 3, 5);  -- 顺序 2→3→5
```

**案例 2：间隙锁冲突**
```sql
-- 表 t 有数据 id = (1, 5, 10)

-- 事务 A
BEGIN;
SELECT * FROM t WHERE id = 7 FOR UPDATE;  -- Gap Lock on (5, 10)

-- 事务 B
BEGIN;
INSERT INTO t VALUES (6);  -- 需要插入到 (5, 10) 间隙，被 Gap Lock 阻塞

-- 事务 A
INSERT INTO t VALUES (8);  -- 也需要插入到 (5, 10)，被 B 的插入意向锁阻塞 → 死锁

-- 解决方案：使用唯一索引
ALTER TABLE t ADD UNIQUE INDEX idx_id(id);
-- 等值查询命中唯一索引时只加 Record Lock，不加 Gap Lock
```

**案例 3：先读后写导致死锁**
```sql
-- 事务 A
BEGIN;
SELECT * FROM users WHERE name = '张三' FOR SHARE;  -- S 锁
UPDATE users SET age = 26 WHERE name = '张三';  -- 需要升级为 X 锁

-- 事务 B
BEGIN;
SELECT * FROM users WHERE name = '张三' FOR SHARE;  -- S 锁
UPDATE users SET age = 27 WHERE name = '张三';  -- 需要升级为 X 锁 → 死锁

-- 解决方案：直接使用 FOR UPDATE
SELECT * FROM users WHERE name = '张三' FOR UPDATE;  -- 直接 X 锁
```

## 6. 死锁日志分析

```sql
-- 查看最近一次死锁
SHOW ENGINE INNODB STATUS;  -- 在 LATEST DETECTED DEADLOCK 部分

-- 开启死锁日志记录
SET GLOBAL innodb_print_all_deadlocks = ON;  -- 所有死锁记录到错误日志
```

**死锁日志关键信息：**
```
---TRANSACTION 12345, ACTIVE 2 sec
mysql tables in use 1, locked 1
LOCK WAIT 2 lock struct(s), heap size 1136, 1 row lock(s)
MySQL thread id 10, OS thread handle 140xxx, query id 100
---TRANSACTION 12344, ACTIVE 5 sec
2 lock struct(s), heap size 1136, 1 row lock(s)

*** (1) WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 0 page no 307 n bits 72 index PRIMARY of table `mydb`.`users`

*** (2) HOLDS THE LOCK(S):
RECORD LOCKS space id 0 page no 307 n bits 72 index PRIMARY of table `mydb`.`users`

*** (2) WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 0 page no 307 n bits 72 index PRIMARY of table `mydb`.`users`
```

## 7. 死锁处理策略

| 策略 | 说明 |
|------|------|
| 自动检测 | `innodb_deadlock_detect = ON`（默认） |
| 锁等待超时 | `innodb_lock_wait_timeout = 50`（默认） |
| 应用层重试 | 捕获死锁异常（错误码 1213），重试 3 次 |
| 固定顺序 | 所有事务按相同顺序访问资源 |
| 缩短事务 | 减少锁持有时间 |

## 8. 最佳实践

1. **固定加锁顺序** — 按主键顺序访问记录
2. **尽量使用唯一索引** — 减少 Gap Lock
3. **缩短事务** — 减少锁冲突窗口
4. **应用层捕获死锁异常重试** — 错误码 1213
5. **开启死锁日志** — `innodb_print_all_deadlocks = ON`
6. **监控死锁频率** — `SHOW GLOBAL STATUS LIKE 'Innodb_deadlocks';`

