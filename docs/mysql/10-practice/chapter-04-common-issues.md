# 常见问题与避坑指南

> 本页负责快速定位和止损。机制、方案取舍与完整操作分别回到对应专题，避免在这里重复维护两套解释。

## 如何使用本页

每个问题按同一顺序展开：先描述可观测现象，再列出首查项，最后给出安全处置和专题入口。执行任何高风险操作前，先确认版本、数据规模、备份和回滚条件。

| 现象 | 首查项 | 原理入口 |
| :-- | :-- | :-- |
| 查询变慢或索引未命中 | 访问条件、选择性、`EXPLAIN` | [索引使用](../03-index/chapter-03-index-usage.md)、[执行计划](../04-query-optimization/chapter-01-execution-plan.md) |
| 锁等待或死锁 | 事务边界、加锁顺序、死锁日志 | [死锁](../05-transaction-lock/chapter-04-deadlock.md) |
| 连接耗尽或泄漏 | 连接池指标、未关闭资源、连接创建速率 | [连接管理](../08-operations/chapter-06-connection-mgmt.md) |
| 大表 DDL 阻塞 | Metadata Lock、执行算法、复制延迟 | [在线 DDL](../08-operations/chapter-07-online-ddl.md) |
| 错误码或时区异常 | 客户端与服务端错误上下文、连接参数 | [错误码速查](../reference/errors.md) |

## 索引未命中

### 现象

查询没有按预期走索引，延迟随数据量增长；表上虽然已建索引，执行计划仍显示全表扫描或大范围扫描。

### 首查项

1. 用 `EXPLAIN` 检查访问类型、候选索引、预估扫描行数和过滤比例。
2. 用 `SHOW INDEX FROM` 确认索引列顺序与查询条件是否匹配。
3. 检查条件是否对索引列施加函数、隐式类型转换或左模糊匹配。

```sql
-- users(id, phone, created_at, name)
EXPLAIN SELECT id, phone
FROM users
WHERE phone = '13800138000';

-- 改写函数条件，让 created_at 保持可比较形式
EXPLAIN SELECT id
FROM users
WHERE created_at >= '2024-01-01 00:00:00'
  AND created_at <  '2024-02-01 00:00:00';
```

### 安全处置

优先改写条件或调整索引，不要直接用 `FORCE INDEX` 掩盖问题。执行计划来自估算统计，必要时先执行 `ANALYZE TABLE`，再比较改写前后的成本、扫描行数和实测耗时。左模糊匹配是语义需求时，应评估前缀索引、全文索引或独立搜索组件。

继续分析见[索引使用](../03-index/chapter-03-index-usage.md)和[执行计划](../04-query-optimization/chapter-01-execution-plan.md)。

## 事务死锁

### 现象

应用间歇收到错误码 1213，部分事务回滚；服务端日志出现 `LATEST DETECTED DEADLOCK`。

### 首查项

```sql
SHOW ENGINE INNODB STATUS;
SELECT * FROM performance_schema.data_lock_waits;
SELECT trx_id, trx_state, trx_started, trx_query
FROM information_schema.innodb_trx;
```

重点比对死锁日志中两个事务的加锁顺序、扫描范围、隔离级别和等待关系。

### 安全处置

统一按主键或业务唯一键升序访问记录；缩短事务；移出远程调用、文件下载等慢操作；保证业务重试逻辑可安全重放。单次死锁通常由数据库自动回滚一个事务，应用只需按业务规则重试，不能盲目增加锁等待时间。

完整场景见[死锁](../05-transaction-lock/chapter-04-deadlock.md)。

## 大事务或长时间事务

### 现象

事务持续数分钟至数小时，Undo Log 增长，历史版本清理受阻，查询出现锁等待，主从复制延迟上升。

### 首查项

```sql
SELECT trx_id, trx_started, trx_rows_modified, trx_query
FROM information_schema.innodb_trx
ORDER BY trx_started;
SELECT * FROM performance_schema.data_locks;
```

