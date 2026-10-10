# 常用错误码速查

> 本页只提供首查方向。错误文本、SQLSTATE 和触发条件可能随版本、客户端和会话模式变化；继续排查连接、锁或查询问题时见[常见问题与避坑指南](../10-practice/chapter-04-common-issues.md)。

## 连接与权限

| 错误码 | 典型信息 | 首查方向 |
| :-- | :-- | :-- |
| 1040 | Too many connections | 比较 `max_connections`、`Threads_connected`、`Max_used_connections` 和应用连接池总峰值，先排除泄漏 |
| 1045 | Access denied for user | 核对用户名、来源主机、密码、认证插件和 `SHOW GRANTS`；不能仅凭错误码判断是密码还是权限问题 |
| 2003 | Can't connect to MySQL server | 检查服务状态、监听地址、端口、DNS、防火墙和 TLS 配置 |
| 2006 | MySQL server has gone away | 这是客户端侧连接已断开；检查服务端错误日志、网络/负载均衡、空闲超时、查询超长和数据包大小 |
| 2013 | Lost connection during query | 检查服务端是否终止连接、网络抖动、超时配置和导致会话中断的长语句 |

客户端错误码 2006、2013 不是由服务端错误码表单独决定。先保存客户端完整异常和服务端同一时间点日志，再调整 `wait_timeout`、`net_read_timeout` 或 `max_allowed_packet` 等参数。

## SQL 与数据

| 错误码 | 典型信息 | 首查方向 |
| :-- | :-- | :-- |
| 1062 | Duplicate entry for key | 读取完整索引名和重复值；比较并发写入与幂等键。只有业务确实允许覆盖时才选择 `ON DUPLICATE KEY UPDATE`，不要用 `INSERT IGNORE` 掩盖数据问题 |
| 1064 | SQL syntax or not exist error | 按错误位置检查语法、引号、保留字、`sql_mode` 和生成 SQL 的客户端版本 |
| 1146 | Table doesn't exist | 核对当前默认数据库、schema、对象大小写和权限 |
| 1213 | Deadlock found when trying to get lock | 查看 `SHOW ENGINE INNODB STATUS` 的最新死锁，比较事务顺序和扫描范围 |
| 1205 | Lock wait timeout exceeded | 查看持锁事务、锁图和长事务；提高超时只会延迟失败，不解决阻塞 |
| 1292 | Truncated incorrect value | 检查目标列类型、日期格式和严格模式；非严格模式可能降级为警告并写入不同值 |
| 1366 | Incorrect string value | 同时核对连接字符集、列字符集、无效字节和客户端编码 |
| 1452 | Foreign key constraint fails | 检查父记录、外键值、字段类型/排序规则和插入、删除顺序 |

## 存储与结构

| 错误码 | 典型信息 | 首查方向 |
| :-- | :-- | :-- |
| 1114 | Table is full | 检查文件系统空间、表空间容量、存储引擎上限以及 MEMORY 表的内存配置；不能只改一个数据文件参数 |
| 3140 | Invalid JSON text | 检查 JSON 字符串的引号、转义、编码和函数返回值 |

处理原则是先恢复业务或隔离故障，再保留现场并定位根因。调大超时、删除冲突、关闭约束或切换 SQL Mode 都可能改变业务语义，必须写入变更记录并验证回滚条件。
