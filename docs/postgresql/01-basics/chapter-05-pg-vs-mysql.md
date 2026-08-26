---
doc_id: pg-PG与MySQL对比
title: PostgreSQL vs MySQL 全面对比
---

# PostgreSQL vs MySQL 全面对比

> **核心问题**：什么时候选 PostgreSQL？什么时候选 MySQL？两者核心差异是什么？

## 1. 它解决了什么问题？

MySQL 在某些场景下力不从心，PostgreSQL 针对这些场景做了专项优化：

| 场景 | MySQL 的问题 | PostgreSQL 的解决方案 |
| :--- | :--- | :--- |
| **JSON 数据存储与查询** | JSON 支持较弱，无法高效索引 JSON 字段 | 原生 JSONB（二进制存储，可建 GIN 索引） |
| **复杂分析查询** | 窗口函数、CTE 递归查询支持不完整（8.0 前） | 完整支持 ROW_NUMBER/RANK/LAG 等窗口函数 |
| **地理信息处理** | 无专用 GIS 索引 | GiST 索引 + PostGIS 扩展 |
| **严格的 SQL 标准** | GROUP BY 等场景较宽松 | 严格遵循 SQL 标准 |

## 2. 生活类比：专业厨师 vs 家常厨师

| 对比 | MySQL | PostgreSQL |
| :--- | :--- | :--- |
| **定位** | 家常厨师：简单快手，适合日常 | 专业厨师：功能全面，适合复杂菜肴 |
| **优势** | 简单 CRUD 性能好，生态成熟 | 复杂查询、JSON、GIS 场景更强 |
| **劣势** | 高级特性支持有限 | 运维复杂，国内生态相对较少 |

## 3. 核心差异对比表

| 维度 | PostgreSQL | MySQL | 选择依据 |
| :--- | :--- | :--- | :--- |
| **JSON 支持** | 原生 JSONB（二进制存储，可索引） | JSON 类型支持较弱，索引能力有限 | 需要存储和查询 JSON 选 PG |
| **索引类型** | B-tree / Hash / GIN / GiST / BRIN | 主要是 B-tree，全文索引有限 | 需要全文检索/GIS 选 PG |
| **窗口函数** | 完整支持（ROW_NUMBER/RANK/LAG 等） | MySQL 8.0+ 才支持，早期版本不支持 | 需要复杂分析查询选 PG |
| **事务隔离** | 支持真正的 Serializable（SSI） | Serializable 通过锁实现，性能差 | 需要严格串行化选 PG |
| **MVCC 实现** | 多版本行存储（堆表中保留旧版本） | Undo Log 回滚段（独立存储） | PG 需要 VACUUM，MySQL 自动回收 |
| **表继承** | 支持（面向对象特性） | 不支持 | 分区表场景 |
| **SQL 标准** | 严格遵循 SQL 标准 | 部分宽松（如 GROUP BY 不严格） | 需要严格 SQL 标准选 PG |
| **国内生态** | 相对较少，但增长迅速 | 成熟，文档/工具丰富 | 团队熟悉度和生态支持 |
| **适用场景** | 复杂查询、JSON、GIS、分析型 | 高并发读写、互联网业务 | 根据业务特点选择 |

## 4. 选型决策

| 选 PostgreSQL | 选 MySQL |
| :--- | :--- |
| 需要存储和查询 JSON/JSONB 数据 | 高并发简单读写（如电商商品列表） |
| 需要复杂分析查询（窗口函数、CTE） | 团队对 MySQL 更熟悉，生态更成熟 |
| 地理信息系统（配合 PostGIS） | 需要简单快速部署 |
| 需要严格的 SQL 标准 | 国内云厂商支持更完善 |

> **选型建议**：需要复杂查询、JSON 存储、地理信息、严格事务 → 选 PG；需要极致读写性能、成熟生态、简单部署 → 选 MySQL。

## 5. 常见问题

**Q：PostgreSQL 和 MySQL 最核心的区别是什么？**

> 三个核心差异：① **功能丰富度**：PG 支持原生 JSONB（可索引）、完整窗口函数、GIN/GiST 等多种索引类型；② **MVCC 实现**：PG 将旧版本行存储在堆表中，需要 VACUUM 清理；MySQL 使用 Undo Log，事务提交后自动回收，无表膨胀问题；③ **SQL 标准**：PG 更严格，MySQL 在 GROUP BY 等场景下较宽松。

**Q：什么时候选 PostgreSQL，什么时候选 MySQL？**

> 需要 JSON 存储查询、复杂分析（窗口函数/CTE）、地理信息（PostGIS）、严格 SQL 标准 → 选 PG；高并发简单读写、团队熟悉 MySQL、需要成熟生态 → 选 MySQL。
