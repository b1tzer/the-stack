---
doc_id: pg-ref-errors
title: 错误速查表
---

# 错误速查表

## 连接错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `connection refused` | 服务未启动或端口不对 | 检查 `systemctl status postgresql` |
| `no pg_hba.conf entry` | 认证配置不允许连接 | 修改 `pg_hba.conf`，添加客户端 IP |
| `password authentication failed` | 密码错误 | 检查用户名密码 |
| `too many connections` | 连接数已满 | 增大 `max_connections` 或使用连接池 |
| `database does not exist` | 数据库不存在 | 检查数据库名 |

## 语法错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `syntax error at or near` | SQL 语法错误 | 检查 SQL 语法 |
| `column does not exist` | 列名不存在 | 检查表结构 `\d table` |
| `relation does not exist` | 表名不存在 | 检查表名和 schema |
| `type does not exist` | 类型不存在 | 检查类型名 |
| `function does not exist` | 函数不存在 | 检查函数名和参数类型 |

## 约束错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `duplicate key value violates unique constraint` | 唯一约束冲突 | 检查数据或使用 `ON CONFLICT` |
| `violates foreign key constraint` | 外键约束冲突 | 先插入被引用表的数据 |
| `violates not-null constraint` | NOT NULL 约束冲突 | 提供非空值 |
| `violates check constraint` | CHECK 约束冲突 | 检查数据是否满足条件 |
| `permission denied` | 权限不足 | `GRANT` 授权 |

## 锁相关错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `deadlock detected` | 死锁 | 固定加锁顺序，缩短事务 |
| `canceling statement due to lock timeout` | 锁等待超时 | 增大 `lock_timeout` |
| `canceling statement due to statement timeout` | 语句超时 | 增大 `statement_timeout` |

## 资源错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `out of memory` | 内存不足 | 减小 `work_mem` 或增大服务器内存 |
| `could not extend file` | 磁盘空间不足 | 清理磁盘空间 |
| `too many open files` | 文件描述符不足 | 增大 `ulimit -n` |

## 复制错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `replication slot is active` | 复制槽被占用 | 检查复制槽状态 |
| `WAL file not found` | WAL 文件被清理 | 使用复制槽防止 WAL 被清理 |
| `could not connect to primary` | 无法连接主库 | 检查网络和认证配置 |

## 常用排查命令

```sql
-- 查看当前活动连接
SELECT pid, usename, state, query FROM pg_stat_activity;

-- 查看锁等待
SELECT * FROM pg_locks WHERE NOT granted;

-- 终止长时间运行的查询
SELECT pg_terminate_backend(pid) FROM pg_stat_activity 
WHERE state = 'active' AND now() - query_start > interval '5 minutes';

-- 查看表大小
SELECT pg_size_pretty(pg_total_relation_size('table_name'));

-- 查看数据库大小
SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database;
```
