# MySQL 概览

## 1. 认识 MySQL

### 1.1 什么是 MySQL

MySQL 是最流行的开源关系型数据库管理系统，由 Oracle 维护。

### 1.2 版本选择

| 版本 | 特性 | 状态 | 推荐 |
|------|------|------|------|
| 5.7 | 稳定，JSON 支持 | 2023-10 停止支持 | ❌ 不推荐 |
| 8.0 | 窗口函数、CTE、JSON 增强 | 活跃 | 现有项目 |
| 8.4 | LTS，性能优化，安全增强 | 长期支持 | ✅ 新项目首选 |
| 9.0 | Innovation 版本，最新特性 | 快速迭代 | 测试环境 |

### 1.3 与 PostgreSQL/MariaDB/Oracle 对比

| 特性 | MySQL | PostgreSQL | MariaDB | Oracle |
|------|-------|-----------|---------|--------|
| 开源 | ✅ (GPL) | ✅ (PostgreSQL) | ✅ (GPL) | ❌ |
| 事务 | InnoDB 支持 | 原生支持 | InnoDB/XtraDB | 原生支持 |
| JSON | 8.0+ 增强 | JSONB 原生 | 10.2+ 支持 | 支持 |
| 复制 | 主从/GTID/MGR | 流复制/逻辑复制 | 主从/Galera | Data Guard |
| 窗口函数 | 8.0+ | ✅ | 10.2+ | ✅ |
| 许可证 | GPL (Oracle) | PostgreSQL | GPL (社区) | 商业 |
| 适用场景 | 互联网/高并发 | 企业级/复杂查询 | 兼容 MySQL | 金融/电信 |

#### 1.3.1 性能基准（sysbench OLTP）

sysbench 是评估 MySQL/PostgreSQL/MariaDB 最常用的基准工具，`oltp_read_write` 负载模拟典型 Web 应用（每事务约 18 次读、6 次写）。第三方横评在相同硬件下测得的结果（2026，单位 TPS，越高越好）：

| 并发线程 | MariaDB 11 | MySQL 8.4 | PostgreSQL 17 |
| :-- | --: | --: | --: |
| 16 | 2,840 | 2,920 | 3,180 |
| 64 | 8,200 | 8,540 | 9,800 |
| 256 | 11,200 | 11,800 | 14,400 |

在混合读写 OLTP 场景下，MySQL 与 MariaDB 基本持平（同源于 InnoDB 存储引擎），PostgreSQL 在更高并发下略有优势。性能不是选型的决定性因素，**功能需求与生态匹配才是**。

