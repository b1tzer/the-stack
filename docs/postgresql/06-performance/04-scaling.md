---
doc_id: pg-scaling
title: 连接池与扩展
---

# 连接池与扩展

> **核心问题**：为什么需要连接池？PgBouncer 怎么配？连接池模式怎么选？

## 1. 为什么需要连接池

PostgreSQL 每个连接都是一个独立进程（fork），消耗约 10MB 内存。`max_connections` 不宜设太大（通常 200-500），需要连接池来复用连接。

## 2. PgBouncer 配置

```ini
# /etc/pgbouncer/pgbouncer.ini

[databases]
mydb = host=127.0.0.1 port=5432 dbname=mydb
mydb_ro = host=192.168.1.102 port=5432 dbname=mydb

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt

# 连接池模式
pool_mode = transaction  # session|transaction|statement

# 连接数限制
max_client_conn = 1000   # 最大客户端连接数
default_pool_size = 25    # 每个数据库的连接池大小
min_pool_size = 5
reserve_pool_size = 5

# 超时设置
server_idle_timeout = 300
server_lifetime = 3600
query_wait_timeout = 120
```

## 3. 连接池模式对比

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| session | 连接绑定会话，会话结束才释放 | 使用会话级变量、PREPARE |
| transaction | 事务结束即释放连接 | **推荐大多数场景** |
| statement | 语句结束即释放（不支持多语句事务） | 极少数场景 |

> **最佳实践**：大多数场景使用 `transaction` 模式。如果应用使用了 `SET` 命令、临时表、会话级变量，需要使用 `session` 模式。

## 4. Spring Boot 集成

```yaml
spring:
  datasource:
    url: jdbc:postgresql://pgbouncer-host:6432/mydb
    username: app_user
    password: secret
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
      connection-timeout: 30000
      idle-timeout: 600000
      max-lifetime: 1800000
```

## 5. PgBouncer 管理

```bash
# 管理命令
psql -p 6432 -U admin pgbouncer
SHOW POOLS;     -- 查看连接池状态
SHOW CLIENTS;   -- 查看客户端连接
SHOW SERVERS;   -- 查看服务器连接
SHOW STATS;     -- 查看统计信息
RELOAD;         -- 重载配置
```

## 6. Pgpool-II 对比

| 特性 | PgBouncer | Pgpool-II |
|------|-----------|-----------|
| 连接池 | ✅ | ✅ |
| 负载均衡 | ❌ | ✅ |
| 复制 | ❌ | ✅ |
| 复杂度 | 低 | 高 |

## 7. 连接池最佳实践

| 实践 | 说明 |
|------|------|
| 使用 transaction 模式 | 大多数场景最优 |
| 合理设置 pool_size | 建议 = CPU 核心数 × 2 + 磁盘数 |
| 配合应用连接池 | PgBouncer + HikariCP |
| 监控等待队列 | `cl_waiting > 0` 说明连接池不足 |
| 避免长事务 | 长事务占用连接池连接，影响其他请求 |
