# 数据库核心原理

> 当你写下一行 `SELECT * FROM orders WHERE user_id = ?` 时，数据库内部究竟发生了什么？为什么有时候它快如闪电，有时候却慢得让人抓狂？本章从 Java 开发者的视角，拆解 SQL 的执行旅程、索引的物理本质、慢查询的诊断方法、锁的竞争模型和事务隔离的边界——理解这些，你才能写出真正"懂数据库"的代码。

## 1. SQL 执行流程

很多开发者把数据库当作黑盒：扔一句 SQL 进去，等结果出来。但当你面对性能问题时，这个黑盒必须打开。

一条 SQL 从客户端发出到结果返回，经历了四个核心阶段：

```text
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Client   │───▶│  Parser   │───▶│ Optimizer │───▶│ Executor  │───▶│  Result   │
│ (JDBC)    │    │ 语法分析   │    │ 优化器     │    │ 执行器     │    │ 结果集    │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
                  词法分析        CBO 成本估算     存储引擎调用      网络传输
                  语法树生成      执行计划选择     数据读写
                  语义校验        索引选择
```

### 1.1 Parser：语法分析

数据库收到 SQL 文本后，首先进行**词法分析**（将文本拆分为 token）和**语法分析**（构建语法树）。这一步会检查 SQL 是否符合语法规则，表名和列名是否存在。

```sql
-- 语法错误，Parser 阶段就会报错
SELECT FORM orders WHERE id = 1;
-- ERROR: syntax error at or near "FORM"
```

Parser 不关心性能，只关心对错。生成的语法树（AST）是后续优化的原材料。

### 1.2 Optimizer：优化器

优化器是数据库的"大脑"。它接收语法树，生成**执行计划**（Execution Plan）。

优化器的核心工作：

| 决策项 | 说明 | 示例 |
|--------|------|------|
| 访问方式 | 全表扫描 vs 索引扫描 | `WHERE user_id = 100` 走 `idx_user_id` |
| 连接顺序 | 多表 JOIN 时谁先谁后 | 小表驱动大表 |
| 连接算法 | Nested Loop / Hash Join / Sort Merge | InnoDB 主要用 Nested Loop |
| 排序策略 | 索引有序性 vs filesort | `ORDER BY` 能否利用索引 |

MySQL 使用**基于成本的优化器（CBO）**，它会估算每种执行计划的 I/O 和 CPU 成本，选择总成本最低的方案。这也是为什么表的统计信息（`ANALYZE TABLE`）对优化器至关重要——统计信息过时，优化器就会做出错误决策。

### 1.3 Executor：执行器

执行器按照执行计划，调用存储引擎的接口读取数据。MySQL 的架构是**插件式存储引擎**，InnoDB 是最常用的。

执行器的工作流：

```text
                    ┌─────────────────────────┐
                    │     Server Layer         │
                    │  Parser → Optimizer      │
                    └────────────┬─────────────┘
                                 │ 执行计划
                    ┌────────────▼─────────────┐
                    │     Executor              │
                    │  遍历表/索引 → 过滤 → 返回 │
                    └────────────┬─────────────┘
                                 │ 存储引擎 API
                    ┌────────────▼─────────────┐
                    │   Storage Engine          │
                    │  InnoDB: Buffer Pool      │
                    │  → 磁盘读写               │
                    └──────────────────────────┘
```

**关键点**：Server 层和存储引擎层各司其职。Server 层负责 SQL 解析、优化、执行；存储引擎层负责数据的实际存取。这也解释了为什么不同存储引擎的行为差异（如 InnoDB 支持事务，MyISAM 不支持）。

### 1.4 Java 开发者的启示

理解这个流程，对你写 Java 代码有直接指导意义：

1. **不要拼接 SQL**——Parser 阶段无法复用执行计划，PreparedStatement 可以走预编译缓存。
2. **关注执行计划**——不要猜，用 `EXPLAIN` 看。
3. **统计信息要准**——大批量导入数据后，记得跑 `ANALYZE TABLE`。

## 2. 索引为什么有效

