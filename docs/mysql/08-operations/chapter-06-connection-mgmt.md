# 连接管理

> 本页处理连接参数、连接池和连接故障；整体请求路径见[整体架构](../01-basics/chapter-02-architecture.md)，排障入口见[常见问题](../10-practice/chapter-04-common-issues.md)。

## 1. 连接基础架构

```txt
客户端 → TCP 连接 → 连接线程 → 线程池
                ↓
        max_connections（最大连接数）
                ↓
        wait_timeout（空闲超时）
```

## 2. 核心参数

### 2.1 最大连接数

```sql
-- 查看当前连接数
SHOW STATUS LIKE 'Threads_connected';
SHOW STATUS LIKE 'Max_used_connections';

-- 查看最大连接数配置
SHOW VARIABLES LIKE 'max_connections';

-- 动态调整（重启失效）
SET GLOBAL max_connections = 500;

-- 永久生效：修改 my.cnf
[mysqld]
max_connections = 500
```

### 2.2 连接超时

```sql
-- 连接超时（握手阶段）
SHOW VARIABLES LIKE 'connect_timeout';  -- 默认 10 秒

-- 空闲连接超时
SHOW VARIABLES LIKE 'wait_timeout';  -- 默认 28800 秒（8 小时）
SHOW VARIABLES LIKE 'interactive_timeout';  -- 交互式连接超时

-- 建议设置
SET GLOBAL wait_timeout = 600;  -- 10 分钟
SET GLOBAL interactive_timeout = 600;
```

### 2.3 错误连接限制

```sql
-- 连续错误连接限制（防暴力破解）
SHOW VARIABLES LIKE 'max_connect_errors';  -- 默认 100

-- 达到限制后报错
-- Host 'xxx' is blocked because of many connection errors

-- 解除封锁
FLUSH HOSTS;
-- 或增大限制
SET GLOBAL max_connect_errors = 10000;
```

## 3. 连接池配置

### 3.1 应用层连接池

```yaml
# HikariCP (Java)
spring:
  datasource:
    hikari:
      maximum-pool-size: 20      # 最大连接数
      minimum-idle: 5            # 最小空闲连接
      idle-timeout: 600000       # 空闲超时 10 分钟
      max-lifetime: 1800000      # 连接最大存活时间 30 分钟
      connection-timeout: 30000  # 获取连接超时 30 秒
```

### 3.2 连接池大小计算

```txt
连接数 = (CPU 核心数 * 2) + 有效磁盘数

示例：
- 4 核 CPU
- 1 块 SSD
- 连接数 = (4 * 2) + 1 = 9

公式来源：PostgreSQL 官方建议，同样适用于 MySQL
```

### 3.3 连接池监控

```sql
-- 查看连接状态
SHOW PROCESSLIST;
SHOW FULL PROCESSLIST;

-- 查看连接统计
SHOW STATUS LIKE 'Connections';        -- 总连接数
SHOW STATUS LIKE 'Threads_connected';  -- 当前活跃连接
SHOW STATUS LIKE 'Threads_running';    -- 当前执行查询的连接
SHOW STATUS LIKE 'Aborted_connects';   -- 失败连接数
SHOW STATUS LIKE 'Aborted_clients';    -- 异常断开的客户端
```

## 4. Too Many Connections 排查

### 4.1 错误信息

```txt
ERROR 1040 (HY000): Too many connections
```

### 4.2 紧急处理

```sql
-- 1. 查看当前连接
SHOW PROCESSLIST;

-- 2. 杀掉空闲连接
SELECT CONCAT('KILL ', id, ';') 
FROM information_schema.processlist 
WHERE command = 'Sleep' AND time > 600;

-- 3. 临时增大连接数
SET GLOBAL max_connections = 1000;
```

### 4.3 根因分析

```sql
-- 1. 检查慢查询
SHOW VARIABLES LIKE 'slow_query_log';
SHOW VARIABLES LIKE 'long_query_time';

-- 2. 检查锁等待
SELECT * FROM information_schema.innodb_lock_waits;

-- 3. 检查连接来源
SELECT 
    SUBSTRING_INDEX(host, ':', 1) AS client_host,
    COUNT(*) AS connection_count
FROM information_schema.processlist
GROUP BY client_host
ORDER BY connection_count DESC;

-- 4. 检查连接状态
SELECT 
    command,
    COUNT(*) AS count
FROM information_schema.processlist
GROUP BY command;
```

