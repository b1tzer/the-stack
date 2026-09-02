# Undo Log

> 一条 `DELETE` 之后立刻 `ROLLBACK`，被删的行又回来了。InnoDB 没给每张表做「删除前的备份」，它凭什么能精确撤销？凭的是一份「逆向操作」日志——Undo Log。同一份日志还顺手撑起了 MVCC 的无锁读：它同时是「回滚的依据」和「历史版本的仓库」。

## 1. Undo Log 是什么

![Undo Log 全景：逆向操作日志 + MVCC 版本链载体](/mysql/02-innodb-internals-chapter-05-undo-log.svg)

### 1.1 从一次回滚说起

先建立一个具体场景：

```sql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;  -- 500 → 400
-- ... 发现扣错了账户
ROLLBACK;
-- balance 回到 500
```

`ROLLBACK` 之后，`id=1` 的余额精确回到 500，而不是「大致回到某个旧值」。这意味着 InnoDB 在 `UPDATE` 执行的那一刻，就把「改回去需要的信息」记了下来。这份记录就是 Undo Log。

Undo Log 与 Redo Log 是两份目的相反的日志：

| 对比项 | Undo Log | Redo Log |
| :-- | :-- | :-- |
| 记录内容 | **逆向操作**（如何改回去） | **正向操作**（改了什么） |
| 逻辑/物理 | 逻辑日志 | 物理日志 |
| 服务对象 | 回滚 + MVCC | 崩溃恢复 |
| 生命周期 | 事务提交后由 Purge 延迟清理 | 循环写，固定大小 |

一句话区分：**Redo 保证「改过的不会丢」，Undo 保证「改错的能改回」。** 前者见 [Redo Log](./chapter-04-redo-log.md)，本章聚焦后者。

### 1.2 Undo Log 记录的不是数据快照，是「逆向操作」

Undo Log 是**逻辑日志**，它不复制整行数据，而是记录「如何撤销这次修改」。同样是把 `balance` 从 500 改成 400，Undo Log 记录的语义是「把这一行的 balance 加 100」，而不是「旧值是 500」。

这个区别决定了 Undo Log 的体积和用途：

- **体积小**：只记操作指令，不复制整页；
- **可回放**：回滚时执行逆向操作即可；
- **可被 MVCC 复用**：记录里保留了旧字段值，旧版本正是从这些逆向信息里重建出来的。

一条 `UPDATE` 产生的 Undo 记录，大致包含这些内容：

```text
Undo 记录（简化）
├─ undo_no         本次操作在事务内的序号
├─ 表 ID / 主键     定位到哪一行
├─ 被修改的列及旧值   balance 的旧值 500（用于回滚和 MVCC）
└─ 指向前一条 Undo   构成同事务内的 Undo 链
```

事务内连续多次修改同一行，会形成一条事务内部的 Undo 链；而不同事务对同一行的修改，则通过行记录里的 `DB_ROLL_PTR` 串成跨事务的**版本链**（见 §3.1）。

## 2. 两类 Undo 与存储位置

### 2.1 两类 Undo：insert undo 与 update undo

Undo Log 按「回滚需要做什么」分为两类，它们的清理时机完全不同：

| 类型 | 由什么操作产生 | 回滚动作 | 清理时机 |
| :-- | :-- | :-- | :-- |
| **insert undo** | `INSERT` | 删除插入的行 | 事务提交后即可清理 |
| **update undo** | `UPDATE` / `DELETE` | 把行改回旧值 | 等所有 Read View 不再需要后由 Purge 清理 |

**为什么 insert undo 能随事务结束直接删，update undo 却要等？**

关键在「这行数据对别的事务可不可见」。

- `INSERT` 插入的是**新行**。在这行插入之前，任何早于该事务开始的其他事务，都不可能通过它们的 Read View 看到这行（这行对它们是「未来」才出现的）。既然没人看见过它，回滚时直接删掉即可，也不需要为「历史版本」保留它。所以 insert undo 在事务提交后，没有其他事务需要它，可立即清理。

- `UPDATE` / `DELETE` 修改的是**已存在的行**。这行的旧值，可能正被某个并发事务的 Read View 引用（那个事务需要一个「修改前」的版本才能做到可重复读）。因此旧值必须保留，直到**所有可能看见它的 Read View 都结束**，才能删。

这就是「同一份 Undo Log，两类记录，两套生命周期」的由来。也解释了为什么频繁 `INSERT` 的表 Undo 压力小，而频繁 `UPDATE` / `DELETE` 的表 Undo 容易堆积。

### 2.2 Undo Log 存在哪里：回滚段与 Undo 表空间

Undo Log 不是独立于表空间的文件，它存放在**回滚段（Rollback Segment）**里。回滚段是 Undo 页的组织单元，一个回滚段管理一串 Undo 页链表。

MySQL 8.0 默认配置下：

```sql
-- Undo 表空间数量（默认 2 个：undo_001、undo_002）
SHOW VARIABLES LIKE 'innodb_undo_tablespaces';

-- 单个 Undo 表空间的最大大小（默认 1GB，超过会自动截断）
SHOW VARIABLES LIKE 'innodb_max_undo_log_size';

-- 是否开启 Undo 表空间自动截断（默认 ON）
SHOW VARIABLES LIKE 'innodb_undo_log_truncate';
```

::: warning 版本锚点
MySQL 5.6 之前，Undo Log 存放在系统表空间 `ibdata1` 里，无法独立回收；5.6 起可配置独立 Undo 表空间；8.0 起默认使用独立 Undo 表空间，并支持自动截断。
:::

一个 Undo 页的内部结构：