"加索引"是解决慢查询最常见（也最被滥用）的建议。但索引到底是什么？为什么它能让查询从 O(n) 变成 O(log n)？

### 2.1 B+Tree：关系数据库的默认索引结构

几乎所有关系数据库都使用 **B+Tree** 作为默认索引结构。它不是二叉树，而是一棵**多路平衡搜索树**——每个节点可以有成百上千个子节点，这让树的高度极低。

```text
                    [10 | 20 | 30]                    ← 根节点（非叶子）
                   /     |      \
          [1|3|5|7]  [12|15|18]  [22|25|28]          ← 非叶子节点（只存键值）
          / | | \    /  |  \     /  |  \
        叶子节点      叶子节点      叶子节点              ← 叶子节点（存键值+数据指针）
        ┌──┬──┬──┐  ┌──┬──┬──┐  ┌──┬──┬──┐
        │1 │3 │5 │  │12│15│18│  │22│25│28│
        │→ │→ │→ │  │→ │→ │→ │  │→ │→ │→ │           ← 叶子节点间有双向链表
        └──┴──┴──┘  └──┴──┴──┘  └──┴──┴──┘
         ▲←────────────────────────────────→▲
              有序链表，范围查询极快
```

**B+Tree 的三个核心设计**：

| 特性 | 说明 | 性能影响 |
|------|------|----------|
| 非叶子节点只存键 | 不存数据，每个节点能容纳更多键 | 树高度低，I/O 次数少 |
| 叶子节点存完整数据 | 所有数据都在叶子层 | 查询路径长度一致，性能稳定 |
| 叶子节点形成有序链表 | 相邻叶子用指针串联 | 范围查询只需顺序遍历链表 |

**具体数据感受**：假设一个 B+Tree 节点大小为 16KB（InnoDB 默认页大小），每个索引键 8 字节 + 指针 6 字节 ≈ 14 字节，那么：

- 一个非叶子节点可存放：16384 / 14 ≈ **1170** 个键
- 两层非叶子节点可索引：1170 × 1170 ≈ **136 万**条记录
- 三层非叶子节点可索引：1170 × 1170 × 1170 ≈ **16 亿**条记录

也就是说，**三层 B+Tree 就能覆盖绝大多数业务表的数据量**，每次查询最多 3 次磁盘 I/O。这就是索引快的根本原因。

### 2.2 聚簇索引 vs 非聚簇索引

理解索引的第二种关键区分：数据是怎么存放的。

**聚簇索引（Clustered Index）**：叶子节点直接存放**完整的行数据**。InnoDB 的主键索引就是聚簇索引——数据和主键索引是"长在一起"的。一张表只能有一个聚簇索引。

**非聚簇索引 / 二级索引（Secondary Index）**：叶子节点存放的是**主键值**，不是完整行数据。

```text
聚簇索引（主键索引）           二级索引（idx_user_id）
┌──────────────────┐          ┌──────────────────┐
│ PK=1, *(完整行)   │          │ user_id=100, PK=1│
│ PK=2, *(完整行)   │          │ user_id=100, PK=5│
│ PK=3, *(完整行)   │          │ user_id=200, PK=3│
└──────────────────┘          └──────────────────┘
       ↑                              │
       │                              │ 回表：用 PK=1 再查聚簇索引
       └──────────────────────────────┘
```

**回表问题**：当查询条件命中二级索引，但 `SELECT` 的列不在该索引中时，需要拿着主键值再去聚簇索引里查完整行——这就是"回表"。

```sql
-- 假设有索引 idx_user_id(user_id)
-- 这条查询需要回表，因为 SELECT 了 * （所有列）
SELECT * FROM orders WHERE user_id = 100;

-- 这条查询不需要回表（覆盖索引），因为查询的列都在索引里
SELECT user_id FROM orders WHERE user_id = 100;
```

**覆盖索引（Covering Index）** 是性能优化的重要手段——当索引已经包含了查询需要的所有列时，执行器可以直接从索引返回结果，省去回表的磁盘 I/O。

### 2.3 索引设计的原则

理解了 B+Tree 的结构，索引设计的原则就变得直观了：

