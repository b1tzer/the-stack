# MySQL 概览

MySQL 是由 Oracle 维护的开源关系型数据库管理系统。对后端开发者而言，最有价值的入口不是功能清单，而是理解一条 SQL 如何进入服务层、如何由 InnoDB 执行，以及日志、索引和事务如何共同决定性能与一致性。

## 核心组成

| 组成 | 解决的问题 | 继续阅读 |
| :-- | :-- | :-- |
| 连接层与服务层 | 接收请求、解析 SQL、生成执行计划 | [整体架构](./chapter-02-architecture.md) |
| InnoDB 存储引擎 | 组织数据页、缓存、崩溃恢复和并发事务 | [存储与日志](../02-storage-and-logging/chapter-01-data-page.md) |
| 索引与优化器 | 缩小候选行范围并选择代价较低的执行方式 | [B+ 树索引](../03-index/chapter-01-btree-index.md) |
| 事务、MVCC 与锁 | 保证并发事务的隔离，并协调读写冲突 | [事务与锁](../05-transaction-lock/chapter-01-overview.md) |
| 复制与日志 | 同步变更、恢复数据并支持故障切换 | [复制与扩展架构](../07-replication-and-architecture/chapter-01-binlog-replication.md) |

InnoDB 是 MySQL 的默认存储引擎，也是本专项的主要讨论对象。它通过 Buffer Pool 降低磁盘访问，通过 Redo Log 保证崩溃恢复，通过 Undo Log 和 Read View 支持 MVCC，通过索引与锁协调并发读写。

## 适用场景

MySQL 适合以在线事务处理为主、读写并发较高、能通过主从复制扩展读能力的业务。遇到复杂分析、跨地域强一致多写或单机容量上限时，需要重新评估数据模型、数据库产品和架构，而不是只增加参数。

选版本、比较 MariaDB，或决定使用云 RDS 还是自建时，见[版本、产品与部署选型](../10-practice/chapter-01-version-and-selection.md)。

## 继续阅读

- 想知道一条 SQL 如何执行：阅读[整体架构](./chapter-02-architecture.md)。
- 遇到中文、emoji 或排序比较问题：阅读[字符集与排序规则](./chapter-03-charset-collation.md)。
- 想从任务入口开始：返回[MySQL 专项首页](../index.md)。
