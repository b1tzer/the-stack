---
doc_id: pg-postgresql-overview
title: PostgreSQL 核心特性与选型
---

# PostgreSQL 核心特性与选型

> **学习目标**：从"会写 SQL"升级到"理解 PG 核心原理 → 能做技术选型 → 能排查表膨胀等运维问题"
>
> **检验标准**：学完每个模块后，能口述"这个技术解决了什么问题？不用它会怎样？工作中有哪些坑？"

## 1. 版本发展

```mermaid
timeline
    title PostgreSQL 版本发展
    1996 : v6.0 : 正式命名 PostgreSQL
    2005 : v8.0 : Windows 支持、表空间、Savepoint
    2010 : v9.0 : 流复制、Hot Standby
    2014 : v9.4 : JSONB 类型
    2016 : v9.6 : 并行查询
    2017 : v10 : 逻辑复制、声明式分区
    2019 : v12 : 分区性能大幅提升
    2021 : v14 : 存储过程 INOUT、JSON 便捷访问
    2022 : v15 : MERGE 语句、WAL 压缩
    2023 : v16 : 逻辑复制增强
    2024 : v17 : 增量备份、MERGE 增强
```

> 📌 本站聚焦 **v14 / v15 / v16** 版本，覆盖 JSONB、窗口函数、CTE、MVCC/VACUUM 等核心特性。

## 2. 整体知识地图

```mermaid
mindmap
    root((PostgreSQL 核心))
        选型对比
            PG vs MySQL 核心差异
            JSON/GIS/窗口函数
            适用场景决策
        MVCC 与 VACUUM
            xmin / xmax 隐藏字段
            Dead Tuple 与表膨胀
            VACUUM vs VACUUM FULL
            autovacuum 配置
            长事务阻塞问题
        索引类型
            B-tree 通用索引
            GIN 多值字段/JSONB
            GiST 地理信息
            BRIN 超大有序表
        高级特性
            窗口函数 ROW_NUMBER/RANK
            CTE 公共表表达式
            递归 CTE 树形查询
            物化视图
        事务与锁
            隔离级别与 SSI
            行锁/表锁/咨询锁
            死锁检测
        性能优化
            EXPLAIN 分析
            pg_stat_statements
            索引优化与配置调优
        JSONB
            操作符与索引
            GIN 索引优化
            实战场景
```

## 3. PostgreSQL vs MySQL

### 3.1 为什么要了解选型差异？

不了解两者差异，就无法在技术选型时给出有依据的建议，也无法解释"为什么这个场景要用 PG 而不是 MySQL"。

### 3.2 核心差异速览

| 维度 | PostgreSQL | MySQL | 选择依据 |
| :--- | :--- | :--- | :--- |
| **JSON 支持** | 原生 JSONB，可建 GIN 索引 | JSON 支持较弱，索引能力有限 | 需要存储和查询 JSON 选 PG |
| **窗口函数** | 完整支持 | MySQL 8.0+ 才支持 | 需要复杂分析查询选 PG |
| **MVCC 实现** | 旧版本存堆表，需要 VACUUM | Undo Log，自动回收 | PG 有表膨胀风险 |
| **SQL 标准** | 严格遵循 | 部分宽松 | 需要严格标准选 PG |
| **国内生态** | 增长迅速 | 成熟完善 | 团队熟悉度优先 |

> 详细对比 → [PG与MySQL对比](chapter-05-pg-vs-mysql.md)

## 4. MVCC 原理与表膨胀

### 4.1 为什么要理解 MVCC？

不理解 PG 的 MVCC 实现，就无法解释为什么 PG 会有表膨胀问题，也无法正确配置 VACUUM 策略。

### 4.2 核心机制

每行数据有两个隐藏字段：`xmin`（插入该行的事务 ID）和 `xmax`（删除/更新该行的事务 ID）。UPDATE 时不修改原行，而是**插入新行并标记旧行的 xmax**，旧行成为 Dead Tuple。

```mermaid
flowchart LR
    UPDATE["执行 UPDATE"] --> OLD["旧行: xmax=当前事务ID<br>(Dead Tuple)"]
    UPDATE --> NEW["新行: xmin=当前事务ID<br>(新版本)"]
    OLD -->|VACUUM 清理| CLEAN["空间回收"]
```

| 对比点 | PostgreSQL | MySQL (InnoDB) |
|--------|-----------|----------------|
| 旧版本存储 | 堆表中（与新版本共存） | Undo Log 回滚段 |
| 旧版本清理 | VACUUM 主动清理 | 事务提交后自动回收 |
| 表膨胀风险 | **有** | 无 |

