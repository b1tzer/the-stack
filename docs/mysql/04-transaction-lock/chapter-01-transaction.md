# 事务与 MVCC

> 事务 A 在 `REPEATABLE READ` 下第一次 `SELECT` 读到余额 500；事务 B 随后把余额改成 1000 并提交；事务 A 再次 `SELECT`，读到的还是 500。整个过程 InnoDB 没有加任何锁，A 凭什么「假装」这行数据从未变过？答案不在锁里，在 MVCC 的版本链里。

## 1. 事务与隔离级别

### 1.1 从一个「读到旧值」的现象说起

先建立一个具体场景。表 `accounts` 只有一行：

```sql
CREATE TABLE accounts (
    id      INT PRIMARY KEY,
    balance INT
) ENGINE = InnoDB;

INSERT INTO accounts VALUES (1, 500);
```

两个事务按下面的时序交错执行，隔离级别是 InnoDB 默认的 `REPEATABLE READ`：

```text
时间轴        事务 A                             事务 B
────────────────────────────────────────────────────────────
T1          BEGIN;
T2          SELECT balance;  -- 读到 500
T3                                              BEGIN;
T4                                              UPDATE accounts
                                                 SET balance = 1000
                                                 WHERE id = 1;
T5                                              COMMIT;
T6          SELECT balance;  -- 仍读到 500
T7          COMMIT;
```

事务 B 在 T4 已经改了数据，在 T5 已经提交，T6 时刻数据库里 `id=1` 这一行的「最新值」就是 1000。但事务 A 两次读到的都是 500。

这不是 bug，而是 `REPEATABLE READ` 承诺的行为：**一个事务内，多次读取同一数据，结果一致**。要理解 InnoDB 如何在不加锁的情况下做到这一点，需要先回答「事务到底向应用程序承诺了什么」。

### 1.2 事务的四个承诺：ACID

事务是一组要么全部成功、要么全部不做的操作。它向调用方承诺四件事：

| 特性 | 承诺 | 由谁保证 |
| :-- | :-- | :-- |
| **Atomicity** 原子性 | 要么全做，要么全不做 | Undo Log |
| **Consistency** 一致性 | 事务前后数据都满足业务约束 | 应用层 + 其余三者 |
| **Isolation** 隔离性 | 并发事务互不干扰 | MVCC + 锁 |
| **Durability** 持久性 | 提交后不丢失 | Redo Log |

四个承诺里，`Isolation` 是最难实现也最容易出问题的。它要回答的问题是：**当两个事务同时读写同一份数据时，彼此能看到对方的哪些中间状态？**

数据库给这个问题划了四个档位，就是隔离级别。

### 1.3 隔离级别：并发事务的四种可见性约定

在讲隔离级别之前，先定义三个「读到了不该读的东西」的现象，它们是衡量隔离级别高低的尺子。

**脏读（Dirty Read）**：读到了另一个事务**尚未提交**的修改。如果那个事务随后回滚，读到的就是一份「从未存在过」的数据。

**不可重复读（Non-Repeatable Read）**：同一事务内两次读同一行，读到了不同的值——因为中间另一个事务**提交了对这行的修改**。

**幻读（Phantom Read）**：同一事务内两次用相同条件查询，结果集的**行数**变了——因为中间另一个事务**插入或删除了**满足条件的行。

四个隔离级别对这三个现象的容忍程度：

| 隔离级别 | 脏读 | 不可重复读 | 幻读 |
| :-- | :--: | :--: | :--: |
| `READ UNCOMMITTED` | 可能 | 可能 | 可能 |
| `READ COMMITTED` | 不可能 | 可能 | 可能 |
| `REPEATABLE READ` | 不可能 | 不可能 | InnoDB 下基本不可能 |
| `SERIALIZABLE` | 不可能 | 不可能 | 不可能 |

隔离级别越往下，并发度越高，但一致性越弱。InnoDB 默认是 `REPEATABLE READ`——比 SQL 标准要求的默认档（`READ COMMITTED`）高一级，这也正是它能额外解决幻读的原因。

