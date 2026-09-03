# 锁机制

> 一条 `SELECT * FROM t WHERE id = 7 FOR UPDATE`，表里根本没有 `id=7` 这一行，却能阻塞住别人 `INSERT id=8`。锁住的不是一条存在的记录，而是记录之间的「空隙」。InnoDB 的行锁，锁的其实是**索引**，而不是行。

## 1. 锁的层次与加锁对象

### 1.1 从一个「查不存在的行却锁住了」的现象说起

先建一张表：

```sql
CREATE TABLE t (
    id   INT PRIMARY KEY,
    age  INT,
    KEY idx_age (age)
) ENGINE = InnoDB;

INSERT INTO t VALUES (1, 10), (5, 20), (10, 30), (15, 40);
```

主键 `id` 上是 1、5、10、15 四条记录。会话 A 执行：

```sql
BEGIN;
SELECT * FROM t WHERE id = 7 FOR UPDATE;
```

`id=7` 根本不存在，这条查询返回空集。但此刻会话 B 执行 `INSERT INTO t VALUES (8, 25)`，会被**阻塞**；而 `INSERT INTO t VALUES (16, 50)` 却能正常执行。

为什么一条「查不到任何行」的语句，能锁住别人插入 `id=8`？答案是：**它锁住了 5 和 10 之间的那个「间隙」**，而 8 恰好落在里面；16 落在 15 之后，不在锁的范围内。

这就是 InnoDB 行锁最反直觉、也最核心的地方。要理解它，先看锁是怎么按粒度分层的。

### 1.2 锁粒度：从全局锁到行锁

MySQL 的锁按作用范围从大到小分四层：

| 锁 | 粒度 | 说明 |
| :-- | :-- | :-- |
| **全局锁** | 整个库 | `FLUSH TABLES WITH READ LOCK`，全库只读，用于全库备份 |
| **表锁** | 单表 | `LOCK TABLES t WRITE`，粒度粗，并发差 |
| **元数据锁**（MDL） | 单表 | DML 自动加读锁，DDL 加写锁，防止表结构并发变更 |
| **行锁** | 单行 | InnoDB 特有，粒度最细，并发最高 |

粒度越细，并发越高，但实现越复杂、开销越大。InnoDB 选择了行锁，这是它比 MyISAM 更适合高并发的根本原因之一。前两层（全局锁、表锁）是 Server 层提供的，行锁才是 InnoDB 存储引擎自己的能力。

### 1.3 行锁锁的不是「行」，是「索引记录」

理解 InnoDB 锁机制，先建立一条核心认知：

> InnoDB 的「行锁」，本质是加在**索引记录（index record）上的锁**。

一张 InnoDB 表通常挂着多个索引：

- 主键索引（PRIMARY KEY / Clustered Index）
- 普通二级索引（Secondary Index）
- 唯一索引（UNIQUE INDEX）

所以「锁住一行」不是给数据行本身加锁，而是给这一行对应的索引记录加锁。InnoDB 按 SQL 实际走过的路径，对命中的索引记录加锁。

```sql
-- 走主键：锁 `PRIMARY` 中 `id = 1` 的索引记录
SELECT * FROM users WHERE id = 1 FOR UPDATE;

-- 走二级索引：先锁 `idx_name` 中 `name = '张三'` 的记录，再回溯聚簇索引加锁
SELECT * FROM users WHERE name = '张三' FOR UPDATE;
```

这条认知引出一个高频踩坑结论：**查询若走不上任何索引，InnoDB 只能全表扫描，锁住主键索引上的所有记录——效果等同于锁全表。**

```sql
-- 表 t 有主键 id，但 age 无索引
BEGIN;
SELECT * FROM t WHERE age = 30 FOR UPDATE;  -- 全表扫描，锁住所有主键记录
-- 任何对 t 的写入都会被阻塞，包括毫不相干的行
```

因此，「给查询条件列建索引」不只是性能优化，也是**缩小锁范围**的关键手段。锁覆盖多少行，取决于查询实际走了哪条索引。

## 2. 行锁算法与加锁规则

### 2.1 三种行锁算法

InnoDB 的行锁分三种算法，粒度依次扩大：

| 锁 | 锁什么 | 作用 |
| :-- | :-- | :-- |
| **Record Lock** | 单条索引记录 | 锁住「已经存在的那一条」 |
| **Gap Lock** | 索引记录之间的间隙 | 锁住「还不存在的插入空间」 |
| **Next-Key Lock** | Record + Gap | 锁住记录及其前面的间隙 |

