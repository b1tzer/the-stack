# PostgreSQL 知识库

本页负责选择入口。PostgreSQL 的概念、版本和选型背景见[第一篇“认识 PostgreSQL”](./01-pg-unique/chapter-01-pg-overview.md)。

## 从问题进入

| 你现在的问题 | 入口 |
| :-- | :-- |
| 第一次接触 PostgreSQL | [认识 PostgreSQL](./01-pg-unique/chapter-01-pg-overview.md) |
| 查询变慢或执行计划变化 | [查询优化](./07-performance/chapter-02-query-optimization.md) |
| 需要解释锁等待或并发冲突 | [事务隔离](./05-transactions/chapter-01-isolation-levels.md) |
| 担心表膨胀、事务 ID 或恢复问题 | [生产问题排查](./12-production-pitfalls/chapter-01-xid-wraparound.md) |
| 要安装、建库或准备生产部署 | [首次建库教程](./tutorials/first-db.md) |

## 按目录浏览

- **特性与架构**：[PostgreSQL 特性](./01-pg-unique/chapter-01-pg-overview.md)、[进程与内存](./02-architecture/chapter-01-process-memory.md)、[WAL](./02-architecture/chapter-02-wal.md)。
- **SQL 与索引**：[SQL 能力](./03-sql-power/chapter-01-window-function.md)、[索引设计](./04-indexing/chapter-02-index-design.md)、[执行计划](./04-indexing/chapter-03-explain.md)。
- **并发与性能**：[事务隔离](./05-transactions/chapter-01-isolation-levels.md)、[配置调优](./07-performance/chapter-01-config-tuning.md)、[监控](./08-monitoring/chapter-01-pg-stat-views.md)。
- **运维与参考**：[复制与高可用](./09-ha/chapter-01-streaming-replication.md)、[生产运维](./11-ops/chapter-01-user-security.md)、[参考手册](./reference/parameters.md)。

## 内容边界

与 MySQL 的机制差异和选型问题进入[MySQL 知识库](../mysql/index.md)，读写分离、分库分表等业务方案进入[场景实战](../scenarios/index.md)。