```sql
-- 查看当前隔离级别
SELECT @@transaction_isolation;  -- MySQL 8.0+
SELECT @@tx_isolation;           -- MySQL 5.7（已废弃）

-- 修改隔离级别
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

::: warning 版本锚点
MySQL 5.7 用 `tx_isolation` 查询隔离级别，MySQL 8.0 起更名为 `transaction_isolation`。
:::

`READ UNCOMMITTED` 到 `READ COMMITTED` 之间，靠「读已提交的版本」就能区分；但 `READ COMMITTED` 到 `REPEATABLE READ` 之间的那一步，靠锁已经不够了——锁只能挡住「正在改」，挡不住「改完提交了」。要挡住后者，必须让事务读到的不再是「数据库的最新状态」，而是「事务开始时的那份快照」。这正是 MVCC 要解决的事。

## 2. MVCC 的数据基础

### 2.1 无锁读：MVCC 的基本思路

MVCC（Multi-Version Concurrency Control，多版本并发控制）的核心思路只有一句话：**写不覆盖读，读不阻塞写**。

传统的做法是读加共享锁、写加排他锁，读写互斥，代价是读会阻塞写、写会阻塞读。MVCC 换了一条路：**每行数据保留多个历史版本，读操作不去抢锁，而是根据事务开始的时间，从版本链里挑一个「当时可见」的版本出来读。**

这样做的直接收益是：

- 普通的 `SELECT` 不需要加锁，也不被写操作阻塞；
- 写操作不需要等读操作结束，只和别的写操作抢行锁。

代价是：历史版本要占用额外空间，且需要后台线程（Purge）在合适的时机把它们清理掉。

理解 MVCC，就是理解三件事：**一行数据里藏了什么**、**旧版本怎么串成链**、**Read View 怎么判定一个版本可不可见**。下面依次展开。

### 2.2 一行数据里藏了什么：三个隐藏列

InnoDB 的聚簇索引里，每一行记录除了你定义的列，还额外带着三个隐藏列：

```text
┌─────────────┬──────────────────────────────────────┐
│ 用户列       │  id, balance, ...                     │
├─────────────┼──────────────────────────────────────┤
│ DB_ROW_ID   │  6 字节，行 ID。表有主键时用主键代替   │
│ DB_TRX_ID   │  6 字节，最后修改这行的事务 ID         │
│ DB_ROLL_PTR │  7 字节，回滚指针，指向旧版本          │
└─────────────┴──────────────────────────────────────┘
```

三个隐藏列里，真正支撑 MVCC 的是后两个：

- **`DB_TRX_ID`**：记录「是哪个事务最后修改了这行」。事务 ID 在事务首次写操作时分配，单调递增。它让每个版本都能标注自己的「作者」。
- **`DB_ROLL_PTR`**：指向 Undo Log 中「修改前的旧版本」。正是这个指针，把同一行数据的多个历史版本串成了一条链。

`DB_ROW_ID` 只在表没有主键、也没有非空唯一索引时，才充当隐藏主键，与 MVCC 无关。

### 2.3 版本链：Undo Log 串起来的旧版本

回到开头的场景。初始插入 `(1, 500)` 时，这行记录只有当前版本，`DB_ROLL_PTR` 为空。

事务 B 执行 `UPDATE accounts SET balance = 1000 WHERE id = 1`，InnoDB 做了两件事：

1. 把「修改前的旧值 500」连同旧 `DB_TRX_ID`，写进 Undo Log；
2. 在聚簇索引上原地更新 `balance=1000`，并把 `DB_TRX_ID` 改成事务 B 的 ID，把 `DB_ROLL_PTR` 指向刚写入的 Undo 记录。

于是这行数据变成了：

```text
当前记录（在聚簇索引上）
  balance     = 1000
  DB_TRX_ID   = 102          ← 事务 B
  DB_ROLL_PTR ──────┐
                    ▼
Undo 记录（旧版本）
  balance     = 500
  DB_TRX_ID   = 101          ← 最初插入时的事务
  DB_ROLL_PTR = 空
