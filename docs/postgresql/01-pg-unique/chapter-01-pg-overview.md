---
doc_id: pg-overview
title: 认识 PostgreSQL
---

# 认识 PostgreSQL

> PostgreSQL 的历史、核心能力与适用场景。

## 1. 概述

PostgreSQL（常简称 Postgres）是一个开源的**对象-关系型数据库管理系统（ORDBMS）**，用 C 语言编写，采用宽松的类 BSD 许可证。

官方给自己的定位是"全球最先进的开源关系数据库"。这个定位不谦虚，但 PG 确实有几个其他开源数据库没有的东西：

| 特征 | 说明 |
| :-- | :-- |
| **SQL 标准** | 严格遵循，兼容性最强 |
| **可扩展性** | 类型、索引、函数、语言都能自定义 |
| **数据完整性** | 约束与触发器完善 |
| **MVCC** | 多版本并发控制，读写互不阻塞 |

## 2. 历史与起源

PG 的源头是加州大学伯克利分校（UC Berkeley）的 **POSTGRES 项目**，1986 年由 **Michael Stonebraker（迈克尔·斯通布雷克）** 主导启动。他是数据库领域奠基性人物，2014 年因"对现代数据库系统底层概念与实践的根本性贡献"获得图灵奖。

POSTGRES 这个名字道出了它的血缘——**"Post Ingres"**，意为"Ingres 之后"。Ingres 是 Stonebraker 在 1973–1985 年领导的伯克利早期关系数据库项目，POSTGRES 正是它的后继者。

| 阶段 | 时间 | 性质 |
| :-- | :-- | :-- |
| Ingres | 1973–1985 | 伯克利早期关系数据库项目 |
| POSTGRES | 1986–1994 | 研究型原型，无 SQL，专注对象-关系模型 |
| Postgres95 | 1994–1996 | 两个伯克利研究生给它加上 SQL 解释器 |
| PostgreSQL | 1996-07-08 | 开源社区接管，发布首个版本 6.0 |

