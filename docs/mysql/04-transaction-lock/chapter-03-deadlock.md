# 死锁

> 两个事务互相持有对方想要的锁，谁都不肯先松手。更麻烦的是：这不是「卡住一段时间再报错」那么简单——InnoDB 在毫秒级就发现了它，并主动回滚了其中一个事务。它凭什么这么短时间判断出「这两个事务已经无解了」？答案是一张在内存里实时维护的等待图，以及对它做的环检测。

## 1. 死锁的判定

### 1.1 死锁的本质：等待关系成环

死锁（Deadlock）不是「锁等待」。锁等待是单向的——事务 A 等 B 释放锁，B 迟早会释放，A 就能继续。死锁是**等待关系围成了一个环**：A 等 B，B 等 A，谁也等不到谁，系统永久停滞。

```text
单向等待（正常，可自愈）      死锁（成环，无解）
    A ──等──▶ B                 A ──等──▶ B
                                ▲         │
                                └────等────┘
```

判死锁，本质就是判断**这张等待图里有没有环**。理解了这个，后面 InnoDB 的检测算法、以及「为什么固定加锁顺序能根治死锁」就都顺理成章了。

### 1.2 一个最小死锁现场

两个事务各自改一行，再交叉改对方的行：

```sql
-- 事务 A
BEGIN;
UPDATE users SET name = 'A' WHERE id = 1;  -- 拿到 id=1 的行锁
UPDATE users SET name = 'A' WHERE id = 2;  -- 想拿 id=2，但被事务 B 持有 → 等待

-- 事务 B
BEGIN;
UPDATE users SET name = 'B' WHERE id = 2;  -- 拿到 id=2 的行锁
UPDATE users SET name = 'B' WHERE id = 1;  -- 想拿 id=1，但被事务 A 持有 → 等待
```

时序上只要 A 先拿到 id=1、B 先拿到 id=2，两个事务就会各自卡在第二条 `UPDATE` 上，形成 `A 等 B、B 等 A` 的环。这类「交叉更新两行」是最经典的死锁形态，常被简写为 ABBA。

要复现它，需要两个事务**几乎同时**执行各自的第一步。并发度一高，这个「几乎同时」就会在某次请求里撞上。

## 2. 死锁检测

### 2.1 InnoDB 怎么发现死锁：wait-for graph

InnoDB 默认不是「等锁超时后才发现」，而是**主动检测**。检测手段是一张实时维护的**等待图（wait-for graph）**：

- **节点**是每个事务；
- **有向边**从「等待锁的事务」指向「持有锁的事务」。

当一个事务 `trx_a` 因为拿不到某把锁而进入等待时，InnoDB 做两件事：

1. 在等待图中加一条边 `trx_a → trx_b`（`trx_b` 是当前持有这把锁、导致 `trx_a` 等待的事务）；
2. 沿这条边做一次**深度优先搜索（DFS）**，看从 `trx_b` 出发能不能回到 `trx_a`。

如果能回到 `trx_a`，说明等待关系成环，死锁成立。InnoDB 随即**回滚其中一个事务**，打破这个环。

```text
加边前：                加边后（A 等 B 这把锁）：
  A      B                A ──等──▶ B
                          │         │
                          └───等────┘   ← DFS 发现回到 A，判死锁
```

回滚哪个事务，遵循「代价最小」原则：选择 **undo 量最少**（改动最少）的那个事务回滚，让另一个事务继续完成。这也是为什么死锁日志里，被回滚的往往是事务里改动较少的那一个。

::: info 📖 源码对照
这套逻辑在 InnoDB 源码的 `lock_deadlock_check_and_resolve` 中实现。它遍历 `trx_sys` 里的事务锁等待关系，用深度优先搜索判环。`innodb_deadlock_detect = ON`（默认）控制是否启用这套主动检测。
:::

### 2.2 检测不是免费的

`innodb_deadlock_detect = ON` 是默认值，但它有代价：**每一次锁等待，都要做一次图搜索判环。** 当并发很高、很多事务挤在同一把锁上时，这个检测本身的 CPU 开销会显著上升——想象 1000 个事务同时等一把热锁，每来一个等待就要在 1000 个节点的图里跑一次 DFS。

这也是某些高并发场景会**主动关闭**死锁检测的原因：

```ini
innodb_deadlock_detect = OFF      # 关闭主动检测
innodb_lock_wait_timeout = 50     # 改为靠「锁等待超时」兜底
```

关闭后，死锁不再被毫秒级发现，而是等到 `innodb_lock_wait_timeout`（默认 50 秒）超时，由超时机制强制中断。这样牺牲了「死锁发现速度」，换来了「省掉每次等待的判环开销」。这是一种权衡：只有当「判环开销」确实成为瓶颈时，才值得放弃主动检测。

## 3. 典型场景与日志

### 3.1 三类典型死锁场景

死锁的形态千变万化，但根因都可归入「等待关系成环」。下面三类覆盖了线上绝大多数情况。

**场景 1：批量更新顺序不一致**

两个事务批量更新同一批 id，但顺序不同：

```sql
-- 事务 A：按 3 → 1 → 5 的顺序加锁
BEGIN;
UPDATE orders SET status = 'paid'    WHERE id IN (3, 1, 5);

-- 事务 B：按 5 → 2 → 3 的顺序加锁
BEGIN;
UPDATE orders SET status = 'shipped' WHERE id IN (5, 2, 3);
```