同时观察应用侧事务边界、单批写入量和复制延迟。

### 安全处置

把批量删除、更新和迁移改为按主键分批执行，每批结束后提交；每批行数通过压测确定。不要把“循环加 `LIMIT`”当作固定答案，数据分布、索引和锁竞争都会影响批次大小。示例流程如下：

```sql
DELETE FROM audit_logs
WHERE id < 100000000
  AND id >= 99000000
ORDER BY id
LIMIT 10000;
```

外部调度器读取上次最大主键并推进区间，直到受影响行数为 0。切分前确认每批能够独立重试。

## 连接池耗尽

### 现象

应用持续报连接超时或“连接数过多”，数据库连接数接近上限，同时仍有慢事务或泄漏连接。

### 首查项

```sql
SHOW GLOBAL STATUS LIKE 'Threads_connected';
SHOW GLOBAL STATUS LIKE 'Max_used_connections';
SHOW VARIABLES LIKE 'max_connections';
SHOW PROCESSLIST;
```

同时检查应用连接池的活跃数、等待数、获取耗时和超时事件。只看数据库端无法区分“配置过小”“突发峰值”与“连接泄漏”。

### 安全处置

按“应用实例数 × 单实例池上限 × 峰值比例”估算总量，再为复制、管理、监控和故障切换保留余量。数据库上限必须高于应用总需求，而不是把某个固定池大小当成通用值。若大量连接长期空闲，先修复未关闭资源并设置合理超时，再调整池上限。

具体规划见[连接管理](../08-operations/chapter-06-connection-mgmt.md)。

## 主键选择不当

### 现象

随机主键造成聚簇索引页分裂、写放大和空间利用率下降；业务编号会变化，却承担了主键职责。

### 首查项

```sql
SHOW TABLE STATUS LIKE 'orders';
EXPLAIN SELECT * FROM orders WHERE id = 1001;
```

确认主键是否随机、是否可能变更，以及高频查询是否依赖它。UUID 不会“必然导致故障”，但随机索引顺序会放大某些写入负载。

### 安全处置

新表可优先考虑连续或时间有序主键，并为业务编号建立唯一索引。已有表更换主键属于高风险结构变更，应先在影子表验证数据量、复制延迟和切换窗口；不能通过随意 `ALTER TABLE` 快速完成。

```sql
CREATE TABLE orders (
    id BIGINT NOT NULL AUTO_INCREMENT,
    order_no VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_order_no (order_no)
) ENGINE=InnoDB;
```

字段取舍见[索引设计](../03-index/chapter-02-index-design.md)。

## 大表 DDL 阻塞

### 现象

执行 `ALTER TABLE` 后，新查询排队等待 Metadata Lock；应用写入堆积，从库延迟继续增长。

### 首查项

```sql
SELECT * FROM performance_schema.metadata_locks
WHERE OBJECT_SCHEMA = DATABASE();

SHOW PROCESSLIST;
```

查找持有长事务或长查询的会话，确认目标表和版本支持的算法与锁级别。

### 安全处置

先停止新长查询并清理应用长事务，再执行结构变更；不要只依赖 `LOCK=NONE`，它表示表级锁级别，不代表没有 Metadata Lock，也不保证没有业务阻塞。原生 DDL 不满足条件时，使用 `pt-osc` 或 `gh-ost`，并在预发布环境演练锁等待、负载阈值和回滚步骤。

算法条件与风险见[在线 DDL](../08-operations/chapter-07-online-ddl.md)。

## JDBC 连接或结果集泄漏

### 现象

数据库连接数持续增加，应用重启后恢复，连接池反复等待空闲连接。

### 首查项

检查异常路径中的 `Connection`、`Statement` 和 `ResultSet` 是否关闭，并开启连接池泄漏检测日志。Java 代码假设已有 `DataSource` 和 `User` 类型：