所以"设计人"分两层：**架构奠基者是 Stonebraker 和他的伯克利团队**，今天维护它的是社区（见 [§9](#who-maintains)）。Stonebraker 本人早已不参与日常开发。

### 起源动机

POSTGRES 不是要做一个新产品抢市场，而是源于 Ingres 暴露出的架构局限，属学术研究驱动：

1. **类型系统僵化**。Ingres 时期的关系模型只能存固定类型，无法表达复杂数据。Stonebraker 想做的是允许**用户自定义类型、操作符、索引方法**的数据库。
2. **数据完整性靠应用层兜底**。早期关系数据库缺少声明式约束，POSTGRES 引入了更完整的主键、外键、检查约束，把完整性规则写进数据库本身。
3. **对象-关系模型的实验**。这是 POSTGRES 最核心的学术贡献：在关系模型之上叠加"对象"能力（复杂类型、继承、可扩展类型系统），试图融合关系数据库与面向对象数据库两派优点。

**Ingres 解决了"怎么存关系数据"，POSTGRES 要回答"下一代数据库怎么做得更通用、更可扩展"**。1994 年补上 SQL 之后，它才从研究原型变成工程上可用的产品。

## 3. 市场份额与流行度

### 3.1 DB-Engines 全球排名

DB-Engines 是业界最权威的数据库流行度排名，综合搜索热度、讨论频率、招聘需求等指标。截至 2026 年 6 月：

| 排名 | 数据库 | 得分 | 月变化 | 年变化 |
| :-- | :-- | :-- | :-- | :-- |
| 1 | Oracle | 1140.04 | -3.24 | -90.35 |
| 2 | MySQL | 856.29 | -0.21 | -97.29 |
| 3 | SQL Server | 698.04 | -2.95 | -78.71 |
| **4** | **PostgreSQL** | **688.23** | **+5.55** | **+7.58** |

> 前四名中，**只有 PostgreSQL 实现了月度和年度双增长**。其他三家全部下跌。PostgreSQL 距离 SQL Server 仅差 9.81 分，按当前增速，预计 2026 年内超越 SQL Server，打破维持二十年的 Oracle-MySQL-SQL Server 铁三角格局。
>
> — [DB-Engines 排名（2026-06）](https://db-engines.com/en/ranking) / [墨天轮分析](https://www.modb.pro/db/2064162363633393664)

PostgreSQL 曾 **4 次** 获得 DB-Engines "年度数据库" 奖（2017、2018、2019、2023），是获奖次数最多的数据库。

### 3.2 Stack Overflow 开发者调查

Stack Overflow 年度开发者调查是全球最大的开发者调研，样本量超 6 万人：

| 年份 | PostgreSQL 使用率 | 排名 | 趋势 |
| :-- | :-- | :-- | :-- |
| 2022 | 43.6% | #2 | — |
| 2023 | 45.6% | #1 | ↑ 首次登顶 |
| 2024 | 48.7% | #1 | ↑ 连续两年 |
| 2025 | 55.6% | #1 | ↑ 历史最大年增幅（+7pp） |

PostgreSQL 已连续三年蝉联 "最受欢迎数据库" "最想使用数据库" "最受认可数据库" 三项冠军。

> — [Stack Overflow 2025 开发者调查](https://survey.stackoverflow.co/2025/) / [Stack Overflow 2024 开发者调查](https://survey.stackoverflow.co/2024/)

### 3.3 资本市场投票

2025 年，PostgreSQL 生态发生了超过 **12.5 亿美元** 的资本运作：

| 事件 | 金额 | 说明 |
| :-- | :-- | :-- |
| Databricks 收购 Neon | ~10 亿美元 | PostgreSQL 云原生 Serverless 厂商 |
| Supabase D 轮融资 | 20 亿美元估值 | PostgreSQL 后端即服务 |
| Snowflake 收购 Crunchy Data | ~2.5 亿美元 | PostgreSQL 企业发行版 |
| 微软发布 Azure HorizonDB | — | 基于 PostgreSQL 协议的 AI 原生数据库 |

> 全球最大的数据公司和云厂商，不约而同地将筹码押在了 PostgreSQL 上。

## 4. 性能跑分（Benchmark）

### 4.1 pgbench 内置基准

pgbench 是 PG 自带的 TPC-B 式压测工具，适合快速评估硬件和配置：

```bash
# 初始化（scale=100 约 1000 万行）
pgbench -i -s 100 mydb

# 运行 60 秒，32 并发
pgbench -c 32 -j 8 -T 60 mydb
```

典型结果（8 核 32GB 内存，NVMe SSD，PG 16 默认配置）：

| 并发数 | TPS | 平均延迟 | 99% 延迟 |
| :-- | :-- | :-- | :-- |
| 1 | ~2,500 | 0.4ms | 0.8ms |
| 8 | ~18,000 | 0.44ms | 1.2ms |
| 32 | ~45,000 | 0.71ms | 2.5ms |
| 64 | ~52,000 | 1.23ms | 5.8ms |
| 128 | ~48,000 | 2.67ms | 12.3ms |

> 以上为参考值，实际性能取决于硬件、配置（shared_buffers、work_mem）、数据规模等因素。

### 4.2 TPC-C 事务处理（OLTP）

TPC-C 是业界标准的 OLTP 基准测试，模拟电商订单场景（新订单、付款、查询、配送、库存）。

使用 BenchmarkSQL 测试工具，典型结果对比：

| 数据库 | tpmC（8 核） | tpmC（32 核） | 说明 |
| :-- | :-- | :-- | :-- |
| PostgreSQL 16 | ~12,000 | ~45,000 | 默认配置，单节点 |
| MySQL 8.0 (InnoDB) | ~12,500 | ~42,000 | 默认配置，单节点 |

> 在标准 OLTP 场景下，PG 与 MySQL 性能基本持平。PG 的优势在复杂查询（并行查询、JIT 编译）和高级特性（JSONB、窗口函数）。
>
> — [BenchmarkSQL 工具](https://github.com/benchmarksql/benchmarksql) / [EDB TPC-C 测试教程](https://www.enterprisedb.com/blog/how-to-run-a-complex-postgres-benchmark-tpc-c-pgbench)

### 4.3 复杂查询（OLAP）

PG 在复杂分析查询上有明显优势，得益于**并行查询**和 **JIT 编译**：

| 场景 | PostgreSQL 16 | MySQL 8.0 | 说明 |
| :-- | :-- | :-- | :-- |
| 多表 JOIN + 聚合 | 1x（基准） | 2-5x 慢 | PG 并行查询优势 |
| 窗口函数 | 1x | 3-8x 慢 | PG 原生优化更成熟 |
| JSONB 路径查询 | 1x | 5-10x 慢 | PG 的 GIN 索引 + 二进制 JSONB |
| CTE 递归查询 | 1x | 不支持/有限 | PG 递归 CTE 完整支持 |

> **选型结论**：纯 OLTP 场景两者性能相当；涉及复杂查询、JSONB、空间数据、向量检索等场景，PG 有显著优势。性能不是选型的决定性因素，**功能需求和生态匹配才是**。

## 5. 核心能力

### 3.1 类型系统

PG 的类型系统是开源数据库里最丰富的：

- **数组类型**：`TEXT[]`、`INT[]`，支持 GIN 索引
- **范围类型**：`tsrange`、`int4range`，支持 `@>` 包含查询
- **JSONB**：二进制存储，支持 GIN 索引，查询性能远超文本 JSON
- **枚举、复合类型、DOMAIN**：自定义类型体系
- **网络地址**：`INET`、`CIDR`，支持网络运算

### 3.2 索引类型

PG 提供的索引类型远不止 B-tree：

| 索引类型 | 适用场景 |
| :-- | :-- |
| B-tree | 通用，等值/范围/排序 |
| GIN | JSONB、数组、全文检索 |
| GiST | 地理信息、范围类型 |
| BRIN | 超大时序表，索引极小 |
| Hash | 纯等值查询 |

### 3.3 SQL 能力

PG 的 SQL 方言在开源数据库里最强：

- **窗口函数**：完整支持
- **CTE 递归**：查询树形结构
- **RETURNING**：INSERT/UPDATE/DELETE 后直接返回数据
- **INSERT ON CONFLICT**：原生 UPSERT
- **FILTER 子句**：条件聚合
- **DISTINCT ON**：PG 独有语法
- **LATERAL JOIN**：相关子查询优化

### 3.4 事务与并发

- 默认 Read Committed
- **SSI**：真正的 Serializable，乐观并发控制
- **4 种行锁**：FOR UPDATE / FOR NO KEY UPDATE / FOR SHARE / FOR KEY SHARE
- **咨询锁**：PG 独有的应用层锁
- **SKIP LOCKED**：任务队列利器

### 3.5 扩展生态

PG 的扩展机制让它不只是一个数据库：

- `pg_stat_statements`：查询统计
- `pg_trgm`：模糊搜索
- `pgvector`：向量搜索（AI 场景）
- `TimescaleDB`：时序数据
- `PostGIS`：空间数据
- `pg_cron`：定时任务

---

## 6. 与 MySQL 的主要差异

如果你从 MySQL 过来，这些是最值得注意的区别：

**MVCC 实现**：PG 把旧版本直接存回原表（堆表），读写互不阻塞，但需要定期 VACUUM 清理死元组。MySQL 用 Undo Log 存旧版本，空间回收交给后台线程，不需要手动维护，但高并发长事务下 Undo Log 膨胀是常见问题。

**SQL 标准遵循**：MySQL 的 GROUP BY 可以不写全聚合字段，PG 必须写全——这看起来是"不灵活"，实际上是帮你避免写出结果不确定的查询。

| 维度 | PostgreSQL | MySQL |
| :-- | :-- | :-- |
| **SQL 标准** | 严格遵循 | 部分宽松（如 GROUP BY） |
| **可扩展性** | 类型、索引、语言均可扩展 | 扩展能力有限 |
| **数据完整性** | 强，约束和触发器完善 | 部分约束不支持 |
| **MVCC 实现** | 旧版本存堆表，需 VACUUM | Undo Log，自动回收 |

## 7. 选型参考

**选 PG 的典型场景：**

- 数据结构复杂，JSONB、数组、范围类型用得多
- 查询复杂，窗口函数、CTE、子查询是日常
- 需要地理信息（PostGIS）、向量搜索（pgvector）等扩展
- 对 SQL 标准合规性有要求

**不选 PG 的常见原因：**

- 高并发简单 CRUD，读写性能优先
- 团队对 MySQL 更熟悉，生态更成熟
- 国内云厂商支持更完善，部署更简单
- 不需要 PG 那些高级特性，够用就行

## 8. 版本与生态

### 本站覆盖范围

本站聚焦 **v14 / v15 / v16** 版本，覆盖 JSONB、窗口函数、CTE、MVCC/VACUUM 等核心特性。

![PostgreSQL 关键版本](/pg/timeline.svg)

### 发布节奏

自 PG 10（2017 年）起，发布节奏固定：

- 每年秋季（9 月底）发布一个大版本，每个大版本支持期约 **5 年**。
- 小版本（修复版）按季度发布，固定在 2 / 5 / 8 / 11 月的第二个周四。
- 大版本升级用 `pg_upgrade` 就地完成，无需 dump/reload。

### 当前状态（2026-08）

官方最新稳定版是 **18.6**，19 已进入 Beta 3，预计 2026 年 9 月正式发布；正在维护的版本线为 14–18，其中 14 将于 2026-11-12 停止修复（EOL）。

近年特性演进方向：JSONB（9.4）、逻辑复制与物理复制增强、并行查询、分区表性能、JIT 编译（11）、增量物化视图，以及 18 引入的异步 I/O 子系统。生态层靠扩展驱动——PostGIS（空间）、pgvector（向量检索）、TimescaleDB（时序）、Citus（分布式）。

## 9. 社区与维护 {#who-maintains}

**维护主体是 PostgreSQL Global Development Group（PGDG）**，一个全球开发者社区，不属于任何一家公司。

- **无单一厂商掌控**。版权归 PGDG，宽松许可证允许任何人免费使用、修改甚至闭源商用，从根上杜绝了"某家公司把 PG 商业化后闭源"的锁定风险。
- **治理结构**：一个小型 Core Team 负责整体方向与发布管理；几十名长期贡献者拥有 commit 权限；贡献来自多家公司（EDB、Microsoft、Amazon、Google、Crunchy Data 等），但公司只贡献代码，不拥有项目。
- **安全运维**：PGDG 统一发版、统一披露 CVE 安全公告，跟进官方小版本即可获得修复。

运维生态分两层：

| 模式 | 说明 | 适用场景 |
| :-- | :-- | :-- |
| **自建自管** | 社区源码 + 二进制包（`apt.postgresql.org` 等） | 有 DBA 团队的场景 |
| **托管服务** | 云厂商（AWS RDS、Azure、GCP Cloud SQL/AlloyDB）与专门公司（EDB、Crunchy Data、Neon、Supabase、Timescale） | 缺运维团队或追求弹性 |
