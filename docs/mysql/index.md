# MySQL 专项

本专项面向已经掌握基础 SQL、需要理解和优化 MySQL 生产系统的后端开发者。阅读目标是建立可解释行为的内部模型，并能据此完成索引设计、查询分析、事务排查和生产运维。

## 先建立原理模型

1. 从 [MySQL 概览](./01-basics/chapter-01-overview.md)和[整体架构](./01-basics/chapter-02-architecture.md)理解请求如何经过连接层、服务层和存储引擎。
2. 通过[存储与日志](./02-storage-and-logging/chapter-01-data-page.md)掌握数据页、Buffer Pool、Redo Log、Undo Log 和 Binlog 的职责边界。
3. 按“[索引](./03-index/chapter-01-btree-index.md) → [执行计划](./04-query-optimization/chapter-01-execution-plan.md) → [事务与锁](./05-transaction-lock/chapter-01-overview.md)”的顺序理解查询为什么变慢以及并发为什么冲突。
4. 需要横向扩展时，继续阅读[复制与架构](./07-replication-and-architecture/chapter-01-binlog-replication.md)。

## 按任务查阅

- 新项目：先做[版本、产品与部署选型](./01-basics/chapter-04-version-and-selection.md)，再完成[安装部署](./10-practice/chapter-02-installation.md)和[首次生产部署](./10-practice/chapter-03-first-production.md)。
- 排查故障：从[常见问题](./10-practice/chapter-04-common-issues.md)进入，再回到对应的索引、事务锁、连接或运维章节。
- 优化性能：先阅读[性能调优流程](./10-practice/chapter-05-performance-tuning.md)，再查[索引优化](./03-index/chapter-04-index-optimization.md)和[查询优化](./04-query-optimization/chapter-01-execution-plan.md)。
- 管理生产实例：进入[运维管理](./08-operations/chapter-01-backup-restore.md)，按备份、监控、安全、维护和迁移任务选择页面。

## 速查入口

需要确认事实时使用[参数速查](./reference/parameters.md)、[数据类型速查](./reference/types.md)、[函数速查](./reference/functions.md)或[错误码速查](./reference/errors.md)。速查页不承担原理讲解；需要判断条件或风险时，从页面中的回链进入对应说明。
