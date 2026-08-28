# PostgreSQL 技术体系

聚焦 PG 自身特性，不讲标准 SQL 基础。从「PG 到底特殊在哪」到「生产环境怎么运维」。

## 目录

### 01-PG到底特殊在哪

- [为什么选 PostgreSQL](01-pg-unique/chapter-01-why-pg) — 设计哲学、核心优势、选型决策
- [MVCC 机制](01-pg-unique/chapter-02-mvcc) — xmin/xmax、快照可见性、Dead Tuple
- [VACUUM 机制](01-pg-unique/chapter-03-vacuum) — VACUUM vs VACUUM FULL、autovacuum、表膨胀治理
- [类型系统](01-pg-unique/chapter-04-type-system) — 数组、范围、枚举、复合类型、UUID

### 02-PG 的 SQL 能力强在哪

- [窗口函数](02-sql-power/chapter-01-window-function) — ROW_NUMBER/RANK/LAG/LEAD、窗口帧
- [CTE 与递归](02-sql-power/chapter-02-cte-recursive) — WITH 语法、递归查询、树形遍历
- [JSONB](02-sql-power/chapter-03-jsonb) — 操作符、GIN 索引、实战场景
- [全文搜索](02-sql-power/chapter-04-full-text-search) — tsvector/tsquery、中文分词
- [PG 独有的 DML](02-sql-power/chapter-05-returning-dml) — RETURNING、UPSERT、FILTER、DISTINCT ON、LATERAL

### 03-索引是 PG 的第二把利器

- [索引类型](03-indexing/chapter-01-index-types) — B-tree/GIN/GiST/BRIN/Hash
- [索引设计](03-indexing/chapter-02-index-design) — 部分索引、表达式索引、覆盖索引
- [EXPLAIN 深入](03-indexing/chapter-03-explain) — 执行计划、统计信息、查询处理流程
- [表分区](03-indexing/chapter-04-partitioning) — 范围/列表/哈希分区、分区裁剪

### 04-并发控制

- [隔离级别](04-transactions/chapter-01-isolation-levels) — Read Committed、SSI
- [锁机制](04-transactions/chapter-02-locking) — 表锁/行锁/死锁/SKIP LOCKED
- [咨询锁](04-transactions/chapter-03-advisory-lock) — 应用层分布式锁
- [并发实战](04-transactions/chapter-04-concurrency-patterns) — 热点行、乐观锁、冲突处理

### 05-存储过程与触发器

- [PL/pgSQL 基础](05-plpgsql/chapter-01-plpgsql-basics) — 函数、变量、控制流、异常处理
- [触发器](05-plpgsql/chapter-02-triggers) — 行级/语句级、事件触发器
- [什么时候用存储过程](05-plpgsql/chapter-03-when-to-use) — 决策指南

### 06-性能优化

- [配置调优](06-performance/chapter-01-config-tuning) — shared_buffers、work_mem、autovacuum 参数
- [查询优化](06-performance/chapter-02-query-optimization) — 反模式、JOIN 优化、批量操作
- [性能监控](06-performance/chapter-03-monitoring) — pg_stat_statements、慢查询分析
- [扩展策略](06-performance/chapter-04-scaling) — 连接池、读写分离

### 07-高可用与复制

- [流复制](07-ha/chapter-01-streaming-replication) — 同步/异步、复制槽
- [逻辑复制](07-ha/chapter-02-logical-replication) — 发布/订阅、版本升级
- [高可用方案](07-ha/chapter-03-ha-solutions) — Patroni、repmgr
- [备份恢复](07-ha/chapter-04-backup-restore) — pg_dump、PITR、pgBackRest

### 08-扩展与生态

- [扩展机制](08-ecosystem/chapter-01-extension-system) — CREATE EXTENSION、常用扩展
- [FDW 外部数据](08-ecosystem/chapter-02-fdw) — 跨库查询、数据联邦
- [垂直领域扩展](08-ecosystem/chapter-03-specialized) — PostGIS、TimescaleDB、pgvector

### 09-日常运维

- [用户与安全](09-ops/chapter-01-user-security) — 角色体系、RLS、SSL
- [日常维护](09-ops/chapter-02-maintenance) — VACUUM/ANALYZE/REINDEX 调度
- [数据迁移](09-ops/chapter-03-migration) — 版本升级、跨平台迁移

### 参考手册

- [参数速查](reference/parameters) — 核心配置参数
- [类型速查](reference/types) — 数据类型一览
- [函数速查](reference/functions) — 常用函数
- [错误码速查](reference/errors) — 常见错误

### 教程

- [MySQL 转 PG](tutorials/mysql-to-pg) — MySQL 用户迁移指南
- [首次生产部署](tutorials/first-production) — 上线清单
