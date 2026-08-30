# GTID 复制

> 主库宕机，从库要顶上。传统复制下，你要先在主库查 `SHOW MASTER STATUS` 拿到 `file + position`，再手动 `CHANGE MASTER TO` 指到那个位点——但主库已经宕了，位点查不到，从库可能已经多跑或少跑了几条，差一个字节就整体错位。GTID 把「找位点」这个人工动作变成自动的：每个事务自带一个全局唯一编号，从库自己就能判断「哪些事务我执行过、哪些还没」。

## 1. 传统复制的位点困境

传统复制定位复制进度，靠的是**两个坐标**：Binlog 文件名 + 文件内偏移量（`file + position`）。从库记录「我读到 `binlog.000003` 的第 1284 字节」，下次从这里继续。

这个方案在主库正常时没问题，主从切换时立刻失效：

```text
问题 1：位点从哪来？
主库宕机，无法执行 SHOW MASTER STATUS 拿到最新位点。

问题 2：从库之间位点不互通
每个从库的位点是各自文件内的字节偏移，A 从库读到 1284，
B 从库读到 4096，这两个数字无法互相换算。

问题 3：位点会漂移
同一份事务，在不同机器上写进 Binlog 的字节数可能不同，
同一个逻辑位点对应不到同一条事务。
```

根因是：**`file + position` 描述的是「物理位置」，不是「逻辑内容」。** 物理位置和事务之间没有稳定的一一对应，切换时人工找位点就必然易错——多指一位会重复执行，少指一位会漏事务。

## 2. GTID：给事务一个全局唯一的身份证

GTID（Global Transaction Identifier，全局事务标识符）的思路是：不再用物理位置，改为给**每个事务**一个全局唯一编号。

```text
GTID = server_uuid : transaction_id
       3e11fa47-71ca-11e1-9e33-c80aa9429562 : 23
```

- **`server_uuid`**：每台 MySQL 实例的全局唯一标识，写在 `auto.cnf` 里，首次启动生成。
- **`transaction_id`**：该实例上顺序递增的事务序号，从 1 开始。

主库每提交一个事务，就为它分配一个 GTID，并把 GTID 写进 Binlog。从库拉取 Binlog 时，看到的不再是「某文件的某字节」，而是「编号为 `xxx:23` 的事务」。这个编号在整条复制链上**唯一且不变**，无论事务被复制到哪台机器，它的 GTID 都一样。

::: info 📖 为什么 GTID 天然唯一
`server_uuid` 是机器级唯一标识，`transaction_id` 是机器内递增序号。两个事务只要 `server_uuid` 不同，或 `transaction_id` 不同，GTID 就不同。即使多台机器的事务序号都叫 `23`，前缀的 `server_uuid` 也把它们区分开了。
:::

## 3. 自动定位：从库怎么知道该从哪继续

传统复制下，从库要被告知「从哪里开始」。GTID 下，从库自己就能算出来。核心是**两个集合**：

```sql
-- 从库已经执行过的事务集合
SELECT @@global.gtid_executed;
-- 输出：3e11fa47-...:1-1000

-- 从库已经接收到的事务集合（含已执行 + 已接收未执行）
SELECT @@global.gtid_purged;
```

从库启动复制时，把自己的 `gtid_executed` 集合发给主库，问一句：**「这些事务我都做过了，把剩下的发给我。」** 主库对比自己 Binlog 里的全部 GTID，算出差集，只发送从库没执行过的部分。

这个机制叫 `SOURCE_AUTO_POSITION=1`（自动定位）。它的价值在故障切换时体现得最明显：

```text
新主库不需要知道「从库读到哪了」，
从库也不需要知道「新主库写到哪了」，
两边把 gtid_executed 一对，差集自动补齐。
```

「找位点」这个人工动作被彻底取消，也同时消灭了「多指一位重复执行、少指一位漏事务」两类事故。

## 4. 配置 GTID 复制

主库和从库都需要开启：

```ini
# my.cnf
gtid_mode = ON
enforce_gtid_consistency = ON
```

`enforce_gtid_consistency = ON` 会禁止那些「无法分配唯一 GTID」的语句（见 §7），保证 Binlog 里的每个事务都能被稳定标识。

## 5. 故障切换实战

主库宕机，把从库提升为新主库：

```sql
-- 步骤 1：确认从库数据追平主库
SELECT @@global.gtid_executed;          -- 记录当前已执行集合
SHOW REPLICA STATUS\G;                  -- 看 Seconds_Behind_Source 是否为 0

-- 步骤 2：停止复制并清除旧复制配置
STOP REPLICA;
RESET REPLICA ALL;

-- 步骤 3：开放写
SET GLOBAL read_only = OFF;
SET GLOBAL super_read_only = OFF;

-- 步骤 4：其余从库指向新主库，用自动定位
CHANGE REPLICATION SOURCE TO
    SOURCE_HOST = 'new_master_ip',
    SOURCE_USER = 'repl',
    SOURCE_PASSWORD = 'secret',
    SOURCE_AUTO_POSITION = 1;
START REPLICA;
```

::: tip 关键点
步骤 4 没有指定任何 `file + position`，只开了 `SOURCE_AUTO_POSITION=1`。新主库和其余从库靠 `gtid_executed` 集合自动对齐，不存在「位点算错」的问题。
:::

## 6. GTID 与传统复制对比

| 对比项 | 传统复制 | GTID 复制 |
| :-- | :-- | :-- |
| 定位方式 | `file + position`，物理位点 | `gtid_executed` 集合，逻辑编号 |
| 故障切换 | 手动找位点，易错 | 自动定位 |
| 数据一致性 | 位点错位可能漏/重事务 | 按 GTID 去重，不重不漏 |
| 多源复制 | 难 | 每个源事务有全局 ID，天然可区分 |
| 版本要求 | 全版本 | MySQL 5.6+，5.7/8.0 完善 |
| 推荐 | 存量老库 | ✅ 新项目默认 |

## 7. GTID 的限制

GTID 要求「一个事务一个 GTID」，有些语句天然无法满足，会被 `enforce_gtid_consistency` 拒绝：

```sql
-- ❌ 1. CREATE TABLE ... SELECT
-- 它同时做「建表 DDL」和「插入 DML」，被拆成两个事务，
-- 无法分配单一 GTID。
CREATE TABLE new_table AS SELECT * FROM old_table;

-- ✅ 拆成两步
CREATE TABLE new_table LIKE old_table;
INSERT INTO new_table SELECT * FROM old_table;
```

```sql
-- ❌ 2. 事务里同时更新事务表（InnoDB）和非事务表（MyISAM）
-- 两类表的提交语义不同，无法保证一个 GTID 对应一次原子提交。
```

```sql
-- ❌ 3. 事务里创建临时表
-- 临时表是会话级对象，不参与复制，却会让事务无法分配全局 GTID。
```

这些都是「语法本身模糊」导致的约束，不是 GTID 的设计缺陷。遇到时按注释里的拆法改写即可。

## 8. 最佳实践

1. **新项目直接开 GTID**：从第一天就规避位点迁移问题，事后从传统复制迁 GTID 要停机。
2. **配合半同步复制**：GTID 解决「定位」，半同步解决「不丢」，两者正交，见 [Binlog 复制](./chapter-01-binlog-replication.md)。
3. **监控主从 GTID 差集**：对比主从 `gtid_executed`，判断延迟。
4. **备份时记录 `gtid_executed`**：恢复时能精确续传。
5. **用 Orchestrator/MHA 做自动切换**：GTID 让切换脚本无需处理位点，切换更可靠。