1. **最左前缀原则**：联合索引 `(a, b, c)` 等价于创建了 `(a)`、`(a, b)`、`(a, b, c)` 三个索引。查询条件必须从最左列开始匹配。
2. **选择性高的列放前面**：区分度越大（不重复值越多），索引过滤效果越好。
3. **不要过度索引**：每个索引都会占用存储空间，写入时需要维护，拖慢 `INSERT`/`UPDATE`/`DELETE`。
4. **利用覆盖索引优化高频查询**：把 `SELECT` 的列也加到索引里，避免回表。

```sql
-- 联合索引的最左前缀
CREATE INDEX idx_status_created ON orders(status, created_at);

-- ✅ 走索引：命中最左前缀
SELECT * FROM orders WHERE status = 'PAID';
SELECT * FROM orders WHERE status = 'PAID' AND created_at > '2024-01-01';

-- ❌ 不走索引：跳过了 status
SELECT * FROM orders WHERE created_at > '2024-01-01';
```

## 3. 慢 SQL 分析

"这条 SQL 怎么这么慢？"——这可能是 Java 开发者面对数据库时最常问的问题。答案不在猜测，在 `EXPLAIN`。

### 3.1 EXPLAIN 核心字段

`EXPLAIN` 是 MySQL 提供的执行计划分析工具。在 SQL 前加 `EXPLAIN`，就能看到优化器选择了什么执行方案。

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 100 AND status = 'PAID';
```

输出中最需要关注的四个字段：

| 字段 | 含义 | 你需要关注什么 |
|------|------|----------------|
| `type` | 访问类型 | **最重要**。从好到差：`system` > `const` > `eq_ref` > `ref` > `range` > `index` > `ALL` |
| `key` | 实际使用的索引 | `NULL` 表示没走索引，全表扫描 |
| `rows` | 预估扫描行数 | 越小越好，但这是估算值，不一定精确 |
| `Extra` | 额外信息 | 出现 `Using filesort` 或 `Using temporary` 要警惕 |

### 3.2 type 字段详解

`type` 反映了数据库用什么方式找到数据，是判断 SQL 性能的第一指标：

```text
性能排序（从优到劣）：

const    ── 主键/唯一索引等值查询，最多返回一行
  ↓
eq_ref   ── JOIN 时，驱动表的每一行在被驱动表中通过主键/唯一索引匹配一行
  ↓
ref      ── 非唯一索引等值查询，可能返回多行
  ↓
range    ── 索引范围扫描（BETWEEN, >, <, IN）
  ↓
index    ── 全索引扫描（遍历整个索引树，但不读数据行）
  ↓