> — [MariaDB 11 vs MySQL 8.4 vs PostgreSQL 17 OLTP Benchmark（2026）](https://dargslan.com/blog/mariadb-11-vs-mysql-8-4-vs-postgresql-17-oltp-benchmark-2026)

### 1.4 存储引擎

```sql
-- 查看支持的存储引擎
SHOW ENGINES;

-- 常用引擎
-- InnoDB: 事务、行锁、外键（默认）
-- MyISAM: 不支持事务、表锁（已过时）
-- Memory: 内存表、重启丢失
```

## 2. 发展历史

MySQL 的起点是一个真实的生产瓶颈，源于创始人自研工具的局限。

### 2.1 起因：UNIREG 无法支撑 Web

1979 年，芬兰程序员 Michael Widenius（网名 Monty）为瑞典公司 TcX 开发了基于 ISAM 的内部数据库工具 **UNIREG**。1994 年 TcX 开始开发 Web 应用，需要给 UNIREG 加上 SQL 接口。团队评估了当时流行的轻量级数据库 **mSQL**（David Hughes 开发），结论是 mSQL **不支持索引、性能不够**。Monty 联系 Hughes 提议把 UNIREG 的 ISAM 存储层接入 mSQL，被拒绝——Hughes 已在开发自己的 mSQL 2。

于是 Monty 决定自己实现：基于 UNIREG 的快速存储层，套用与 mSQL 几乎相同的 API，方便已有 mSQL 用户迁移。1995 年 5 月 23 日，MySQL 首次发布。

### 2.2 谁在主导

| 人物 | 角色 |
| :-- | :-- |
| Michael "Monty" Widenius | 核心作者，独自编写了大部分代码 |
| David Axmark | 联合创始人，提出「开源 + 商业支持」的双许可模式 |
| Allan Larsson | 联合创始人，负责公司运营 |

三人于 1995 年共同成立瑞典公司 **MySQL AB**。「MySQL」的名字来自 Monty 的长女 **My**（后来他分叉出的 MariaDB 则取自幼女 Maria）。

### 2.3 收购史与现在的维护者

| 时间 | 事件 |
| :-- | :-- |
| 1995 | MySQL AB 成立，发布 MySQL |
| 2000 | 采用 GPL 开源 |
| 2008 | Sun Microsystems 以约 10 亿美元收购 MySQL AB |
| 2010 | Oracle 收购 Sun，MySQL 归属 Oracle |

现在 MySQL 由 **Oracle** 维护。Oracle 的收购引发了社区担忧：Monty 在 Oracle 宣布收购 Sun 的当天就 fork 出 **MariaDB**，并带走一批核心开发者，理由是担心 Oracle 不会善待 MySQL 社区版。MariaDB 成为 MySQL 最主流的开源替代分支（详见 §5.1）。

### 2.4 发版节奏

自 2023 年起，Oracle 将 MySQL 拆成两条发布线：

| 发布线 | 版本举例 | 节奏 | 支持策略 |
| :-- | :-- | :-- | :-- |
| **LTS**（长期支持） | 8.0、8.4 | 约每 2 年一个 | 5 年 Premier + 3 年 Extended |
| **Innovation**（创新） | 8.1~8.3、9.x | 每季度一个 | 仅维护到下一个版本发布 |

8.4 LTS（2024-04）是首个 LTS，支持至 2032 年；8.0 于 2026-04 EOL。

> 常见误区是「版本号越大支持越久」：9.x 版本号比 8.4 新，但支持窗口只有几个月；8.4 LTS 却支持到 2032 年。生产环境若不打算每季度滚动升级，应选 LTS。

## 3. 适用场景

**适合使用 MySQL 的场景：**
- 互联网 Web 应用（读多写少）
- OLTP 联机事务处理
- 中小规模数据量（单表千万级以内）
- 高并发读写（InnoDB 行锁）
- 需要主从复制、读写分离的架构

**不太适合的场景：**
- 复杂的分析查询（OLAP）→ 考虑 ClickHouse、TiDB
- 海量数据存储 → 考虑分布式数据库
- 强一致性多写场景 → 考虑 CockroachDB

## 4. 版本新特性

### 4.1 MySQL 8.0 核心新特性

```sql
-- 1. 窗口函数
SELECT name, salary,
    ROW_NUMBER() OVER (ORDER BY salary DESC) AS ranking
FROM employees;

-- 2. CTE (Common Table Expression)
WITH dept_stats AS (
    SELECT department_id, AVG(salary) AS avg_salary
    FROM employees GROUP BY department_id
)
SELECT * FROM dept_stats WHERE avg_salary > 10000;

-- 3. JSON 增强
SELECT JSON_OBJECT('name', name, 'salary', salary) FROM employees LIMIT 5;

-- 4. 不可见索引（测试索引删除影响）
ALTER TABLE employees ALTER INDEX idx_name INVISIBLE;
-- 确认无影响后删除
ALTER TABLE employees ALTER INDEX idx_name VISIBLE;

-- 5. 原子 DDL
DROP TABLE IF EXISTS t1, t2;  -- 要么全成功，要么全失败
```

### 4.2 MySQL 8.4 LTS 新特性详解

MySQL 8.4 是首个 LTS（长期支持）版本，适合生产环境。

#### 4.2.1 生命周期

```
8.4 LTS: 2024 年发布，支持至 2032 年
8.0: 2018-2026（创新版本，快速迭代）
9.x: 创新版本线，每季度发布
```

#### 4.2.2 核心改进

```sql
-- 1. Redo Log 动态调整（8.0.30+ 已有，8.4 优化）
ALTER INSTANCE ROTATE INNODB MASTER KEY;
SET GLOBAL innodb_redo_log_capacity = 2147483648;  -- 2GB

-- 2. 组复制增强
-- 自动选举、流控优化、可观测性提升
SET GLOBAL group_replication_consistency = 'BEFORE_ON_PRIMARY_FAILOVER';

-- 3. 安全增强
-- 默认使用 caching_sha2_password 认证插件
-- 密钥环组件改进
CREATE USER 'app'@'%' IDENTIFIED WITH caching_sha2_password BY 'StrongP@ss123';

-- 4. 性能优化
-- 查询执行计划改进
-- InnoDB 后台线程优化
-- 临时表空间管理改进
```

#### 4.2.3 与 8.0 的区别

| 特性 | 8.0 | 8.4 LTS |
|------|-----|--------|
| 支持周期 | 创新版本，快速迭代 | 长期支持至 2032 |
| 新特性 | 持续引入 | 仅安全/稳定性修复 |
| 默认认证 | mysql_native_password | caching_sha2_password |
| Redo Log | 静态配置 | 动态调整 |
| 推荐场景 | 追求新特性 | 生产环境首选 |

## 5. 选型指南

### 5.1 MySQL vs MariaDB 选型指南

MariaDB 是 MySQL 的分支，由原始创建者维护。

#### 5.1.1 核心差异

| 特性 | MySQL | MariaDB |
|------|-------|---------|
| 维护方 | Oracle | MariaDB Foundation |
| 存储引擎 | InnoDB | InnoDB + XtraDB + Aria |
| 语法兼容 | 官方标准 | 高度兼容 MySQL |
| JSON 支持 | 8.0+ 原生类型 | 10.2+ 函数支持 |
| 窗口函数 | 8.0+ | 10.2+ |
| 默认字符集 | utf8mb4 (8.0+) | utf8mb4 (10.2+) |
| 许可证 | GPL (Oracle) | GPL (社区) |

#### 5.1.2 选型建议

```
选 MySQL 的理由：
- 需要 Oracle 官方支持
- 使用 MySQL 专属特性（如 X DevAPI）
- 云厂商 RDS 通常 MySQL 兼容性更好
- 团队熟悉 MySQL 生态

选 MariaDB 的理由：
- 担心 Oracle 控制开源项目
- 需要 Galera 多主复制
- 需要 Aria 存储引擎（替代 MyISAM）
- 追求社区驱动的创新
```

### 5.2 云数据库（RDS）选型

#### 5.2.1 主流云 RDS 对比

| 云厂商 | 产品 | MySQL 版本 | 特点 |
|--------|------|-----------|------|
| 阿里云 | RDS MySQL | 5.7/8.0/8.4 | 最成熟，功能丰富 |
| 腾讯云 | TDSQL-C | 5.7/8.0 | Serverless，按量计费 |
| AWS | Aurora MySQL | 5.7/8.0 | 兼容 MySQL，性能 5x |
| 华为云 | RDS for MySQL | 5.7/8.0 | 国产化支持 |
| Google Cloud | Cloud SQL | 5.7/8.0 | 与 GCP 生态集成 |

#### 5.2.2 RDS vs 自建对比

| 特性 | 云 RDS | 自建 MySQL |
|------|-------|----------|
| 运维成本 | 低（托管） | 高（DBA） |
| 高可用 | 内置主从/故障切换 | 需自行搭建 |
| 备份 | 自动备份/PITR | 需自行配置 |
| 扩展 | 在线升配 | 需要停机迁移 |
| 成本 | 按量付费，长期较高 | 一次性投入，长期较低 |
| 灵活性 | 受限（参数/插件） | 完全控制 |
| 数据安全 | 依赖云厂商 | 完全掌控 |

#### 5.2.3 RDS 选型建议

```
推荐云 RDS 的场景：
- 团队无专职 DBA
- 业务需要快速上线
- 需要高可用和自动备份
- 预算充足，追求稳定性

推荐自建的场景：
- 有专业 DBA 团队
- 需要深度定制（参数/插件）
- 数据敏感，不能上云
- 成本敏感，长期运行
```

## 6. 最佳实践

1. **生产环境始终使用 InnoDB** — MyISAM 已过时，不支持事务和行锁
2. **统一使用 utf8mb4** — utf8 只支持 3 字节，无法存储 emoji
3. **主键选择 BIGINT AUTO_INCREMENT** — 避免 UUID 作为主键（随机写入导致页分裂）
4. **及时升级到 8.0+** — 5.7 已于 2023 年 10 月停止官方支持
5. **新项目选择 8.4 LTS** — 长期支持至 2032 年，稳定性优先
6. **评估是否需要上云** — 无 DBA 团队优先考虑云 RDS
7. **关注 MySQL vs MariaDB** — 根据团队和生态选择

## 7. 参考资料

- MySQL 官方手册：[The History of MySQL](https://docstore.mik.ua/orelly/weblinux2/mysql/ch01_02.htm)
- MySQL 官方博客：[Introducing MySQL Innovation and Long-Term Support (LTS) versions](https://dev.mysql.com/blog-archive/introducing-mysql-innovation-and-long-term-support-lts-versions)
- Wikipedia：[MySQL](https://en.wikipedia.org/wiki/MySQL)
- endoflife.date：[MySQL 版本与支持策略](https://endoflife.date/mysql)
- 第三方 benchmark：[MariaDB 11 vs MySQL 8.4 vs PostgreSQL 17 OLTP Benchmark](https://dargslan.com/blog/mariadb-11-vs-mysql-8-4-vs-postgresql-17-oltp-benchmark-2026)