> 详细原理 → [MVCC与VACUUM机制](../03-internals/chapter-04-mvcc.md)

## 5. 索引类型

### 5.1 为什么要了解多种索引类型？

MySQL 主要只有 B-tree，而 PG 提供了多种索引类型。选错索引类型，JSONB 查询可能退化为全表扫描。

### 5.2 索引类型速览

| 索引类型 | 适用场景 | 核心优势 |
|---------|---------|---------|
| **B-tree** | 通用，等值/范围/排序 | 最通用，大多数场景首选 |
| **GIN** | JSONB、全文检索、数组 | 多值字段，每个值单独建索引项 |
| **GiST** | 地理位置、几何图形 | 支持空间查询，B-tree 无法处理 |
| **BRIN** | 超大表、时间序列 | 索引极小，适合物理有序大表 |

> ⚠️ **工作中的坑**：JSONB 字段未建 GIN 索引，查询退化为全表扫描。

> 详细说明 → [索引类型详解](../04-index-optimization/chapter-01-index-types.md)

## 6. 高级特性

### 6.1 窗口函数

在不改变结果行数的情况下，对每行数据进行跨行计算（排名、累计、前后行对比）。

| 函数 | 示例结果（并列时） | 适用场景 |
|------|-----------------|---------|
| `ROW_NUMBER()` | 1, 2, 3, 4 | 分页、唯一行号 |
| `RANK()` | 1, 2, 2, 4 | 竞赛排名（并列后跳过） |
| `DENSE_RANK()` | 1, 2, 2, 3 | 等级划分（并列后不跳过） |
| `LAG() / LEAD()` | - | 环比计算、前后行对比 |

> 详细说明 → [窗口函数](../02-sql-advanced/chapter-01-window-function.md)

### 6.2 CTE 与递归查询

CTE 将复杂查询拆分为可读的命名子查询；递归 CTE 支持查询树形结构（组织架构、分类层级）。

```sql
-- 递归 CTE 查询组织架构树
WITH RECURSIVE org_tree AS (
    SELECT id, name, manager_id, 1 AS level FROM employees WHERE id = 1
    UNION ALL
    SELECT e.id, e.name, e.manager_id, ot.level + 1
    FROM employees e JOIN org_tree ot ON e.manager_id = ot.id
)
SELECT * FROM org_tree ORDER BY level;
```

> 详细说明 → [CTE与递归查询](../02-sql-advanced/chapter-02-cte-recursive.md)

### 6.3 物化视图

将复杂查询结果持久化存储，查询时直接读取预计算结果，适合报表统计等实时性要求不高的场景。

| 对比项 | 普通视图 | 物化视图 |
|--------|---------|---------|
| 数据存储 | 不存储，实时计算 | 存储在磁盘，查询极快 |
| 数据新鲜度 | 实时 | 需要手动/定时刷新 |
| 可建索引 | ❌ | ✅ |

> 详细说明 → [物化视图](../06-advanced-features/chapter-07-materialized-view.md)

## 7. VACUUM 机制

### 7.1 为什么要理解 VACUUM？

不了解 VACUUM，就无法处理 PG 的表膨胀问题，也无法解释为什么长事务会导致表空间持续增长。

### 7.2 VACUUM 命令对比

| 命令 | 是否锁表 | 空间归还 OS | 适用场景 |
|------|---------|-----------|---------|
| `VACUUM` | ❌ 不锁表 | ❌ 标记可复用 | 日常维护 |
| `VACUUM FULL` | ✅ **锁表** | ✅ 归还 OS | 表膨胀严重，业务低峰期 |
| `pg_repack` | ❌ 不锁表 | ✅ 归还 OS | **推荐替代 VACUUM FULL** |

> ⚠️ **工作中的坑**：长事务会阻止 VACUUM 清理旧版本，是表膨胀的主要原因。需监控 `pg_stat_activity` 及时终止长事务。

> 详细说明 → [MVCC与VACUUM机制](../03-internals/chapter-04-mvcc.md)

## 8. 高频面试速查