ALL      ── 全表扫描 ⚠️ 通常需要优化
```

### 3.3 Extra 字段解读

`Extra` 字段包含执行计划的"注释"，几个常见的：

| Extra 值 | 含义 | 是否需要关注 |
|-----------|------|-------------|
| `Using index` | 覆盖索引，不用回表 ✅ | 好事 |
| `Using where` | Server 层过滤 | 正常 |
| `Using index condition` | 索引下推（ICP） | 正常，InnoDB 优化 |
| `Using filesort` | 额外排序，无法利用索引有序性 ⚠️ | 需要关注 |
| `Using temporary` | 使用临时表 ⚠️ | 需要关注 |
| `Using join buffer` | JOIN 无索引可用，用缓冲区 ⚠️ | 需要关注 |

### 3.4 实战：EXPLAIN 输出解读

```sql
-- 场景：查询某用户的已支付订单
EXPLAIN SELECT * FROM orders 
WHERE user_id = 100 AND status = 'PAID' 
ORDER BY created_at DESC;
```

假设表上有联合索引 `idx_user_status_created(user_id, status, created_at)`：

```text
+----+-------------+--------+------+----------------------+----------------------+---------+-------------+------+-----------------------+
| id | select_type | table  | type | possible_keys        | key                  | key_len | ref         | rows | Extra                 |
+----+-------------+--------+------+----------------------+----------------------+---------+-------------+------+-----------------------+
|  1 | SIMPLE      | orders | ref  | idx_user_status_created | idx_user_status_created | 82    | const,const |   12 | Using index condition |
+----+-------------+--------+------+----------------------+----------------------+---------+-------------+------+-----------------------+
```

**解读**：
- `type = ref`：走了非唯一索引等值查询，不错
- `key = idx_user_status_created`：使用了我们预期的联合索引
- `rows = 12`：预估扫描 12 行，很小
- `Extra = Using index condition`：索引下推，没有 `Using filesort`，说明 `ORDER BY` 也利用了索引的有序性

**结论**：这个执行计划很健康，不需要优化。

再看一个反面案例：

```sql
-- 反面案例：没有合适索引
EXPLAIN SELECT * FROM orders WHERE YEAR(created_at) = 2024;
```

```text
+----+-------------+--------+------+---------------+------+---------+------+--------+-------------+
| id | select_type | table  | type | possible_keys | key  | key_len | ref  | rows   | Extra       |
+----+-------------+--------+------+---------------+------+---------+------+--------+-------------+
|  1 | SIMPLE      | orders | ALL  | NULL          | NULL | NULL    | NULL | 987654 | Using where |
+----+-------------+--------+------+---------------+------+---------+------+--------+-------------+
```

**问题**：`type = ALL`（全表扫描），`key = NULL`（没走索引），扫描近 100 万行。

**原因**：`YEAR(created_at)` 是函数调用，破坏了索引的有序性，优化器无法使用 `idx_created_at` 索引。

**修复**：

```sql
-- 改写为范围查询，让索引可用
SELECT * FROM orders 
WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';
```

## 4. 数据库锁

并发访问数据库时，锁是保证数据一致性的核心机制。但锁也是性能杀手——理解锁的工作原理，才能在并发和性能之间找到平衡。

### 4.1 行锁与表锁

InnoDB 的默认锁粒度是**行锁**——只锁定被访问的行，而不是整张表。这让并发事务可以同时操作同一张表的不同行。

但行锁是**加在索引上**的，不是加在数据行上：

```sql
-- 事务 A
BEGIN;
UPDATE orders SET status = 'CANCELLED' WHERE id = 1;  -- 锁住 id=1 这一行
-- 事务 B 可以同时更新 id=2
UPDATE orders SET status = 'PAID' WHERE id = 2;       -- 正常执行

-- 但如果没走索引，行锁会退化为表锁！
UPDATE orders SET status = 'CANCELLED' WHERE amount > 100;
-- 如果 amount 没有索引，InnoDB 会扫描所有行并对每一行加锁
-- 效果等同于表锁
```

### 4.2 悲观锁与乐观锁

这是两种并发控制的哲学，不是数据库的内置功能分类。

**悲观锁（Pessimistic Locking）**：假设冲突一定会发生，先锁再操作。

```java
// 悲观锁：使用 SELECT ... FOR UPDATE
// Java 代码示例（MyBatis）
@Select("SELECT * FROM accounts WHERE id = #{id} FOR UPDATE")
Account selectForUpdate(Long id);

@Transactional
public void transfer(Long fromId, Long toId, BigDecimal amount) {
    // SELECT ... FOR UPDATE 锁住这两行
    Account from = accountMapper.selectForUpdate(fromId);
    Account to = accountMapper.selectForUpdate(toId);
    
    from.setBalance(from.getBalance().subtract(amount));
    to.setBalance(to.getBalance().add(amount));
    
    accountMapper.update(from);
    accountMapper.update(to);
}
```

**乐观锁（Optimistic Locking）**：假设冲突很少发生，读不加锁，写时检查版本号。

```java
// 乐观锁：使用版本号
@Update("UPDATE accounts SET balance = #{balance}, version = version + 1 " +
        "WHERE id = #{id} AND version = #{version}")
int updateWithVersion(Account account);