```text
┌──────────────────┐
│ Undo Page Header │  页元信息（链表指针等）
├──────────────────┤
│ Undo Record      │  一条逆向操作记录
├──────────────────┤
│ Undo Record      │  ...
├──────────────────┤
│ Free Space       │
└──────────────────┘
```

多个事务的 Undo 记录可以共享同一个回滚段、同一组 Undo 页，通过链表串起来。这里的存储细节不需要全部记住，需要理解的是：**Undo Log 占用的是独立空间，且这段空间只有在 Purge 清理后才会真正释放。**

## 3. 版本链：MVCC 的载体

### 3.1 版本链：Undo 的另一半用途

Undo Log 除了回滚，还支撑 MVCC。 [事务与 MVCC §2.3](../04-transaction-lock/chapter-01-transaction.md#version-chain) 已经详细讲过：每行记录的 `DB_ROLL_PTR` 指向 Undo 中的旧版本，多次修改串成一条从当前版本通到最老版本的链。

```text
当前记录 → Undo v3 → Undo v2 → Undo v1
(trx=105)  (trx=104) (trx=102) (trx=101)
```

快照读时，事务沿这条链，用 Read View 判定每个版本是否可见。**版本链与可见性判定的完整算法见 [事务与 MVCC §3.2](../04-transaction-lock/chapter-01-transaction.md#visibility-judgment)，本文不再重复。** 这里只强调 Undo 视角下的一个推论：

> 每一条 Undo 记录，都被两类对象「引用」——**回滚时的事务**，以及**可能看见这个旧版本的 Read View**。只有当两类引用都消失，这条 Undo 才能被 Purge 安全删除。

这个「双引用」事实，是理解下一节 Purge 时机的钥匙。

## 4. 删除、清理与膨胀

### 4.1 DELETE 是「假删除」：delete mark

`DELETE` 产生的 update undo，牵扯一个容易误解的细节：**InnoDB 的 `DELETE` 并不是立刻把行从页里抹掉**，而是先做一次**删除标记（delete mark）**——在记录头上打一个「已删除」标志，行数据仍留在原地。

真正的物理删除，要等到 Purge 阶段才执行。这样设计的原因：

1. **回滚需要**：如果事务还没提交，随时可能要 `ROLLBACK`，此时只需清除删除标记即可恢复；
2. **MVCC 需要**：其他事务的 Read View 可能还要读这行的旧版本，物理删除会让它们读不到。

所以 `DELETE` 之后磁盘空间不会立即变小，要等 Purge 真正清理，空间才释放。这是「删了数据，磁盘占用却没降」这一常见现象的根因。

### 4.2 Purge：谁来清理、何时清理

Purge 线程（一组后台线程）负责清理「不再需要」的 Undo 记录。它要判断两类 Undo 分别何时可删：

- **insert undo**：对应事务已提交即可删（原因见 §2.1）；
- **update undo**：对应事务已提交，**且**不存在任何 Read View 还需要这个旧版本。

第二条判断的执行方式是：Purge 维护一个「最老的活跃 Read View」，只要某条 update undo 的 `trx_id` 比这个最老 Read View 的 `min_trx_id` 还小（即早于所有可能看见它的读视图），就能安全清理。

```sql
-- Purge 线程数（默认 4）
SHOW VARIABLES LIKE 'innodb_purge_threads';

-- Purge 落后阈值（默认 0，表示不限制）
SHOW VARIABLES LIKE 'innodb_max_purge_lag';
```

当 Purge 追不上 Undo 的产生速度时，Undo 空间会持续膨胀。`innodb_max_purge_lag` 非 0 时，InnoDB 会在 Purge 落后超过阈值后对 DML 限流——通过让写操作「等一等 Purge」来给清理腾出时间，避免磁盘被 Undo 撑满。

### 4.3 长事务：Undo 膨胀的元凶

结合 §4.2 的清理条件，就能推出一个反直觉的结论：**一条已经提交、甚至早已结束的 update undo，可能因为一个「还没结束的长事务」而迟迟无法被 Purge。**

原因：那个长事务持有「很老」的 Read View，它的 `min_trx_id` 停在很久以前。Purge 判定时，凡是 `trx_id` 大于这个 `min_trx_id` 的 update undo 都被认为「可能被看见」，一律保留。于是：

- 长事务之后产生的所有 update undo 全部堆积；
- Undo 表空间持续增长，逼近甚至突破 `innodb_max_undo_log_size`；
- 版本链变长，快照读要走更多步才能定位可见版本，查询变慢；
- 事务本身若还持有行锁，还会连带阻塞其他事务。

排查手段与「避免长事务」的完整清单见 [事务与 MVCC §4.3](../04-transaction-lock/chapter-01-transaction.md#long-transaction)。

## 5. 最佳实践

1. **避免长事务**：这是控制 Undo 体积的第一优先级，见 §4.3。
2. **大批量删除分批执行**：把一次 `DELETE` 大量行拆成多个小事务，缩短单条 Undo 链，给 Purge 留出节奏。
3. **监控 Undo 与 Purge 状态**：`SHOW GLOBAL STATUS LIKE 'Innodb_undo%';` 观察 Undo 页数量；关注 Purge 是否落后。
4. **高并发读场景可考虑 `READ COMMITTED`**：Read View 每次重建，生命周期短，Undo 清理更及时，见 [事务与 MVCC §3.3](../04-transaction-lock/chapter-01-transaction.md#rr-rc-read-view)。
5. **理解 DELETE 的「假删除」**：删除后磁盘不立刻释放是正常现象，不必恐慌，等 Purge 处理即可。
