# Binlog

> Redo Log 负责让主库崩溃后能恢复数据，Binlog 负责把这份数据「复制」出去。一个事务提交时，两份日志都要写。问题在于：**如果先写 Redo 再写 Binlog，中间断电，主库通过 Redo 恢复了这个事务，Binlog 里却没有——从库会永远少这一笔；反过来先写 Binlog 再写 Redo，主库回滚了，从库却执行了。** 这正是两阶段提交要解决的事。

## 1. 概述与记录格式

### 1.1 Binlog 是什么，用来干什么

Binlog（Binary Log，二进制日志）是 **MySQL Server 层**产生的日志，与存储引擎无关。它记录的是「数据库做了哪些变更」的逻辑日志，两个用途：

1. **主从复制**：从库拉取主库的 Binlog，重放这些变更，从而保持数据一致；
2. **数据恢复**：配合全量备份做时间点恢复（PITR），把数据库恢复到某个历史时刻。

与 Redo Log 的定位差异见 [Redo Log §5.2](./chapter-04-redo-log.md#redo-vs-binlog)，这里先记住一句：**Redo Log 是 InnoDB 的私有账本，管崩溃恢复；Binlog 是 Server 层的公共账本，管复制与恢复。**

![Binlog：Server 层逻辑日志 — 是什么 / 怎么做到 / 干什么](/mysql/02-innodb-internals-chapter-06-binlog.svg)

### 1.2 三种记录格式：同一个事务，三种记法

Binlog 可以按三种格式记录同一条 `UPDATE`：

| 格式 | 记录内容 | 优点 | 缺点 |
| :-- | :-- | :-- | :-- |
| `STATEMENT` | 原始 SQL 语句 | 日志量小 | 含 `NOW()`、`RAND()`、`LIMIT` 的语句在从库执行结果可能不同 |
| `ROW` | 每行变更的前后值 | 一致性最强，可精确恢复 | 批量操作时日志量大 |
| `MIXED` | 默认 `STATEMENT`，遇不确定语句自动切 `ROW` | 折中 | 仍偶有边界问题 |

```ini
binlog_format = ROW
```

`STATEMENT` 格式的根本缺陷在于「语句在从库重放时不一定得到相同结果」。典型反例：

```sql
-- 主库执行，NOW() 取主库时间
UPDATE orders SET updated_at = NOW() WHERE id = 1;

-- STATEMENT 格式记录的是这条 SQL 本身
-- 从库重放时 NOW() 取的是「从库重放那一刻」的时间
-- 两边 updated_at 不一致
```

`ROW` 格式直接记录变更前后的行值（`@1=1` 表示第 1 列的值），重放时无歧义，因此生产环境统一用 `ROW`。代价是日志量随变更行数线性增长。

```sql
SET binlog_format = 'ROW';

-- ROW 格式下 mysqlbinlog 解码出的内容
-- ### UPDATE `mydb`.`users`
-- ###   @1=1                        -- id（BEFORE）
-- ###   @2='张三'                   -- name（BEFORE）
-- ###   @2='张三三'                 -- name（AFTER）
```

## 2. 两阶段提交

### 2.1 为什么需要两阶段提交

这是 Binlog 最核心、也最容易背答案却不理解的问题。先放下结论，从「一份事务要写两份日志」这个事实推。

一次 `COMMIT`，InnoDB 要写 Redo Log（保证崩溃恢复），Server 层要写 Binlog（保证复制）。两份日志必须**同时都写成功**，这个事务才算真正提交。但磁盘写入有先后，任何「先后顺序」都会在中间断电时产生不一致：

**方案一：先写 Redo，再写 Binlog**

```text
1. 写 Redo Log（提交）        ← 写到这里断电
2. 写 Binlog
```

崩溃后主库用 Redo Log 恢复，这个事务**生效了**。但 Binlog 里没有这条记录，从库重放时**少了这笔**。主库有、从库无 → 主从不一致。

**方案二：先写 Binlog，再写 Redo**

```text
1. 写 Binlog                 ← 写到这里断电
2. 写 Redo Log（提交）
```

崩溃后主库用 Redo Log 恢复，这个事务**没生效**（被回滚）。但 Binlog 里已经写了，从库重放时**多了这笔**。主库无、从库有 → 主从不一致。

无论哪种固定顺序，断电都会打破「主库和从库看到同一批已提交事务」的约定。两阶段提交的解法，是把这个「提交」拆成两段，并在崩溃恢复时**根据 Binlog 的状态反推该不该提交**：

```text
阶段一  prepare：Redo Log 写入，标记为 prepare 状态（还未真正提交）
阶段二  commit：
        1. 写 Binlog
        2. Redo Log 标记为 commit 状态（真正提交）
```

崩溃恢复时的判断规则：

```text
扫描 Redo Log，找到处于 prepare 状态的事务
  ├─ 在 Binlog 里能找到对应记录（事务已完整写进 Binlog）
  │      → 说明阶段二已经走完至少一半，主库应提交
  └─ 在 Binlog 里找不到对应记录
         → 说明阶段二还没开始，主库应回滚
```

**核心在于：Binlog 的写入是「分水岭」。** Binlog 写成功之前，主库和从库都不该有这个事务；Binlog 写成功之后，主库必须提交，才能和已经（或将要）重放这条 Binlog 的从库保持一致。Redo Log 的 prepare 状态，就是「先占个位，等 Binlog 的结果再定去留」。

::: info 📖 怎么「在 Binlog 里找对应记录」
崩溃恢复时，InnoDB 用 Redo Log prepare 记录里携带的 **XID**（事务唯一标识）去 Binlog 里匹配同名 XID 事件。XID 事件是 `ROW` 格式下事务提交时写入的标记，两者 XID 相同即认为「这个事务的 Binlog 已完整落盘」。
:::

两阶段提交的完整流程与 `sync_binlog`、`innodb_flush_log_at_trx_commit` 的配合见 [Redo Log §5.1](./chapter-04-redo-log.md#two-phase-commit)。

## 3. 查看与解析

### 3.1 查看与解析 Binlog

```sql
-- 查看 Binlog 文件列表
SHOW BINARY LOGS;

-- 查看当前正在写入的 Binlog 及位置
SHOW MASTER STATUS;

-- 查看某个文件里的事件
SHOW BINLOG EVENTS IN 'binlog.000001' LIMIT 20;
```

用 `mysqlbinlog` 工具把二进制内容解码成可读文本：

```bash
mysqlbinlog --base64-output=DECODE-ROWS -v binlog.000001
```

`-v` 会把 ROW 格式的行变更还原成 `### @1=...` 形式；加两个 `-vv` 会附带字段类型等更多信息。

### 3.2 Binlog 事件类型

一个 Binlog 文件由一系列事件（Event）顺序组成。常见事件：

| 事件类型 | 说明 |
| :-- | :-- |
| `FORMAT_DESCRIPTION` | 文件头，描述 Binlog 版本 |
| `QUERY` | SQL 语句事件（STATEMENT 格式） |
| `TABLE_MAP` | 表结构映射（ROW 格式下先声明表） |
| `WRITE_ROWS` / `UPDATE_ROWS` / `DELETE_ROWS` | 行级写入 / 更新 / 删除（ROW 格式） |
| `XID` | 事务提交标记（两阶段提交的「分水岭」） |
| `ROTATE` | 文件轮转，切到下一个 Binlog 文件 |

## 4. 管理与恢复

### 4.1 Binlog 管理与清理

Binlog 只会追加、不会复用，需要主动清理，否则会写满磁盘。

```sql
-- 查看当前写入的 Binlog 及位置
SHOW MASTER STATUS;

-- 手动切换文件
FLUSH LOGS;

-- 清理指定日期之前的 Binlog
PURGE BINARY LOGS BEFORE '2024-01-01 00:00:00';

-- 清理指定文件之前的 Binlog（含该文件）
PURGE BINARY LOGS TO 'binlog.000010';

-- 设置自动过期时间（秒）
SET GLOBAL binlog_expire_logs_seconds = 604800;  -- 7 天
```

### 4.2 基于 Binlog 的时间点恢复（PITR）

误删数据后，用「全量备份 + Binlog 重放」把数据恢复到误操作前：

```bash
# 1. 先恢复最近一次全量备份
mysql -u root -p < full_backup.sql

# 2. 定位误操作发生在哪个 Binlog、哪个时间
mysqlbinlog --base64-output=DECODE-ROWS -v binlog.000005 | grep -B5 'DELETE FROM users'

# 3. 恢复到误操作前一刻（不含误操作）
mysqlbinlog --stop-datetime='2024-01-01 12:30:00' \
    binlog.000001 binlog.000002 binlog.000003 | mysql -u root -p

# 4. 跳过误操作，从误操作之后继续恢复
mysqlbinlog --start-datetime='2024-01-01 12:31:00' \
    binlog.000003 binlog.000004 binlog.000005 | mysql -u root -p
```

恢复依赖的是 Binlog 的**有序性与完整性**，这也是为什么生产上要 `sync_binlog=1`（每次提交都刷盘）保证 Binlog 不丢。

## 5. 最佳实践

1. **用 `ROW` 格式**：一致性最强，便于精确恢复与排查。
2. **开启 `sync_binlog=1`**：与 `innodb_flush_log_at_trx_commit=1` 配合构成「双 1」，崩溃时数据与 Binlog 都不丢。
3. **设过期时间并监控磁盘**：Binlog 只增不减，不清理会写满磁盘。
4. **不要在线禁用 Binlog**：会同时断掉复制与 PITR 能力。