```

每发生一次修改，Undo Log 就多一节，`DB_ROLL_PTR` 继续往前指。多次修改后，形成一条从当前版本一直通到最老版本的链：

```text
当前记录 → Undo v3 → Undo v2 → Undo v1
(trx=105)  (trx=104) (trx=102) (trx=101)
```

这条链就叫**版本链**。它完整记录了这行数据「从老到新」的每一次变化。Undo Log 的存储细节与 Purge 清理机制见 [Undo Log](../02-innodb-internals/chapter-05-undo-log.md)，这里只需记住：**版本链是 MVCC 的数据基础，DB_ROLL_PTR 是串起这条链的线。**

版本链搭好了，剩下的问题就是：事务 A 做快照读时，站在这条链的哪一节往回看，才能看到「事务开始那一刻」的状态？这个「往回看到哪」的标尺，就是 Read View。

## 3. Read View 与可见性判定

### 3.1 Read View：一次快照读的「时间标尺」

Read View 是一份「快照读可见性判定」的上下文。每次快照读，InnoDB 都会用它来决定版本链上的每个版本「当前事务看不看得见」。

一个 Read View 记录四个值：

| 字段 | 含义 |
| :-- | :-- |
| `creator_trx_id` | 创建这个 Read View 的事务自身的 ID |
| `m_ids` | 创建时刻，系统中**活跃（未提交）事务**的 ID 集合 |
| `min_trx_id` | `m_ids` 里的最小值 |
| `max_trx_id` | 创建时刻，系统**下一个即将分配**的事务 ID |

后三个字段描述的是同一个事实：**Read View 诞生的那一刻，整个数据库里哪些事务还没提交、哪些已经提交。** 其中 `max_trx_id` 不是「活跃事务的最大值」，而是「预分配的下一个 ID」，所以所有 `>= max_trx_id` 的事务，都一定是在 Read View 创建**之后**才开始（或尚未开始）的。

::: info 📖 源码术语对照
`min_trx_id` 在 InnoDB 源码里叫 `m_up_limit_id`（低水位），`max_trx_id` 叫 `m_low_limit_id`（高水位）。含义是：ID 低于低水位的事务一定已提交，ID 不低于高水位的事务一定还没开始。阅读源码或八股文时遇到这两个名字，对应到这里即可。
:::

### 3.2 可见性判断：一条记录怎么决定「看不看得见」

有了 Read View，就能回答 MVCC 的核心问题。对版本链上的某个版本，记它的 `DB_TRX_ID` 为 `trx_id`，判定规则如下：

1. `trx_id == creator_trx_id` → **可见**。自己改的，当然看得到。
2. `trx_id < min_trx_id` → **可见**。该版本在 Read View 创建前就已提交。
3. `trx_id >= max_trx_id` → **不可见**。该版本在 Read View 创建后才开始。
4. `trx_id` 在 `m_ids` 中 → **不可见**。该版本的事务在 Read View 创建时还没提交。
5. 其余情况（`min_trx_id <= trx_id < max_trx_id` 且不在 `m_ids`）→ **可见**。该事务在 Read View 创建时已经提交。

规则 2 和 3 是快速判断的捷径，规则 4 才是「拦住未提交事务」的关键。如果当前版本不可见，就沿 `DB_ROLL_PTR` 往旧版本走，逐级用同样规则判断，直到找到一个可见的版本。

用开头的场景把这条规则完整走一遍。事务 A 在 T2 第一次 `SELECT` 时创建 Read View，假设那一刻：

- 事务 A 自己的 ID = 101；
- 活跃事务只有 A 自己，`m_ids = {101}`；
- 于是 `min_trx_id = 101`；
- 系统下一个将分配 `max_trx_id = 103`。

T6 事务 A 第二次 `SELECT`，版本链此刻是：

```text
当前记录（聚簇索引）         Undo 旧版本
  balance     = 1000          balance     = 500
  DB_TRX_ID   = 102           DB_TRX_ID   = 101
  DB_ROLL_PTR ──────────────▶ DB_ROLL_PTR = 空
