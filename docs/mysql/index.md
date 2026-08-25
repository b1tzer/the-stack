# MySQL 技术体系

系统化的 MySQL 知识体系，从基础入门到 InnoDB 内核，从索引优化到高可用架构。

## 目录结构

### 01-basics
- [MySQL 概览](01-basics/chapter-01-overview) — 发展历史、版本选择、与 PG 对比
- [安装部署](01-basics/chapter-02-install-config) — 安装方式、my.cnf 核心参数
- [SQL 基础](01-basics/chapter-03-sql-basics) — DDL/DML/DCL、数据类型
- [整体架构](01-basics/chapter-04-architecture) — 连接层→服务层→存储引擎层
- [字符集与排序规则](01-basics/chapter-05-charset-collation) — utf8mb4、排序规则对索引的影响
- [SQL 规范与最佳实践](01-basics/chapter-06-sql-best-practices) — 命名规范、常见反模式、优化技巧

### 02-innodb-internals
- [Buffer Pool](02-innodb-internals/chapter-01-buffer-pool) — LRU、Change Buffer、AHI
- [数据页与行格式](02-innodb-internals/chapter-02-data-page) — 页结构、Compact/Dynamic
- [表空间](02-innodb-internals/chapter-03-tablespace) — 系统/独立/通用/临时/Undo
- [Redo Log](02-innodb-internals/chapter-04-redo-log) — WAL、Checkpoint、崩溃恢复
- [Undo Log](02-innodb-internals/chapter-05-undo-log) — MVCC、Read View、事务回滚

### 03-index
- [B+ 树索引](03-index/chapter-01-btree-index) — 聚簇索引、二级索引、回表
- [索引设计](03-index/chapter-02-index-design) — 覆盖索引、前缀索引、联合索引
- [索引使用](03-index/chapter-03-index-usage) — 索引失效场景、EXPLAIN 解读
- [索引优化](03-index/chapter-04-index-optimization) — ICP、MRR、索引合并

### 04-transaction-lock
- [事务与 MVCC](04-transaction-lock/chapter-01-transaction) — ACID、隔离级别、MVCC
- [锁机制](04-transaction-lock/chapter-02-lock) — 全局锁/表锁/行锁/间隙锁
- [死锁](04-transaction-lock/chapter-03-deadlock) — 检测、案例、避免策略
- [乐观锁](04-transaction-lock/chapter-04-optimistic-lock) — 版本号机制
- [锁选型：悲观锁 vs 乐观锁](04-transaction-lock/chapter-05-lock-selection) — 选型决策树、典型场景

### 05-query-optimization
- [查询执行流程](05-query-optimization/chapter-01-execution-plan) — 优化器、成本模型
- [EXPLAIN](05-query-optimization/chapter-02-explain) — type/key/Extra 解读
- [SQL 优化](05-query-optimization/chapter-03-sql-optimization) — 优化技巧、慢查询
- [连接优化](05-query-optimization/chapter-04-join-optimization) — NLJ/BNL/Hash Join
- [子查询优化](05-query-optimization/chapter-05-subquery-optimization) — 半连接、物化

### 06-advanced-features
- [窗口函数](06-advanced-features/chapter-01-window-function) — ROW_NUMBER/RANK/LAG
- [CTE](06-advanced-features/chapter-02-cte) — 递归查询
- [生成列](06-advanced-features/chapter-03-generated-column) — 函数索引
- [JSON](06-advanced-features/chapter-04-json) — JSON 类型、JSON 函数
- [分区表](06-advanced-features/chapter-05-partition) — 范围/列表/哈希分区
- [全文索引](06-advanced-features/chapter-06-fulltext-index) — 中文分词、布尔模式
- [存储过程与触发器](06-advanced-features/chapter-07-stored-procedure) — 谨慎使用场景

### 07-replication-ha
- [Binlog](07-replication-ha/chapter-00-binlog) — 两阶段提交、数据恢复基础
- [异步复制](07-replication-ha/chapter-01-binlog-replication) — 主从配置
- [GTID](07-replication-ha/chapter-02-gtid) — 自动定位
- [组复制](07-replication-ha/chapter-03-group-replication) — MGR
- [读写分离](07-replication-ha/chapter-04-read-write-split) — ProxySQL/MySQL Router
- [高可用方案](07-replication-ha/chapter-05-ha-solution) — MHA/Orchestrator/InnoDB Cluster

### 08-operations
- [备份恢复](08-operations/chapter-01-backup-restore) — mysqldump/xtrabackup/PITR
- [监控](08-operations/chapter-02-monitoring) — Performance Schema/sys/慢查询
- [安全](08-operations/chapter-03-security) — 权限体系/SSL/审计
- [用户管理](08-operations/chapter-04-user-management) — 角色、密码策略
- [日常维护](08-operations/chapter-05-maintenance) — OPTIMIZE/ANALYZE/CHECK
- [连接管理](08-operations/chapter-06-connection-mgmt) — 连接池、Too Many Connections 排查

### 09-scaling
- [分库分表](09-scaling/chapter-01-sharding) — ShardingSphere/Vitess
- [在线 DDL](09-scaling/chapter-02-online-ddl) — pt-osc/gh-ost
- [数据迁移](09-scaling/chapter-03-data-migration) — mydumper/DM
- [NewSQL](09-scaling/chapter-04-newsql) — TiDB/CockroachDB

### 10-practice
- [Spring 集成](10-practice/chapter-01-spring-integration) — JPA/MyBatis 适配
- [常见问题](10-practice/chapter-02-common-issues) — 避坑指南
- [性能调优](10-practice/chapter-03-performance-tuning) — 参数优化、架构优化
