---
type: explanation
level: advanced
---

# 事务与隔离级别：并发下的正确性

本页回答三个问题：事务如何保证一组操作的一致性，隔离级别如何权衡正确性与并发，脏读、不可重复读、幻读是什么。数据访问基础见[ADO.NET 与连接池](./chapter-06-adonet.md)。

## 1. 事务与 ACID

事务把一组操作绑定为原子单元：要么全部成功提交，要么全部回滚。转账的「扣款 + 入账」必须在同一事务里，否则中途失败会造成钱凭空消失或出现：

```csharp
using var connection = new SqlConnection(connectionString);
await connection.OpenAsync();

using var transaction = await connection.BeginTransactionAsync();
try
{
    Debit(connection, transaction, from, amount);
    Credit(connection, transaction, to, amount);
    await transaction.CommitAsync();
}
catch
{
    await transaction.RollbackAsync();
    throw;
}
```

ACID 中与并发最相关的是**隔离性（Isolation）**：多个事务并发执行时，彼此如何互相影响。

## 2. 三种并发异常

隔离性不足会导致三类并发问题：

| 问题 | 描述 |
| :-- | :-- |
| 脏读 | 读到别的事务尚未提交的修改 |
| 不可重复读 | 同一事务两次读同一行，结果不同（别的事务改了并提交） |
| 幻读 | 同一事务两次查询，结果集多出或少了几行（别的事务插/删了） |

隔离级别决定了哪些问题会被阻止。

## 3. 隔离级别

SQL 标准定义四个隔离级别，从低到高：

| 级别 | 阻止脏读 | 阻止不可重复读 | 阻止幻读 |
| :-- | :-- | :-- | :-- |
| Read Uncommitted | 否 | 否 | 否 |
| Read Committed | 是 | 否 | 否 |
| Repeatable Read | 是 | 是 | 否 |
| Serializable | 是 | 是 | 是 |

默认通常是 **Read Committed**：阻止脏读，但允许不可重复读和幻读。更高的级别通过加更多锁或快照实现，代价是并发降低。

设置隔离级别：

```csharp
using var transaction = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted);
```

选择级别是权衡：级别越高越正确，但锁越多、并发越低。多数业务用 Read Committed 即可，只有确实需要「同一事务内重复读一致」时才上 Repeatable Read 或 Serializable。

## 4. TransactionScope vs DbTransaction

`TransactionScope` 是更高层的分布式事务抽象，可跨多个连接甚至多个资源：

```csharp
using (var scope = new TransactionScope(
    TransactionScopeAsyncFlowOption.Enabled))
{
    // 多个操作，自动纳入一个事务
    scope.Complete(); // 全部成功后提交
}
```

`DbTransaction` 绑定单个连接，`TransactionScope` 可跨连接（必要时升级为分布式事务）。分布式事务开销大且复杂，能用单连接事务就不要升级到分布式。EF Core 的 `SaveChanges` 默认用单连接事务。

## 5. 事务边界

事务应尽可能短：持有事务会持有锁，事务越长，阻塞其他事务越久。原则：

- 事务内只放必须原子的数据库操作。
- 不在事务内做远程调用、I/O、耗时计算。
- 提交/回滚后尽快释放连接。

## 6. 后续阅读

- [ADO.NET 与连接池](./chapter-06-adonet.md)解释连接与 `DbTransaction`。
- [EF Core](./chapter-02-ef-core.md)解释 ORM 如何管理事务。
- [索引与执行计划](./chapter-09-indexes-execution.md)解释锁与索引的关系。

> 本页的技术边界按 .NET 10 / C# 14 核对；隔离级别由 SQL 标准定义，各数据库实现有差异。官方参考：[.NET 事务](https://learn.microsoft.com/en-us/dotnet/framework/data/transactions/)、[隔离级别](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-transaction-isolation-level-transact-sql)。