| 问题 | 关键答案 |
|------|---------|
| PG 和 MySQL 最核心的区别？ | JSONB+GIN 索引、完整窗口函数、MVCC 实现不同（PG 有表膨胀）、SQL 标准更严格 |
| 什么是表膨胀？如何避免？ | Dead Tuple 堆积导致表文件增大；确保 autovacuum 开启，避免长事务，监控 n_dead_tup |
| GIN 和 B-tree 的区别？ | B-tree 适合单值字段；GIN 适合多值字段（JSONB/数组/全文检索），每个值单独建索引项 |
| ROW_NUMBER/RANK/DENSE_RANK 区别？ | 并列时：ROW_NUMBER 连续(1,2,3,4)；RANK 跳跃(1,2,2,4)；DENSE_RANK 密集(1,2,2,3) |
| 物化视图和普通视图的区别？ | 物化视图存储查询结果，查询极快，需手动刷新；普通视图不存储，实时计算 |
| VACUUM 和 VACUUM FULL 的区别？ | VACUUM 不锁表，空间标记可复用；VACUUM FULL 锁表，彻底回收空间归还 OS |
| 为什么长事务导致表膨胀？ | VACUUM 不能清理比最老活跃事务更新的 Dead Tuple，长事务期间 Dead Tuple 无法清理 |

## 9. 常见问题速查

| 问题现象 | 根本原因 | 解决方案 |
|---------|---------|---------|
| JSONB 查询慢 | 未建 GIN 索引 | `CREATE INDEX USING GIN (jsonb_col)` |
| 表空间持续增长 | autovacuum 未生效或长事务阻塞 | 检查 autovacuum 配置，监控并终止长事务 |
| `VACUUM FULL` 导致业务中断 | 锁表时间过长 | 改用 `pg_repack` 工具在线重建表 |
| 窗口函数排名不符合预期 | 混淆 RANK 和 DENSE_RANK | 明确业务需要跳跃排名还是密集排名 |
| 递归 CTE 死循环 | 数据中存在循环引用 | 添加深度限制 `WHERE level < 10` |
| 长事务阻塞 VACUUM | 事务未及时提交 | 监控 `pg_stat_activity`，及时终止长事务 |

## 10. 事务与锁机制

### 10.1 为什么要了解 PG 的锁机制？

PG 的锁机制比 MySQL 更细粒度（8 种表锁、4 种行锁），且提供了独特的咨询锁（Advisory Lock）。理解这些差异能帮助你在 PG 中写出更高效的并发代码。

### 10.2 核心差异

| 对比项 | PostgreSQL | MySQL |
|--------|-----------|-------|
| 默认隔离级别 | Read Committed | Repeatable Read |
| Serializable 实现 | SSI（乐观，性能好） | 加锁（悲观，性能差） |
| 行锁类型 | 4 种（FOR UPDATE/SHARE/NO KEY UPDATE/KEY SHARE） | 2 种（排他锁/共享锁） |
| 咨询锁 | ✅ 支持 | ❌ 不支持 |
| SKIP LOCKED | ✅ 支持（任务队列利器） | MySQL 8.0+ 支持 |

> 详细说明 → [事务与锁机制](../05-transaction-concurrency/chapter-01-transaction.md)

## 11. 性能优化与调优

### 11.1 为什么要掌握 PG 的性能分析工具？

PG 提供了 `pg_stat_statements`、`auto_explain`、部分索引等强大的性能分析和优化工具，掌握这些工具能帮助你快速定位和解决性能瓶颈。

### 11.2 核心工具

| 工具 | 用途 | 使用场景 |
|------|------|----------|
| `EXPLAIN ANALYZE` | 分析单条 SQL 的执行计划 | 定位具体 SQL 的性能瓶颈 |
| `pg_stat_statements` | 统计所有 SQL 的执行情况 | 找到最耗时、最频繁的 SQL |
| `auto_explain` | 自动记录慢查询的执行计划 | 生产环境慢查询分析 |
| 部分索引 | 只对部分数据建索引 | 数据分布不均匀的场景 |

> 详细说明 → [性能优化与调优](../09-practice/chapter-02-performance-tuning.md)

## 12. JSONB 高级用法

### 12.1 为什么 JSONB 是 PG 的核心优势？

PG 的 JSONB 是二进制存储，支持 GIN 索引，查询性能远优于 MySQL 的 JSON。在半结构化数据场景（商品属性、用户配置、日志元数据）中，JSONB 让你兼具关系型数据库的可靠性和 NoSQL 的灵活性。

### 12.2 核心操作符

| 操作符 | 含义 | 示例 |
|--------|------|------|
| `->` | 提取 JSON 对象 | `attrs -> 'brand'` → `"Apple"` |
| `->>` | 提取文本值 | `attrs ->> 'brand'` → `Apple` |
| `@>` | 包含判断 | `attrs @> '{"brand": "Apple"}'` |
| `\|\|` | 合并/更新 | `attrs \|\| '{"weight": "187g"}'` |

> 详细说明 → [JSONB高级用法](../02-sql-advanced/chapter-04-jsonb.md)