public void updateBalance(Long id, BigDecimal newBalance) {
    int maxRetries = 3;
    for (int i = 0; i < maxRetries; i++) {
        Account account = accountMapper.selectById(id);
        account.setBalance(newBalance);
        int rows = accountMapper.updateWithVersion(account);
        if (rows > 0) {
            return; // 更新成功
        }
        // rows = 0 说明版本号已被其他事务修改，重试
    }
    throw new OptimisticLockException("更新失败，请重试");
}
```

### 4.3 悲观锁 vs 乐观锁对比

| 维度 | 悲观锁 | 乐观锁 |
|------|--------|--------|
| 加锁时机 | 读取时就加锁 | 写入时才检查 |
| 实现方式 | `SELECT ... FOR UPDATE` | 版本号 / 时间戳 |
| 冲突处理 | 阻塞等待 | 重试或报错 |
| 适用场景 | 写多读少，冲突频繁 | 读多写少，冲突较少 |
| 性能特征 | 高冲突时稳定，低冲突时浪费 | 高冲突时重试多，低冲突时高效 |
| 死锁风险 | 有 | 无 |
| 典型应用 | 转账、库存扣减 | 商品详情更新、用户信息修改 |

### 4.4 死锁的预防

当两个事务互相等待对方释放锁时，就产生了死锁：

```text
事务 A                          事务 B
──────                          ──────
锁住 id=1                       锁住 id=2
尝试锁 id=2 → 等待 B...        尝试锁 id=1 → 等待 A...
        💀 死锁！
```

**预防策略**：

1. **按固定顺序访问资源**——总是先锁 id 小的，再锁 id 大的
2. **缩短事务时间**——事务越短，持锁时间越短
3. **使用合理的索引**——避免行锁升级为表锁
4. **设置锁等待超时**——`innodb_lock_wait_timeout`

## 5. 事务隔离级别

事务的 ACID 中，**隔离性（Isolation）** 是最复杂的。隔离级别定义了一个事务能看到其他事务的哪些修改——级别越高，并发性能越低，但数据一致性越好。

### 5.1 四种隔离级别

SQL 标准定义了四种隔离级别，从低到高：

**READ UNCOMMITTED（读未提交）**

最低的隔离级别。一个事务可以读到其他事务**尚未提交**的修改。

```sql
-- 事务 A                          -- 事务 B
BEGIN;                              BEGIN;
UPDATE accounts SET balance = 0     
WHERE id = 1;                       
                                    SELECT balance FROM accounts 
                                    WHERE id = 1;
                                    -- 读到 0（脏读！A 还没提交）
ROLLBACK;                           
                                    -- 但 A 回滚了，0 是错误的数据
```

**READ COMMITTED（读已提交）**

一个事务只能读到其他事务**已提交**的修改。解决了脏读问题，但同一事务内两次读取同一行可能得到不同结果（不可重复读）。

```sql
-- 事务 A                          -- 事务 B
BEGIN;                              BEGIN;
SELECT balance FROM accounts        
WHERE id = 1;                       
-- 读到 1000                        
                                    UPDATE accounts SET balance = 900
                                    WHERE id = 1;
                                    COMMIT;
SELECT balance FROM accounts        
WHERE id = 1;                       
-- 读到 900（不可重复读！同一事务内两次读结果不同）
```

**REPEATABLE READ（可重复读）**

MySQL 的默认级别。同一事务内多次读取同一行，结果始终一致。通过 **MVCC（多版本并发控制）** 实现：事务开始时创建一个"快照"，后续读取都基于这个快照。

```sql
-- 事务 A                          -- 事务 B
BEGIN;                              BEGIN;
SELECT balance FROM accounts        
WHERE id = 1;                       
-- 读到 1000（快照读）              
                                    UPDATE accounts SET balance = 900
                                    WHERE id = 1;
                                    COMMIT;
