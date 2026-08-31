# MySQL 错误码速查

## 常见连接错误

| 错误码 | 含义 | 常见原因 | 解决方案 |
|--------|------|----------|----------|
| 1045 | Access denied | 密码错误或用户无权限 | 检查用户名密码，`GRANT` 授权 |
| 1040 | Too many connections | 连接数超限 | 增大 `max_connections` 或排查连接泄漏 |
| 2003 | Can't connect to MySQL | 服务未启动或网络不通 | 检查 mysqld 状态、防火墙、bind-address |
| 2006 | MySQL server has gone away | 连接超时或包过大 | 增大 `wait_timeout` 和 `max_allowed_packet` |
| 2013 | Lost connection | 网络中断 | 检查网络稳定性，增大 `net_read_timeout` |

## 常见 SQL 错误

| 错误码 | 含义 | 常见原因 | 解决方案 |
|--------|------|----------|----------|
| 1062 | Duplicate entry | 唯一索引冲突 | 检查数据唯一性，使用 `INSERT IGNORE` 或 `ON DUPLICATE KEY` |
| 1064 | SQL syntax error | SQL 语法错误 | 检查 SQL 语法，注意保留字和引号 |
| 1146 | Table doesn't exist | 表不存在 | 检查表名、数据库、大小写 |
| 1213 | Deadlock found | 死锁 | 优化事务顺序，减小事务粒度 |
| 1292 | Truncated incorrect | 数据类型不匹配 | 检查字段类型和插入值 |
| 1366 | Incorrect string value | 字符集不匹配 | 统一使用 utf8mb4 |
| 1452 | Foreign key constraint | 外键约束失败 | 先插入父表数据，或检查外键关系 |

## 常见运维错误

| 错误码 | 含义 | 常见原因 | 解决方案 |
|--------|------|----------|----------|
| 1114 | Table is full | 磁盘满或表空间限制 | 清理磁盘，检查 `innodb_data_file_path` |
| 1205 | Lock wait timeout | 锁等待超时 | 优化事务，增大 `innodb_lock_wait_timeout` |
| 1534 | Binlog not enabled | 未开启 Binlog | 配置 `log_bin` 参数 |
| 3140 | Invalid JSON text | JSON 格式错误 | 检查 JSON 字符串格式 |
