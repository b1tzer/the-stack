# MySQL 概览

MySQL 是由 Oracle 维护的开源关系型数据库，默认存储引擎是 InnoDB。本页给出理解 MySQL 的整体地图：它由哪些部件决定行为、背后有哪些设计取向、什么场景适合继续用它。读完本页，从[整体架构](./chapter-02-architecture.md)开始按主线深入。

本专项面向已经掌握基础 SQL 的后端开发者，讨论 MySQL 在生产环境中的内部行为：一条 SQL 如何执行、数据如何落盘、并发如何隔离、性能由什么决定。不覆盖 SQL 语法入门，也不覆盖备份恢复等操作手册（操作见[运维管理](../08-operations/chapter-01-backup-restore.md)）。

## 核心组成

| 组成 | 解决的问题 | 继续阅读 |
| :-- | :-- | :-- |
| 连接层与服务层 | 接收请求、解析 SQL、生成执行计划 | [整体架构](./chapter-02-architecture.md) |
| InnoDB 存储引擎 | 组织数据页、缓存、崩溃恢复和并发事务 | [存储与日志](../02-storage-and-logging/chapter-01-data-page.md) |
| 索引与优化器 | 缩小候选行范围并选择代价较低的执行方式 | [B+ 树索引](../03-index/chapter-01-btree-index.md) |
| 事务、MVCC 与锁 | 保证并发事务的隔离，并协调读写冲突 | [事务与锁](../05-transaction-lock/chapter-01-overview.md) |
| SQL 与 Schema 特性 | 定义字符集、排序规则，使用窗口函数等能力 | [字符集与排序规则](../06-sql-and-schema/chapter-01-charset-collation.md) |
| 复制与日志 | 同步变更、恢复数据并支持故障切换 | [复制与扩展架构](../07-replication-and-architecture/chapter-01-binlog-replication.md) |

InnoDB 是 MySQL 的默认存储引擎，也是本专项的主要讨论对象。它通过 Buffer Pool 降低磁盘访问，通过 Redo Log 保证崩溃恢复，通过 Undo Log 和 Read View 支持 MVCC，通过索引与锁协调并发读写。

## 四条设计主线

理解 MySQL 的行为，先抓住四条设计取向。后续所有章节都在展开它们，遇到具体问题时也能回到这四条线索定位原因。

1. **日志先行**。写请求先顺序写入 Redo Log，数据页再异步刷盘。顺序写远快于随机写，已提交的事务在崩溃后也能恢复。见 [Redo Log](../02-storage-and-logging/chapter-04-redo-log.md)。
2. **内存换磁盘 IO**。Buffer Pool 缓存数据页：读先查内存，写先改内存中的页，脏页再异步刷回磁盘。热点数据留在内存里的比例越高，磁盘压力越小。见 [Buffer Pool](../02-storage-and-logging/chapter-02-buffer-pool.md)。
3. **数据按主键组织**。InnoDB 使用聚簇索引，行数据存放在主键 B+ 树的叶子节点里，二级索引的叶子节点存主键值。主键的长度和取值方式直接影响二级索引的大小和写入是否产生页分裂。见 [B+ 树索引](../03-index/chapter-01-btree-index.md)。
4. **复制优先的扩展**。读能力不足时先靠主从复制和读写分离分担，单机容量或写入吞吐到上限后再评估分库分表，而不是先拆库。见[复制与扩展架构](../07-replication-and-architecture/chapter-01-binlog-replication.md)。

## 适用与不适用

MySQL 适合以在线事务处理为主、读写并发较高、能通过主从复制扩展读能力的业务：请求以点查、范围查和短事务为主，数据量在单机容量内可控。

遇到以下情况，应先重新评估数据模型、数据库产品和架构，而不是只加参数：

- 查询以复杂分析、大范围聚合为主，在线事务只占小头；
- 需要跨地域的强一致多写，而主从复制的写入路径无法满足；
- 单机容量或写入吞吐到达上限，且压缩、归档、分区已无法缓解。

选版本、比较 MariaDB，或决定使用云 RDS 还是自建时，见[版本、产品与部署选型](../10-practice/chapter-01-version-and-selection.md)。

## 继续阅读

- 想知道一条 SQL 如何执行：阅读[整体架构](./chapter-02-architecture.md)。
- 想知道数据如何落盘、崩溃后如何恢复：阅读[数据页与行格式](../02-storage-and-logging/chapter-01-data-page.md)。
- 查询变慢、需要判断执行方式：阅读[查询执行流程与 EXPLAIN](../04-query-optimization/chapter-01-execution-plan.md)。
- 并发读写冲突、死锁排查：阅读[事务与锁：综览](../05-transaction-lock/chapter-01-overview.md)。
- 遇到中文、emoji 或排序比较问题：阅读[字符集与排序规则](../06-sql-and-schema/chapter-01-charset-collation.md)。
- 想从任务入口开始：返回[MySQL 专项首页](../index.md)。
