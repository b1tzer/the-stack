---
type: howto
level: intermediate
---

# EF Core 迁移：让表结构随代码演进

本页说明如何用迁移（migration）管理数据库结构变更，让表结构与实体模型保持一致。前置：已建立 `DbContext` 和实体（见[EF Core](./chapter-02-ef-core.md)）。读完你能安全地新增、应用和回退数据库结构变更。

## 1. 迁移解决什么

实体模型会变：加字段、改类型、加表。迁移把这些结构变更写成可版本化、可回放的代码，使数据库结构随代码演进，而不是手工改表。

迁移的核心产物是一系列带时间戳的迁移文件，记录「从上一版结构到这一版结构」的变更。团队通过提交这些文件，保证每个人的数据库结构一致。

## 2. 创建迁移

安装工具后，用 `dotnet ef` 命令创建迁移：

```txt
dotnet ef migrations add AddBlogCategory
```

这条命令对比当前模型与上次迁移的模型，生成 `AddBlogCategory` 迁移文件，包含 `Up`（应用变更）和 `Down`（回退变更）两个方法。生成后先检查迁移内容，确认只包含预期的变更，再提交。

## 3. 应用迁移

把迁移应用到数据库：

```txt
dotnet ef database update
```

开发时直接更新本地库。生产环境通常不运行此命令，而是生成 SQL 脚本由 DBA 审阅执行：

```txt
dotnet ef migrations script --idempotent -o migration.sql
```

生成幂等 SQL 脚本，便于在受控环境中审查和部署。生产数据库结构变更应走脚本评审流程，而不是应用启动时自动迁移。

## 4. 迁移与版本控制

迁移文件应纳入版本控制，与实体模型变更一起提交。这样：

- 回退代码时，能同时回退到对应的迁移。
- 多人协作时，迁移按时间顺序排列，合并冲突显式可见。

迁移的顺序敏感：合并分支时若两个迁移基于同一父迁移，会冲突，需要手动解决顺序。

## 5. 回退与删除

回退一个迁移：

```txt
dotnet ef database update PreviousMigration
```

删除尚未应用的最后一个迁移文件：

```txt
dotnet ef migrations remove
```

回退要谨慎：`Down` 方法可能删除数据（如 `DropColumn`），执行前确认没有不可逆的数据丢失。

## 6. 失败信号与回退

应用迁移可能失败，常见信号：

- **迁移已部分应用**：数据库有部分变更，但迁移记录未更新。此时数据库处于不一致状态，需人工核对实际结构。
- **锁等待/超时**：迁移的表被并发会话占用，重试或选择低峰期执行。
- **数据不兼容**：改字段类型但现有数据无法转换（如字符串转数字），需先清洗数据再迁移。

失败后先确认数据库实际状态，再决定重试还是回退，不要盲目重复执行迁移命令。

## 7. 后续阅读

- [EF Core](./chapter-02-ef-core.md)解释迁移所依据的模型与上下文。
- [查询与调优](./chapter-03-query-tuning.md)解释结构变更对查询的影响。
- [测试](./chapter-05-testing.md)解释如何用测试库验证迁移。

> 本页的技术边界按 .NET 10 / C# 14 核对；`dotnet ef` 工具通过 `dotnet tool install --global dotnet-ef` 安装。官方参考：[EF Core 迁移](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/)。