```

判定开始。先看当前版本的 `trx_id = 102`：

1. `102 != 101`，跳过规则 1；
2. `102 < min_trx_id(101)` 不成立，跳过规则 2；
3. `102 >= max_trx_id(103)` 不成立，跳过规则 3；
4. `102` 在不在 `m_ids {101}` 里？不在。规则 4 也拦不住它；
5. 落到规则 5 → 判定为**可见**？

等等——这条规则走下来，当前版本居然可见？那不是应该读到 1000 吗？问题出在 Read View 的创建时机上。上面假设 Read View 是在 T2 创建的，而事务 B 的 ID=102 是**之后**才分配的，`max_trx_id` 却是 103——它把事务 B 也「包」了进来，规则 3 拦不住 102。

这暴露了一个必须澄清的点：**`REPEATABLE READ` 下，事务 A 整个生命周期只有一个 Read View，而它是在 T2 第一次快照读时才创建的。** 真实的时序是：T2 创建 Read View 时，事务 B 还没开始，系统下一个将分配的 ID 是 102（不是 103）。于是 `max_trx_id = 102`，事务 B 后来拿到的 ID 正好是 102，满足规则 3 的 `102 >= 102`，被判定为**不可见**。

重新走一遍正确的判定：

```text
Read View（T2 创建，事务 A 复用）：
  creator_trx_id = 101
  m_ids          = {101}
  min_trx_id     = 101
  max_trx_id     = 102          ← 此时系统下一个将分配的 ID

版本链判定（T6）：
当前版本 trx_id=102：
  102 == 101？否 → 102 < 101？否 → 102 >= 102？是 → 不可见
  沿 DB_ROLL_PTR 走到旧版本

旧版本 trx_id=101：
  101 == creator_trx_id(101)？是 → 可见 ✓
  读到 balance = 500
```

事务 A 读到 500，与开头观察一致。**这一段「102 >= 102 所以不可见」的推演，正是 MVCC 最容易出错、也最该讲清的地方**：`max_trx_id` 必须取「Read View 创建时刻」的下一个 ID，而不是事后全局的某个大数。理解了它，才真正理解为什么 RR 能挡住「另一个事务提交后的修改」。

### 3.3 RR 与 RC 的分水岭：Read View 何时生成

`REPEATABLE READ` 和 `READ COMMITTED` 用的是同一套可见性规则，区别只在一件事：**Read View 什么时候创建、创建几次。**

| 隔离级别 | Read View 生成时机 | 效果 |
| :-- | :-- | :-- |
| `REPEATABLE READ` | 事务**第一次快照读**时创建，整个事务复用 | 事务内看到的是同一份「开始时的快照」 |
| `READ COMMITTED` | **每次快照读**都重新创建 | 每次读都能看到「当时已提交的最新数据」 |

回到开头的场景，如果隔离级别改成 `READ COMMITTED`，事务 A 在 T6 那次 `SELECT` 会**重新**创建一个 Read View。此时事务 B 已经提交，不再是活跃事务，新的 `m_ids` 里没有 102，`min_trx_id` 也大于 102。判定当前版本时，规则 2 命中（`102 < min_trx_id`）→ 可见，读到 1000。这就是「不可重复读」——两次读到了不同值。

同一个版本链，同一个判定算法，只因为 Read View 的生成时机不同，就得到了 RR 和 RC 两种截然不同的行为。这是理解隔离级别差异的最关键一环。

## 4. 当前读、幻读与长事务

### 4.1 当前读 vs 快照读：MVCC 管不了的写

MVCC 只管「读」，而且是「不加锁的普通读」。但并非所有读都走 MVCC：

```sql
-- 快照读（一致性非锁定读）：普通 SELECT，走 MVCC，不加锁
SELECT * FROM accounts WHERE id = 1;