SELECT balance FROM accounts        
WHERE id = 1;                       
-- 仍然读到 1000 ✅（快照读，看到的是事务开始时的版本）
```

**SERIALIZABLE（串行化）**

最高级别。所有事务串行执行，完全隔离。通过加表锁或间隙锁实现，性能最差，但一致性最好。

### 5.2 隔离级别与并发问题

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 实现机制 |
|---------|------|-----------|------|---------|
| READ UNCOMMITTED | ✅ 可能 | ✅ 可能 | ✅ 可能 | 无锁，直接读最新数据 |
| READ COMMITTED | ❌ 不会 | ✅ 可能 | ✅ 可能 | 行锁 + 每次读生成新快照 |
| REPEATABLE READ | ❌ 不会 | ❌ 不会 | ⚠️ 部分防止 | MVCC 事务级快照 + 间隙锁 |
| SERIALIZABLE | ❌ 不会 | ❌ 不会 | ❌ 不会 | 读加共享锁，写加排他锁 |

> **关于幻读**：MySQL 的 REPEATABLE READ 通过**间隙锁（Gap Lock）** 在很大程度上防止了幻读，但并非完全消除。快照读（普通 `SELECT`）不会出现幻读；当前读（`SELECT ... FOR UPDATE`、`INSERT`、`UPDATE`）在特定并发场景下仍可能出现。

### 5.3 MVCC 的工作原理

MVCC（Multi-Version Concurrency Control）是 InnoDB 实现高并发的核心机制。简单来说，每行数据保留多个版本，不同事务看到不同的版本。

```text
┌──────────────────────────────────────────────────┐
│                   InnoDB 行记录                    │
├──────────┬───────────┬──────────┬────────────────┤
│ 隐藏列    │ DB_TRX_ID │ DB_ROLL_PTR │  用户数据   │
│          │ 最后修改   │ 回滚指针     │            │
│          │ 事务 ID   │ → undo log  │            │
└──────────┴───────────┴──────────────┴────────────┘

事务开始时，ReadView 记录当前活跃事务列表
读取行时，比较行的 DB_TRX_ID 与 ReadView：
  - 如果行的事务 ID < 最小活跃事务 ID → 可见
  - 如果行的事务 ID > 最大事务 ID → 不可见
  - 如果行的事务 ID 在活跃列表中 → 不可见（沿 undo log 链找旧版本）
```

这就是为什么 REPEATABLE READ 能做到"可重复读"——事务一旦创建 ReadView，后续所有读都基于这个快照。

### 5.4 Java 开发者如何选择隔离级别

```java
// Spring 中设置事务隔离级别
@Transactional(isolation = Isolation.REPEATABLE_READ)
public Order getOrder(Long orderId) {
    // 默认隔离级别，读一致性好，性能可接受
    return orderMapper.selectById(orderId);
}

// 对一致性要求极高的场景
@Transactional(isolation = Isolation.SERIALIZABLE)
public void criticalTransfer(Long fromId, Long toId, BigDecimal amount) {
    // 串行执行，性能低但绝对安全
}
```

**实际建议**：

- **大多数场景用 REPEATABLE READ**——MySQL 默认级别，够用
- **金融核心链路考虑 SERIALIZABLE**——但要做好性能测试
- **避免 READ UNCOMMITTED**——几乎没有生产场景需要脏读
- **READ COMMITTED 适合 Oracle 迁移项目**——Oracle 默认级别就是 RC

## 6. 本章小结

本章从 Java 开发者的视角梳理了数据库的五个核心知识点：

| 主题 | 核心要点 | Java 开发者行动项 |
|------|---------|-------------------|
| SQL 执行流程 | Parser → Optimizer → Executor → Storage | 用 `EXPLAIN` 分析执行计划，不要猜 |
| 索引原理 | B+Tree 三层可覆盖 16 亿行 | 理解最左前缀和覆盖索引，合理设计索引 |
| 慢 SQL 分析 | `type` 和 `Extra` 是关键指标 | 避免 `ALL` 和 `Using filesort` |
| 锶 | 行锁加在索引上，乐观锁靠版本号 | 读多写少用乐观锁，写多用悲观锁 |
| 事务隔离 | REPEATABLE READ + MVCC | 理解快照读和当前读的区别 |

这些不是面试八股文——它们会在你写每一行 SQL、设计每一个并发方案时，默默影响你的决策。

> 数据库的锁和隔离级别是底层机制，但在 Java 应用中，你不会直接操作它们——Spring 用一个 `@Transactional` 注解帮你搞定。这个注解背后是什么？事务传播机制在嵌套调用时怎么运作？为什么加了注解数据还是"飞"了？下一章回答这些问题。