## 5. 代理层连接池

### 5.1 ProxySQL

```sql
-- 配置连接池
INSERT INTO mysql_users (username, password, default_hostgroup)
VALUES ('app_user', 'password', 1);

-- 配置连接复用
UPDATE global_variables SET variable_value = '200' 
WHERE variable_name = 'mysql-max_connections';

-- 配置空闲连接超时
UPDATE global_variables SET variable_value = '6000' 
WHERE variable_name = 'mysql-wait_timeout';

LOAD MYSQL VARIABLES TO RUNTIME;
SAVE MYSQL VARIABLES TO DISK;
```

### 5.2 MySQL Router

```ini
# MySQL Router 配置
[DEFAULT]
logging_folder = /var/log/mysqlrouter

[routing:read_write]
bind_address = 0.0.0.0
bind_port = 6446
destinations = 127.0.0.1:3306
mode = read-write
max_connections = 1024

[routing:read_only]
bind_address = 0.0.0.0
bind_port = 6447
destinations = 127.0.0.1:3307,127.0.0.1:3308
mode = read-only
max_connections = 2048
```

## 6. 连接相关状态变量

```sql
-- 连接统计
SHOW STATUS LIKE 'Connections';           -- 所有连接（包括失败）
SHOW STATUS LIKE 'Threads_connected';     -- 当前连接数
SHOW STATUS LIKE 'Threads_created';       -- 创建的线程数
SHOW STATUS LIKE 'Threads_cached';        -- 缓存的线程数
SHOW STATUS LIKE 'Threads_running';       -- 正在执行的线程数

-- 错误统计
SHOW STATUS LIKE 'Aborted_connects';      -- 连接失败次数
SHOW STATUS LIKE 'Aborted_clients';       -- 客户端异常断开次数

-- 连接复用
SHOW STATUS LIKE 'Max_used_connections';  -- 历史最大连接数
SHOW STATUS LIKE 'Max_used_connections_time'; -- 最大连接数发生时间
```

## 7. 连接数规划

`max_connections` 是数据库接受连接的上限，不是应用容量目标。规划时先估算所有应用实例、代理、运维连接和突发余量之和，再用压测与线上峰值验证。

```txt
数据库连接上限 ≥
  应用实例数 × 单实例连接池上限
  + 代理和运维连接
  + 故障切换期间的重连余量
```

| 规模信号 | 规划动作 |
| :-- | :-- |
| `Max_used_connections` 持续接近上限 | 先查连接池、长事务和泄漏，再评估提高上限 |
| `Threads_connected` 高但 `Threads_running` 低 | 优先处理空闲连接、超时和连接复用 |
| 应用连接获取等待明显 | 检查应用池大小、查询耗时和代理队列 |
| 多实例部署 | 按实例数量汇总连接池，不按日活直接换算 |

完成峰值压测后再为 `max_connections` 留出余量。代理层是否启用连接复用，应根据协议能力、事务语义和故障恢复行为决定，而不是仅由业务规模决定。

## 8. 最佳实践

| 配置项 | 推荐值 | 说明 |
| :-- | :-- | :-- |
| max_connections | 由峰值连接规划决定 | 同时覆盖应用池、代理、运维和重连余量 |
| wait_timeout | 与连接池空闲回收策略一致 | 避免服务端过早回收仍可能复用的连接 |
| interactive_timeout | 与 wait_timeout 一致 | 仅在客户端行为明确时调整 |
| max_connect_errors | 10000 | 防止误封 |
| connect_timeout | 10 | 连接超时 |

### 8.1 应用层建议

```txt
1. 使用连接池，不要每次创建新连接
2. 连接用完及时归还
3. 设置合理的连接超时
4. 监控连接池使用率
5. 避免长事务占用连接
```

### 8.2 数据库层建议

```txt
1. 根据峰值连接规划设置 max_connections
2. 配合 ProxySQL 做连接复用
3. 监控 Threads_connected 告警
4. 由连接池和超时策略回收空闲连接
5. 使用 SHOW PROCESSLIST 排查问题
```