用开头的表（主键 1、5、10、15）来直观理解：

```txt
      Gap       Gap       Gap       Gap      Gap
  ┌─────────┬─────────┬─────────┬─────────┬─────────┐
  │         │         │         │         │         │
-∞         1         5         10        15       +∞
  │         │         │         │         │         │
  └─────────┴─────────┴─────────┴─────────┴─────────┘
      Record    Record    Record    Record
```

- **Record Lock** 锁住 `5` 这一个点：别的会话不能再改 `id=5`，但可以在它前后插入。
- **Gap Lock** 锁住 `(5, 10)` 这个开区间：别的会话不能往这个区间插入任何值，但已有的 5 和 10 仍可修改。
- **Next-Key Lock** 是 `(5, 10]`——锁住间隙 `(5,10)` 加记录 `10` 本身。它是 Record 和 Gap 的合体。

InnoDB 默认使用 **Next-Key Lock**。为什么默认用最「重」的这一种？因为它能同时解决两个问题：Record Lock 解决「不可重复读」，Gap Lock 解决「幻读」。下一节展开。

### 2.2 为什么需要 Gap Lock：幻读的代价 {#gap-lock}

回忆 [事务与 MVCC §4.2](./chapter-01-transaction.md#phantom-read) 的结论：快照读靠 Read View 解决幻读，而**当前读**（`FOR UPDATE` / `LOCK IN SHARE MODE` / DML）靠锁解决幻读。

只锁已存在的记录（Record Lock）挡不住幻读：事务 A `SELECT * FROM t WHERE id > 8 FOR UPDATE` 锁住了 10、15，但没锁住 `(15, +∞)` 这个间隙，事务 B 仍可 `INSERT id=16`。A 再查一次，多出一行——幻读。

Gap Lock 就是为此而生：**锁住间隙，禁止插入，从源头上掐断「多出新的行」。**

但 Gap Lock 有代价：

- 锁的是「一段范围」，粒度比单条记录大，并发度下降；
- 不同事务可以同时持有**同一个间隙**的 Gap Lock（Gap Lock 之间不互斥），但都会阻塞插入这个间隙的意向；
- 它只在 `REPEATABLE READ` 及以上才启用（见 §2.6）。

### 2.3 加锁规则：一条决策路径

在 `REPEATABLE READ` 下，一条 `SELECT ... FOR UPDATE` 到底锁什么，取决于三件事：**查询是等值还是范围、走的是唯一索引还是非唯一索引、命中了记录没有。** 归纳为一条决策路径：

```txt
查询类型
├── 等值查询
│   ├── 走唯一索引
│   │   ├── 命中    → Record Lock（锁该条记录）
│   │   └── 未命中  → Gap Lock（锁所在间隙）
│   └── 走非唯一索引 → 命中的每条记录加 Next-Key Lock，并锁下一个间隙
├── 范围查询        → Next-Key Lock（锁住扫描经过的每个区间）
└── 无索引（全表扫描）→ 锁主键索引所有记录（等效锁全表）
```

用开头的表逐一验证。主键 `id` 是唯一索引，`idx_age` 是非唯一索引（age 有 10、20、30、40 四个值）：

```sql
-- ① 等值 + 唯一索引 + 命中：Record Lock on id=5
SELECT * FROM t WHERE id = 5 FOR UPDATE;

-- ② 等值 + 唯一索引 + 未命中：Gap Lock on (5,10)
SELECT * FROM t WHERE id = 7 FOR UPDATE;

-- ③ 等值 + 非唯一索引：age=20 的 Next-Key Lock on (10,20] + Gap Lock on (20,30)
SELECT * FROM t WHERE age = 20 FOR UPDATE;

-- ④ 范围查询：age >= 20 AND age < 35 锁 (10,20]、(20,30]、(30,40]
SELECT * FROM t WHERE age >= 20 AND age < 35 FOR UPDATE;
```

③ 值得多说一句：非唯一索引上 `age=20` 的记录可能有多条（本例只有一条），且别人**还可能再插入一条 `age=20`**。所以 InnoDB 锁住 `(10, 20]` 防止改已有记录，再锁 `(20, 30)` 防止别人插入新的 `age=20`——否则等值查询的「不可重复读」会变成「查出多行」。

### 2.4 唯一索引为什么能退化为 Record Lock

②③ 的差异背后是一条普适逻辑：**Gap Lock 存在的唯一理由是「防止插入新值破坏查询结果」。** 一旦某个值在唯一索引下「查得到」，它就绝不会再被插出第二行，间隙锁就失去了意义。

所以等值查询走**唯一索引**且**命中**时，InnoDB 只加 Record Lock，不加 Gap Lock——这是唯一索引场景的锁退化，也是它比非唯一索引「锁得更少、并发更高」的原因。

### 2.5 插入意向锁：间隙锁的「排队号」

Gap Lock 禁止往间隙插入，但多个事务都想往**同一个间隙**插入不同的值呢？它们互相不冲突，应该都能成功。InnoDB 用 **Insert Intention Lock** 协调这件事：

```txt
事务 A 和 B 都往 (5,10) 插入，但插入的值不同（A 插 6，B 插 7）
→ 两者都在 (5,10) 上持有插入意向锁，互不阻塞，各自成功

但若事务 C 持有 (5,10) 的 Gap Lock
→ A、B 的插入意向锁与 C 的 Gap Lock 冲突，A、B 都要等
```

插入意向锁的作用，可以理解为「声明我想往这个间隙插入」——同类声明互不冲突，但遇到真正锁住间隙的 Gap Lock 就会排队。它解释了「为什么锁间隙能挡住插入」的底层细节。

### 2.6 RC 与 RR 的锁差异

锁的行为与隔离级别强相关，最关键的一条：

| 隔离级别 | Gap Lock | 幻读 |
| :-- | :-- | :-- |
| `READ COMMITTED` | **不加** | 当前读可能出现幻读 |
| `REPEATABLE READ` | 加 | 当前读也防幻读 |

`READ COMMITTED` 下没有 Gap Lock（有例外：外键约束检查等场景仍会短暂加），锁的范围更小，并发更高，但代价是当前读无法防幻读。这就是 [事务与 MVCC §5](./chapter-01-transaction.md#best-practices) 提到「高并发读场景可考虑 RC」的锁层面的依据——**RC 牺牲幻读防护，换来更小的锁范围和更高的并发。**

## 3. 表级锁与锁监控

### 3.1 元数据锁（MDL）与意向锁

行锁之外，还有两类表级锁与它配合。

**元数据锁（MDL）**：Server 层自动管理，防止 DML 与 DDL 并发修改表结构。普通 `SELECT` 加 MDL 读锁，`ALTER TABLE` 需要 MDL 写锁。它和 InnoDB 的行锁是两套独立机制，但造成的阻塞现象相似：

```sql
-- 场景：长查询持有 MDL 读锁不释放
-- → ALTER TABLE 等 MDL 写锁
-- → ALTER 之后的其它查询等 MDL 读锁（被 ALTER 卡住）
-- 现象：一条 ALTER 卡住整张表的所有读写
-- 解决：kill 长查询，或用 pt-online-schema-change
```

**意向锁（Intention Lock）**：表级锁，解决「加表锁前要不要遍历所有行检查有没有行锁」的效率问题。事务要对某行加 X 锁前，先在表上加 IX 锁；这样别人要加表锁时，看一眼表上有没有 IX 就知道「表里有行锁」，无需逐行扫描。

```txt
兼容矩阵（行 × 列）：
        IS    IX    S     X
IS      ✅    ✅    ✅    ❌
IX      ✅    ✅    ❌    ❌
S       ✅    ❌    ✅    ❌
X       ❌    ❌    ❌    ❌
```

### 3.2 锁监控实战

发生锁等待时，用 `performance_schema` 定位阻塞链：

```sql
-- 谁在等、谁阻塞
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

-- 当前持有的锁明细（LOCK_TYPE 区分 RECORD / GAP）
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
```

`LOCK_TYPE = RECORD` 的锁里，`LOCK_MODE` 会标注 `GAP`（间隙锁）、`REC_NOT_GAP`（纯记录锁）或不带后缀（Next-Key Lock），配合 `LOCK_DATA` 的区间值，可以还原出「到底锁了哪段范围」。

## 4. 最佳实践

1. **查询走索引**：无索引等于锁全表，是锁冲突最常见的根因。
2. **缩短事务持锁时间**：锁在事务提交才释放，事务里的 RPC、慢计算越少越好。
3. **固定加锁顺序**：多个事务访问多张表/多行时保持相同顺序，降低死锁概率。
4. **高并发读多写少可考虑 RC**：去掉 Gap Lock，显著缩小锁范围。
5. **监控锁等待**：`performance_schema.data_lock_waits` 是定位阻塞链的第一入口。
