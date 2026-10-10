# 版本、产品与部署选型

选型先确定三个约束：项目能否按季度升级、团队是否有专职 DBA、现有生态依赖哪个数据库。下面的建议以 2026-10-08 核验的信息为界；版本下载入口和生命周期发生变化时，以官方页面为准。

选择完成后的部署步骤见[安装部署](./chapter-02-installation.md)；判断 MySQL 是否适合业务场景，先读[MySQL 概览](../01-basics/chapter-01-overview.md)。

## 1. 选择 MySQL 版本

| 版本线 | 当前判断 | 适用条件 |
| :-- | :-- | :-- |
| 5.7 | 已停止官方支持 | 不应新部署；只能作为迁移前的历史环境 |
| 8.0 | 2026-04 结束支持 | 仅用于尚未完成迁移的存量项目 |
| 8.4 LTS | 长期支持版本 | 需要稳定升级节奏的生产项目 |
| Innovation | 功能更新快，支持窗口短 | 能按发布节奏升级、需要新特性的测试或创新环境 |

不要只看版本号大小。LTS 以稳定行为和较长支持周期为目标；Innovation 会更早引入功能、行为变化和废弃项。选择版本前，先到 [MySQL Community Downloads](https://dev.mysql.com/downloads/mysql/)确认当前可下载版本，再到 [Oracle Lifetime Support](https://www.oracle.com/support/lifetime-support/resources.html)确认支持结束日期。

### 1.1 发布线与升级节奏

MySQL 将产品分成 Innovation 与 LTS 两条发布线。Innovation 适合持续吸收新功能；LTS 只接受必要的缺陷和安全修复，用于减少行为变化。约每两年会指定一个 LTS，支持周期通常为 5 年 Premier 加 3 年 Extended。

> 生产环境若不准备按 Innovation 发布节奏持续升级，应优先选择 LTS，并把中间版本升级、回滚和复制兼容性写入迁移计划。

## 2. 比较数据库产品

功能列表只能作为初筛。真正的比较应围绕当前业务约束：

| 维度 | 要确认的问题 |
| :-- | :-- |
| SQL 与类型语义 | 现有查询、排序、空值和 JSON 行为是否兼容 |
| 事务与并发 | 隔离级别、锁粒度和写冲突是否符合业务模型 |
| 生态与工具 | 驱动、ORM、备份、迁移和云服务是否成熟 |
| 运维能力 | 团队能否完成升级、监控、恢复和故障切换 |
| 供应链与许可 | 维护方、许可条款和长期支持是否可接受 |

跨数据库迁移不能只比较 TPS。基准测试的硬件、数据集、事务比例和并发设置都会改变结论；没有可复现环境时，不应把单次横评数字当作选型依据。

## 3. 评估版本能力

MySQL 8.0 引入窗口函数、CTE、原子 DDL 和更完整的 JSON 能力，也是当前许多存量应用的基线。使用这些能力前仍要确认最小支持版本：

```sql
SELECT name, salary,
       ROW_NUMBER() OVER (ORDER BY salary DESC) AS ranking
FROM employees;

WITH dept_stats AS (
  SELECT department_id, AVG(salary) AS avg_salary
  FROM employees
  GROUP BY department_id
)
SELECT * FROM dept_stats WHERE avg_salary > 10000;
```

升级到 8.4 或更新版本时，重点检查认证兼容、废弃参数、SQL 行为变化和复制拓扑，而不是只对照功能清单。8.0 与 8.4 都默认使用 `caching_sha2_password`；`mysql_native_password` 已弃用，旧客户端必须提前验证。

## 4. 选择产品与部署方式

### 4.1 MySQL 与兼容分支

选择 MySQL 或 MariaDB 等兼容分支时，至少比较维护方、支持政策、复制方案、存储引擎、驱动和云服务兼容性。项目已经依赖某个厂商的认证、审计、代理或迁移工具时，生态兼容通常比功能清单更重要。

### 4.2 云 RDS 与自建

| 条件 | 更适合云 RDS | 更适合自建 |
| :-- | :-- | :-- |
| 运维团队 | 没有专职 DBA，优先减少备份、升级和故障切换工作 | 有成熟 DBA 和自动化平台 |
| 变更控制 | 能接受云厂商的参数、插件和发布窗口限制 | 需要深度定制内核或基础设施 |
| 数据边界 | 数据和网络满足云平台合规要求 | 数据必须完全自主控制 |
| 成本模型 | 按量或包年成本可接受 | 长期规模稳定，自建摊销成本更低 |

先确定团队能否承担恢复演练、升级窗口和故障切换，再比较价格。云 RDS 不会自动替代应用侧的连接池、慢查询、容量和数据模型治理。

## 5. 选择结论

1. 新生产项目优先选择仍在支持期内的 LTS。
2. 只有具备持续升级能力时才采用 Innovation。
3. 存量 5.7 或 8.0 项目先制定迁移窗口，不在已结束支持的版本上继续扩张。
4. 没有专职 DBA 时优先评估云 RDS；有成熟运维平台时再比较自建成本和控制能力。
5. 产品比较先验证真实 SQL、驱动、备份恢复和故障切换，再看基准测试。

## 6. 参考资料

- MySQL 官方下载：[MySQL Community Server](https://dev.mysql.com/downloads/mysql/)
- MySQL 官方博客：[Introducing MySQL Innovation and Long-Term Support (LTS) versions](https://dev.mysql.com/blog-archive/introducing-mysql-innovation-and-long-term-support-lts-versions/)
- Oracle：[Lifetime Support Policy](https://www.oracle.com/support/lifetime-support/resources.html)
- MySQL 参考手册：[Pluggable Authentication（8.4）](https://dev.mysql.com/doc/refman/8.4/en/pluggable-authentication.html)
