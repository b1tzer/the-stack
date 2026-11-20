---
type: explanation
level: intermediate
---

# .NET 持久化思想：对象与关系、ORM 与事务

本页回答三个问题：面向对象的模型与关系数据库之间有什么根本差异，ORM 与直接 SQL 如何取舍，事务如何保证一致性。这是理解 EF Core 和 Dapper 的前提。

## 1. 对象与关系的阻抗失配

业务代码用对象建模（类、继承、集合），关系数据库用表和行建模。两者之间存在「阻抗失配」（impedance mismatch）：

- 对象的继承、集合导航，在关系模型里要拆成外键、连接表。
- 对象按图遍历（`order.Items`），关系数据按集合查询（`SELECT ... JOIN ...`）。
- 对象的生命周期是「加载-修改-保存」，数据库是「读-写-提交」。

持久化层负责在这两者之间转换。这个转换要么手动写 SQL 完成，要么交给 ORM。

## 2. 三种数据访问方式

.NET 提供三种层级的数据访问：

| 方式 | 特点 | 适用 |
| :-- | :-- | :-- |
| ADO.NET | 手动写 SQL、手动映射 | 极致性能、复杂 SQL |
| Dapper | 轻量 ORM，SQL 手动写、映射自动 | 性能敏感、SQL 熟练 |
| EF Core | 完整 ORM，LINQ 转 SQL、变更追踪 | 常规业务 CRUD |

EF Core 用 LINQ 查询、自动生成 SQL、跟踪实体变更（见[EF Core](./chapter-02-ef-core.md)）；Dapper 保留手写 SQL 但自动映射结果；ADO.NET 最底层、最灵活也最繁琐。

选择依据：常规业务用 EF Core 提高效率；性能热点或复杂报表用 Dapper/ADO.NET 手写 SQL。二者可共存——EF Core 处理 CRUD，Dapper 处理关键查询。

## 3. ORM 的收益与代价

ORM 的收益：

- 用 LINQ 表达查询，编译期检查、可重构。
- 自动映射查询结果到对象，减少样板。
- 变更追踪：跟踪实体的修改，`SaveChanges` 时只更新变化的部分。

ORM 的代价：

- 生成 SQL 不一定最优，复杂查询可能低效。
- 抽象泄漏：`Include`、延迟加载等行为影响查询次数，不理解底层会写出 N+1（见[查询与调优](./chapter-03-query-tuning.md)）。
- 变更追踪占用内存，批量操作不如手写 SQL。

用 ORM 不等于不懂 SQL。理解 ORM 生成的 SQL，才能写出高效的查询。

## 4. 事务

事务保证一组操作要么全部成功、要么全部回滚。关系数据库通过事务提供原子性：

```csharp
using var transaction = connection.BeginTransaction();
try
{
    Debit(from, amount);
    Credit(to, amount);
    transaction.Commit();
}
catch
{
    transaction.Rollback();
    throw;
}
```

转账的「扣款 + 入账」必须在同一事务里，否则中途失败会造成钱凭空消失或凭空出现。EF Core 的 `SaveChanges` 默认在一个事务里提交所有变更。

事务的一致性取决于隔离级别：读已提交、可重复读等，在并发下表现不同。理解隔离级别与锁，才能避免脏读、不可重复读和幻读。

## 5. 连接管理

数据库连接是昂贵资源，必须复用而非每次创建。ADO.NET 用连接池（connection pooling）复用连接，EF Core 和 Dapper 都建立在连接池之上：

```csharp
// 不要每次操作都 new 连接；用 using 让连接尽快归还池
using var connection = new SqlConnection(connectionString);
connection.Open();
// 使用 connection
// using 结束时连接归还池，而不是真正关闭
```

连接字符串通常含连接池配置（最大池大小等）。连接泄漏（拿到连接不归还）会耗尽连接池，表现为「获取连接超时」——这是数据访问最常见的故障之一。

## 6. 后续阅读

- [EF Core](./chapter-02-ef-core.md)解释完整 ORM 的用法。
- [查询与调优](./chapter-03-query-tuning.md)解释 LINQ 转 SQL 与 N+1 问题。
- [迁移](./chapter-04-migrations.md)解释数据库结构如何随代码演进。
- [测试](./chapter-05-testing.md)解释如何测试数据访问。

> 本页的技术边界按 .NET 10 / C# 14 核对；EF Core 与 Dapper 是 .NET 上最常用的两种数据访问方式。官方参考：[EF Core 文档](https://learn.microsoft.com/en-us/ef/core/)、[Dapper](https://github.com/DapperLib/Dapper)。