-- 当前读（锁定读）：读「最新已提交版本」并加锁，不走 MVCC 的可见性判定
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;
SELECT * FROM accounts WHERE id = 1 LOCK IN SHARE MODE;
-- 以及 INSERT / UPDATE / DELETE，它们本质上都先做一次当前读
```

当前读绕过 Read View，直接读最新版本，并加上行锁。原因在于：**写操作必须基于「最新的真实状态」来写**，否则两个事务基于同一份旧快照做 `balance = balance - 100`，就会互相覆盖对方的修改。锁在这里负责的，正是 MVCC 不负责的「写-写冲突」。

::: tip 一句区分
快照读回答「我该看到哪个历史版本」，靠 Read View 判定；当前读回答「我能不能动这行数据」，靠行锁。行锁的三种算法（Record / Gap / Next-Key Lock）见 [锁机制](./chapter-02-lock.md)。
:::

### 4.2 幻读：RR 下真的解决了吗

`REPEATABLE READ` 号称解决了幻读，实际是**分两条路径**解决的：

- **快照读路径**：整个事务复用同一个 Read View，后插入的行 `trx_id >= max_trx_id`，天然不可见，所以读不到幻影行；
- **当前读路径**：靠 `Next-Key Lock` 锁住「记录 + 间隙」，阻止别的并发事务往查询范围内插入新行。间隙锁细节见 [锁机制](./chapter-02-lock.md) §1.2。

但 RR 并未 100% 消灭幻读。一个经典残留场景是：事务先做一次快照读，再对同一范围做当前读。快照读没锁任何东西，别的会话可以在这中间插入新行；随后的 `SELECT ... FOR UPDATE` 走当前读，会读到那条新插入的行——于是「快照读没看到、当前读看到了」，从结果集行数变化的角度看，幻读仍在。

```sql
-- 事务 A（RR）
BEGIN;
SELECT * FROM accounts WHERE id > 0;        -- 快照读：没锁，假设读到 1 行
-- 此刻事务 B 插入一行并提交
SELECT * FROM accounts WHERE id > 0 FOR UPDATE;  -- 当前读：读到 2 行，出现幻影行
```

结论是：**RR 消除了「纯快照读」和「纯当前读」两种路径下的幻读，但无法消除「快照读与当前读混用」时的幻读。** 业务上需要在事务内既读又写同一范围时，要么全程用当前读，要么接受这个边界。

### 4.3 长事务的代价：Undo Log 为什么清不掉

版本链上的旧版本不能无限保留，Purge 线程会在「不再被任何 Read View 需要」时清理它们。判断标准是：**只要还存在一个 Read View，其 `min_trx_id` 小于等于某旧版本的 `trx_id`，这个版本就可能还被某个事务看见，不能删。**

因此，一个长时间不提交的事务，等于长期持有一个「很早创建的 Read View」：

- 它的 `min_trx_id` 停在很久以前，导致它之后产生的**所有** Undo 旧版本都无法被 Purge；
- Undo Log 持续膨胀，占用磁盘；
- 版本链越来越长，快照读要沿链走更多步才能找到可见版本，查询变慢；
- 若事务还持有行锁，会进一步阻塞其他事务。

排查长事务：

```sql
SELECT
    trx_id,
    trx_state,
    trx_started,
    TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS duration_sec,
    trx_rows_modified,
    trx_query
FROM information_schema.innodb_trx
ORDER BY trx_started ASC;
```

看到 `duration_sec` 很大的事务，就是 Undo 膨胀和锁等待的潜在源头。

## 5. 最佳实践

1. **默认用 `REPEATABLE READ`**：InnoDB 的默认值，兼顾一致性与并发。
2. **高并发读场景可考虑 `READ COMMITTED`**：Read View 每次重建，Purge 更及时，且 RC 下行锁更少（无间隙锁），见 [锁机制](./chapter-02-lock.md)。
3. **避免长事务**：事务里不做 RPC、HTTP、人工等待等外部调用；配合 `innodb_lock_wait_timeout` 兜底。
4. **事务尽量小**：只包裹真正需要原子性的 DML，缩短 Read View 与锁的存活时间。
5. **写操作用当前读、只读用快照读**：明确两者的边界，避免混用导致幻读。
