---
type: explanation
level: advanced
---

# 索引与执行计划：慢查询的头号根因

本页回答三个问题：索引如何加速查询，执行计划如何看懂，哪些写法会让索引失效。查询调优见[查询与调优](./chapter-03-query-tuning.md)。

## 1. 索引的原理

数据库用 B-tree 索引加速查找。没有索引时，`WHERE` 需要扫描整张表（全表扫描）；有索引时，可以按索引快速定位到匹配的行。

```sql
-- 没有索引：全表扫描
SELECT * FROM Users WHERE Email = 'a@b.com';

-- 在 Email 上建索引后：走索引，O(log n) 定位
CREATE INDEX IX_Users_Email ON Users(Email);
```

索引是「以空间换时间」：每个索引都占用额外存储，且增删改时需要维护索引。索引不是越多越好，只在**真正用于过滤的列**上建。

## 2. 执行计划

执行计划是数据库「如何执行一条 SQL」的说明：用了哪个索引、是索引查找还是全表扫描、各步骤的代价。分析慢查询的第一步是看执行计划：

```txt
EXPLAIN SELECT * FROM Users WHERE Email = 'a@b.com';
```

关注点：

- **是否走索引**：`Index Seek`（索引查找）好，`Table Scan`/`Full Scan`（全表扫描）通常意味着缺索引。
- **扫描行数**：扫描行数远大于返回行数，说明过滤效率低。

`Index Seek` 是精准定位，`Table Scan` 是逐行扫。看到 `Table Scan` 且表很大，先检查过滤列是否有索引。

## 3. 复合索引与最左前缀

多个条件查询时，复合索引按「最左前缀」匹配：

```sql
CREATE INDEX IX_Orders_Status_Created ON Orders(Status, CreatedAt);
```

这个索引能加速 `WHERE Status = ...` 和 `WHERE Status = ... AND CreatedAt > ...`，但**不能**加速 `WHERE CreatedAt > ...`（跳过了最左的 `Status` 列）。复合索引的列顺序要按查询的过滤顺序设计。

## 4. 索引失效的常见写法

即使有索引，以下写法也可能让它失效：

- **在索引列上做函数/运算**：`WHERE YEAR(CreatedAt) = 2025` 无法走索引，应改写为 `CreatedAt >= '2025-01-01' AND CreatedAt < '2026-01-01'`。
- **前导通配符**：`LIKE '%abc'` 无法走索引，`LIKE 'abc%'` 可以。
- **隐式类型转换**：字符串列和数字比较会触发转换，索引失效。
- **列间比较**：`WHERE ColA = ColB` 通常不走索引。

原则是让过滤条件「直接、无转换地」落在索引列上。

## 5. 慢查询的排查流程

1. 用数据库的慢查询日志或 `EXPLAIN` 定位慢 SQL。
2. 看执行计划，确认是全表扫描还是索引查找。
3. 缺索引 → 在过滤列上建索引（复合索引按最左前缀设计）。
4. 索引失效 → 改写查询，消除函数、通配符、类型转换。
5. 量化验证：看执行计划从 `Table Scan` 变为 `Index Seek`，耗时下降。

慢查询的头号原因几乎总是「缺索引」或「索引失效」，而不是 ORM 本身（见[查询与调优](./chapter-03-query-tuning.md)）。先看执行计划，再决定建索引还是改写 SQL。

## 6. 后续阅读

- [查询与调优](./chapter-03-query-tuning.md)解释 LINQ 转 SQL 与 N+1。
- [EF Core](./chapter-02-ef-core.md)解释 ORM 生成的查询。
- [事务与隔离级别](./chapter-08-transactions-isolation.md)解释锁与索引的关系。

> 本页的技术边界按 .NET 10 / C# 14 核对；执行计划与索引行为随数据库实现（SQL Server/PostgreSQL/MySQL）有差异。官方参考：[SQL Server 索引](https://learn.microsoft.com/en-us/sql/relational-databases/indexes/)。