A 先锁住 id=3，B 先锁住 id=5；接着 A 想要 id=5（被 B 持有），B 想要 id=3（被 A 持有），环形成。

```sql
-- ✅ 修复：两个事务按相同顺序（如主键升序）加锁
UPDATE orders SET status = 'paid'    WHERE id IN (1, 3, 5);  -- 都从 1 开始
UPDATE orders SET status = 'shipped' WHERE id IN (2, 3, 5);  -- 都从 2 开始
```

顺序一致后，两个事务在锁 id=1（或 id=2）时就会分出先后，一方先拿到、另一方等待，不会交叉成环。

**场景 2：间隙锁与插入意向锁冲突**

`REPEATABLE READ` 下的间隙锁会把锁范围从「记录」扩大到「记录之间的空隙」，这显著提高了死锁概率：

```sql
-- 表 t 有数据 id = (1, 5, 10)
-- 事务 A
BEGIN;
SELECT * FROM t WHERE id = 7 FOR UPDATE;  -- 加 Gap Lock on (5, 10)

-- 事务 B
BEGIN;
INSERT INTO t VALUES (6);  -- 想插入到 (5,10)，与 A 的 Gap Lock 冲突 → 等待

-- 事务 A
INSERT INTO t VALUES (8);  -- 想插入到 (5,10)，与 B 的插入意向锁冲突 → 死锁
```

这里的关键是：A 先锁了间隙 (5,10)，B 想往这个间隙插 6 被挡住；B 持有了插入意向锁后，A 想往同一间隙插 8 又被 B 挡住。两个插入意向锁互相冲突，环形成。

```sql
-- ✅ 修复：等值查询命中唯一索引时只加 Record Lock，不加 Gap Lock
ALTER TABLE t ADD UNIQUE INDEX idx_id(id);
```

间隙锁与插入意向锁的完整规则见 [锁机制](./chapter-02-lock.md)，这里只需记住：**RR 的间隙锁是死锁的一大来源，RC 下没有间隙锁，死锁显著减少**。

**场景 3：先共享锁后升级排他锁**

两个事务都先加了共享锁，又都想升级成排他锁：

```sql
-- 事务 A
BEGIN;
SELECT * FROM users WHERE name = '张三' FOR SHARE;   -- 加 S 锁
UPDATE users SET age = 26 WHERE name = '张三';         -- 想升级为 X 锁

-- 事务 B
BEGIN;
SELECT * FROM users WHERE name = '张三' FOR SHARE;   -- 加 S 锁
UPDATE users SET age = 27 WHERE name = '张三';         -- 想升级为 X 锁
```

S 锁和 S 锁是兼容的，所以两个事务都能先拿到 `FOR SHARE` 的 S 锁；但升级 X 锁时，X 锁和对方持有的 S 锁冲突，于是 A 等 B 释放 S、B 等 A 释放 S，成环。

```sql
-- ✅ 修复：确定要写，直接用 FOR UPDATE 拿 X 锁，避免后续升级
SELECT * FROM users WHERE name = '张三' FOR UPDATE;
```

### 3.2 死锁日志：怎么读懂现场

死锁发生后，InnoDB 会把它写进 `SHOW ENGINE INNODB STATUS` 的 `LATEST DETECTED DEADLOCK` 段落。要看历史死锁，需开启全量记录：

```sql
SET GLOBAL innodb_print_all_deadlocks = ON;  -- 所有死锁写入错误日志
```

一段典型日志的关键信息：

```text
---TRANSACTION 12345, ACTIVE 2 sec
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

读日志只看三点：

1. `(1) WAITING FOR THIS LOCK` 和 `(2) HOLDS THE LOCK(S)` 成对出现——事务 1 在等的那把锁，正是事务 2 持有的；
2. 反向的 `(2) WAITING FOR` 与 `(1) HOLDS` 也成对——事务 2 也在等事务 1 的锁，环就此坐实；
3. `RECORD LOCKS ... index PRIMARY of table ...` 标明了冲突发生在哪张表、哪个索引、哪个页。

## 4. 处理与最佳实践

### 4.1 处理策略

| 策略 | 说明 |
| :-- | :-- |
| 主动检测 | `innodb_deadlock_detect = ON`（默认），等待图 DFS 判环 |
| 超时兜底 | `innodb_lock_wait_timeout = 50`，关闭检测后由它中断 |
| 应用层重试 | 捕获死锁异常（错误码 1213），重新发起事务 |
| 固定顺序 | 所有事务按相同顺序访问资源，从根上避免成环 |
| 缩短事务 | 减少锁持有时间，降低交叉概率 |

其中「应用层重试」是必须的兜底：无论怎么预防，死锁在并发下仍可能发生，数据库只会回滚其中一个事务并返回 `1213`，被回滚的那个事务必须由应用层捕获异常后重试，否则这次业务操作就静默丢失了。

### 4.2 最佳实践

1. **固定加锁顺序**：批量操作先排序，让所有事务按同一顺序拿锁。
2. **缩短事务**：减少锁持有窗口，交叉概率随之下降。
3. **能写就直接 `FOR UPDATE`**：避免「先 S 后 X」的升级死锁。
4. **应用层捕获 1213 并重试**：死锁无法完全杜绝，重试是最后防线。
5. **评估是否关闭主动检测**：仅在「判环开销」成为高并发瓶颈时，才考虑 `innodb_deadlock_detect = OFF` + 超时兜底。