```java
try (Connection connection = dataSource.getConnection();
     Statement statement = connection.createStatement();
     ResultSet resultSet = statement.executeQuery("SELECT name FROM users")) {
    while (resultSet.next()) {
        String name = resultSet.getString("name");
    }
}
```

### 安全处置

使用 try-with-resources 或 Spring `JdbcTemplate` 等由框架管理资源的方式，确保异常路径也会关闭连接。增加获取连接超时时间只能暴露问题，不能替代泄漏修复。

连接配置和诊断数据见[连接管理](../08-operations/chapter-06-connection-mgmt.md)。

## N+1 查询

### 现象

一次列表请求触发少量主查询和大量逐条关联查询，数据库请求次数、网络往返和 CPU 使用率随列表长度线性增长。

### 首查项

在日志、APM 或 Performance Schema 中按请求聚合查询次数，识别“1 + N”的参数模式。不要只比较单条语句耗时。

### 安全处置

在单条语句中无法获得更好计划时，批量取得关联数据后在应用中组装。以下为 Java 流程示意，不是可直接编译的完整程序：

```text
orders = loadOrders(page)
userIds = unique(order.userId for order in orders)
users = SELECT id, name FROM users WHERE id IN (userIds)
attach users by id to orders
```

批量 `IN` 的参数数量应受连接参数和压测约束；数据量很大时改为分页查询或更合理的数据模型。JPA 可根据访问模式评估 `JOIN FETCH`，同时注意笛卡尔积和取值方式。

关联查询分析见[JOIN 优化](../04-query-optimization/chapter-03-join-optimization.md)。

## 时间与时区异常

### 现象

应用写入后读取的时间偏移若干小时，跨夏令时或跨区域部署时结果不稳定。

### 首查项

分别记录并比较 JDBC 连接时区、MySQL 会话时区、服务器时区和 JVM 默认时区，再确认字段使用 `DATETIME` 还是 `TIMESTAMP`。

```sql
SELECT NOW(), UTC_TIMESTAMP(), @@time_zone, @@system_time_zone;
```

### 安全处置

在连接建立时明确时区，并让服务端、应用和部署配置保持一致。示例适用于 MySQL Connector/J 8.0.23+：

```properties
# JDBC URL
connectionTimeZone=Asia/Shanghai
forceConnectionTimeZoneToSession=true

# JVM 启动参数
-Duser.timezone=Asia/Shanghai
```

```ini
# MySQL 配置文件
default-time-zone = '+08:00'
```

业务代码优先使用 `java.time` 类型并明确解析、格式化和转换边界。`DATETIME` 不携带时区，`TIMESTAMP` 会按时区转换；选定策略后不要在同一链路混用多套隐式转换。

更多差异见[字符集与排序规则](../01-basics/chapter-03-charset-collation.md)。

## 常见错误码

错误码可能受服务端版本、客户端和会话影响。先结合异常消息、SQL、连接参数和服务端日志定位，不把下表当作自动修复命令。

| 错误码 | 典型现象 | 首查方向 |
| :-- | :-- | :-- |
| 1062 | 唯一约束冲突 | 比对重复值、并发写入和幂等键 |
| 1213 | 事务死锁 | 查看 `SHOW ENGINE INNODB STATUS` 的最新死锁 |
| 1205 | 锁等待超时 | 查看长事务、锁范围和应用事务边界 |
| 1040 | 数据库连接数过多 | 比较 `max_connections`、连接池总峰值与泄漏 |
| 1153 | 请求数据包过大 | 检查客户端和 `max_allowed_packet` |
| 2006 | 客户端与服务端连接断开 | 检查网络、负载均衡、服务端日志和空闲超时 |
| 1045 | 认证失败 | 检查用户名、主机范围、认证插件和权限 |
| 1146 | 表不存在 | 检查默认数据库、表名和对象可见性 |

错误信息和版本差异见[错误码速查](../reference/errors.md)。
