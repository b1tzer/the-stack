# 连接管理

## 1. 连接基础架构

```
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

```
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

```
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

## 7. 最佳实践

| 配置项 | 推荐值 | 说明 |
|--------|--------|------|
| max_connections | 200-500 | 根据业务调整 |
| wait_timeout | 300-600 | 5-10 分钟 |
| interactive_timeout | 300-600 | 与 wait_timeout 一致 |
| max_connect_errors | 10000 | 防止误封 |
| connect_timeout | 10 | 连接超时 |

### 7.1 应用层建议

```
1. 使用连接池，不要每次创建新连接
2. 连接用完及时归还
3. 设置合理的连接超时
4. 监控连接池使用率
5. 避免长事务占用连接
```

### 7.2 数据库层建议

```
1. 根据业务规模设置 max_connections
2. 配合 ProxySQL 做连接复用
3. 监控 Threads_connected 告警
4. 定期清理空闲连接
5. 使用 SHOW PROCESSLIST 排查问题
```

## 8. 连接数规划

```
单机 MySQL 连接数建议：

小型应用（日活 < 10万）
- max_connections = 200
- 连接池大小 = 10-20

中型应用（日活 10-100万）
- max_connections = 500
- 连接池大小 = 20-50
- 建议使用 ProxySQL

大型应用（日活 > 100万）
- max_connections = 1000+
- 必须使用 ProxySQL/MySQL Router
- 多实例读写分离
```
